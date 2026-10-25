import { supabase } from "../lib/supabase";
import {
  CONNECTING_KEY,
  EXPIRES_KEY,
  LINKED_KEY,
  NOTICE_KEY,
  TOKEN_KEY,
  clearGraphToken,
  forgetWithToken,
  hasGraphToken,
  storeGraphToken,
} from "../lib/graphStore";
import { bytesToBase64 } from "../lib/base64";
import { brandImages, imageType } from "../lib/inlineBrand";
import { readOutcome, type ConnectOutcome } from "../lib/outlookConnect";
import { forOutlook } from "../lib/mailHtml";
import { kqlFor, plainText, searchTerms, snippetAround } from "../lib/searchHighlight";
import { MAIL_COLOR, MAIL_FONT, MAIL_IMAGE_MAX, MAIL_SIZE } from "../lib/mailStyle";
import type { BaseFolder, FolderId, MailMessage, Recipient } from "./mockMail";
import { readForwardChain } from "./forwardChain";
import {
  isEmbeddedImage,
  rewriteCidImages,
  type ResolvedImage,
} from "../lib/inlineImages";

/**
 * Declared here rather than imported from backend.ts, which imports this file —
 * taking it from there would close an import cycle for a four-field type.
 */
export interface MailFolder {
  id: FolderId;
  label: string;
  total: number;
  unread: number;
  /** 1 for a folder inside another (a customer's folder under Inbox). */
  depth?: number;
  /** The folder it sits in, by name. */
  parent?: string;
}

/**
 * Outlook, for real, through Microsoft Graph.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BROWSER CALLS GRAPH DIRECTLY
 *
 * Graph supports CORS and is designed to be called from single-page apps, so a
 * delegated access token in the browser is the intended pattern -- not a
 * shortcut around a missing server. v2 therefore still needs no backend.
 *
 * The token is DELEGATED, which is the whole safety argument: it acts as the
 * signed-in person and can only ever reach their own mailbox. info@ cannot read
 * aarathy@ no matter what this code asks for, because the token does not carry
 * that authority. Application permissions would have granted every mailbox in
 * the tenant at once, which is why step 5 of the setup used Delegated.
 *
 * TOKEN LIFETIME. Supabase hands back Microsoft's access token as
 * `provider_token` when the OAuth round trip completes, and it lives about an
 * hour. Supabase does not refresh it -- it refreshes its own JWT, not
 * Microsoft's. Until 25 Sep 2026 that meant Outlook dropped an hour after
 * signing in, mid-send.
 *
 * Now (094) the refresh token that comes back with it is handed once to the
 * `outlook-token` function, which keeps it against this sign-in and trades it
 * for a fresh access token whenever the one here is about to run out or Graph
 * answers 401 -- redeeming it needs the Azure app's client secret, which only
 * the server has. So Outlook stays connected for as long as the CRM does, and
 * signing out ends both. Only when Microsoft itself ends the connection
 * (password changed, access revoked) does the mailbox ask to be reconnected.
 * ---------------------------------------------------------------------------
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

// Where the token is kept: lib/graphStore, which the first screen loads without this file.
export { clearGraphToken, hasGraphToken, storeGraphToken };

/** Thrown when Microsoft rejects the token, so the UI can offer a reconnect. */
export class GraphAuthError extends Error {
  constructor(message = "Microsoft ended the Outlook connection. Connect Outlook again.") {
    super(message);
    this.name = "GraphAuthError";
  }
}

/**
 * Asks the `outlook-token` function (094). A 409 with `reconnect` is Microsoft
 * having ended the connection: the token here goes too, and the mailbox offers
 * "Connect Outlook". Anything else is a hiccup, reported as one.
 */
async function outlookToken(body: { action: "link" | "token"; refresh_token?: string }): Promise<{ access_token: string; expires_in: number }> {
  const { data, error } = await supabase.functions.invoke("outlook-token", { body });
  if (error) {
    const said = await (error as { context?: Response }).context?.json?.().catch(() => null);
    if (said?.reconnect) {
      clearGraphToken();
      throw new GraphAuthError();
    }
    throw new Error(said?.error ?? error.message);
  }
  return data as { access_token: string; expires_in: number };
}

/**
 * Takes up the Microsoft tokens from a Supabase session, if it carries them —
 * which it does only straight after the Microsoft sign-in, and until Supabase
 * next renews its own session.
 *
 * The access token is usable at once. The refresh token goes to the server,
 * once per sign-in; the fresh access token that comes back replaces the first.
 * If that fails the hour's token still works, and the mailbox asks to be
 * reconnected when it runs out, as it always did.
 */
let adopted: string | null = null;
// Signing out forgets the opened mail and the sign-in taken up, with the token.
forgetWithToken(() => {
  forgetOpenedMail();
  adopted = null;
});
export function adoptMicrosoftSession(session: unknown) {
  const s = session as { provider_token?: string | null; provider_refresh_token?: string | null } | null;
  if (!s?.provider_token) return;
  const refresh = s.provider_refresh_token;
  if (!refresh) {
    storeGraphToken(s.provider_token);
    return;
  }
  // getSession and the SIGNED_IN event both deliver the same session.
  if (adopted === refresh) return;
  adopted = refresh;
  const first = s.provider_token;
  void (async () => {
    const tag = await fingerprint(refresh);
    // A reload within the hour: the server already has this one, and the
    // token here is newer than the one on the session.
    if (sessionStorage.getItem(LINKED_KEY) === tag && hasGraphToken()) return;
    storeGraphToken(first);
    try {
      const got = await outlookToken({ action: "link", refresh_token: refresh });
      storeGraphToken(got.access_token, got.expires_in);
      sessionStorage.setItem(LINKED_KEY, tag);
    } catch {
      /* the first token stands; see above */
    }
  })();
}

async function fingerprint(value: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(d).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Connect Outlook from inside the CRM (095), for whoever is signed in, however
 * they signed in.
 *
 * The outlook-connect function answers with Microsoft's sign-in for this
 * login's own address, and the browser goes there. Microsoft sends it back to
 * the function, which connects the mailbox only if it is this login's, and
 * then back to `returnPath` — where `finishOutlookConnect` picks up the result.
 * The CRM session is not touched either way.
 */
export async function connectOutlook(returnPath: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("outlook-connect", {
    body: { action: "start", return_to: `${window.location.origin}${returnPath}` },
  });
  if (error) {
    const said = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(said?.error ?? error.message);
  }
  sessionStorage.setItem(CONNECTING_KEY, "1");
  window.location.assign((data as { url: string }).url);
}

/**
 * On start-up, signed in: if this tab is just back from connecting, fetch the
 * mailbox's first token and keep a notice of how it went for the Mail page.
 *
 * Only a connect this tab started counts. A link somebody sends with
 * "#outlook=failed&why=…" on the end shows nothing.
 */
export async function finishOutlookConnect(): Promise<void> {
  const outcome = readOutcome(window.location.hash);
  if (!outcome) return;
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  if (!sessionStorage.getItem(CONNECTING_KEY)) return;
  sessionStorage.removeItem(CONNECTING_KEY);

  let notice: ConnectOutcome = outcome;
  if (outcome.kind === "connected") {
    try {
      await renew();
    } catch (e) {
      notice = { kind: "failed", why: e instanceof Error ? e.message : "The first token could not be fetched." };
    }
  }
  sessionStorage.setItem(NOTICE_KEY, JSON.stringify(notice));
}

/** How the last connect went, if the Mail page has not shown it yet. */
export function peekOutlookNotice(): ConnectOutcome | null {
  try {
    return readOutcomeJson(sessionStorage.getItem(NOTICE_KEY));
  } catch {
    return null;
  }
}

export function clearOutlookNotice() {
  sessionStorage.removeItem(NOTICE_KEY);
}

function readOutcomeJson(raw: string | null): ConnectOutcome | null {
  if (!raw) return null;
  const o = JSON.parse(raw) as ConnectOutcome;
  return o && (o.kind === "connected" || o.kind === "refused" || o.kind === "failed") ? o : null;
}

/** One renewal at a time: a folder load fires several Graph calls at once. */
let renewing: Promise<string> | null = null;
function renew(): Promise<string> {
  renewing ??= outlookToken({ action: "token" })
    .then((got) => {
      storeGraphToken(got.access_token, got.expires_in);
      return got.access_token;
    })
    .finally(() => {
      renewing = null;
    });
  return renewing;
}

/**
 * The token to call Graph with, renewed first when it has under two minutes
 * left — a request started at 59:59 should not arrive at 60:01.
 */
async function usableToken(): Promise<string> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) throw new GraphAuthError("Outlook is not connected on this session.");
  const expires = Number(sessionStorage.getItem(EXPIRES_KEY) ?? 0);
  if (expires && expires - Date.now() < 2 * 60_000) {
    try {
      return await renew();
    } catch (e) {
      // Microsoft said no, or it has run out already: nothing to fall back on.
      if (e instanceof GraphAuthError || Date.now() >= expires) throw e;
      return token;
    }
  }
  return token;
}

/**
 * fetch against Graph with the token, renewing it once if Graph says it has
 * run out. A 401 means nothing was done, so sending again is safe.
 */
/**
 * Microsoft refused one thing this connection was not granted — rules need
 * MailboxSettings.ReadWrite — while the rest of the mailbox still works. Kept
 * apart from GraphAuthError so it does not disconnect Outlook.
 */
export class GraphForbiddenError extends Error {
  constructor(message = "Microsoft has not granted the CRM this permission.") {
    super(message);
    this.name = "GraphForbiddenError";
  }
}

async function graphFetch(url: string, init: RequestInit = {}, soft403 = false): Promise<Response> {
  const call = (token: string) =>
    fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } });
  let r = await call(await usableToken());
  if (r.status === 401) r = await call(await renew());

  // A 403 on something optional (rules) is that one permission, not the
  // connection: the caller says so, and gets the answer to deal with.
  if (r.status === 403 && soft403) return r;

  // Still 401 after a fresh token, or 403 (a permission the app was never
  // granted): both mean "reconnect", and neither is worth a stack trace at the user.
  if (r.status === 401 || r.status === 403) {
    clearGraphToken();
    throw new GraphAuthError(
      r.status === 403 ? "Microsoft refused the CRM access to this mailbox. Connect Outlook again." : undefined
    );
  }
  return r;
}

async function graph<T>(path: string, init: RequestInit = {}, soft403 = false): Promise<T> {
  // A path, or a next-page link Graph itself handed back (and only Graph's).
  const url = path.startsWith("https://graph.microsoft.com/") ? path : `${GRAPH}${path}`;
  const r = await graphFetch(
    url,
    {
      ...init,
      headers: { "Content-Type": "application/json", ...((init.headers as Record<string, string> | undefined) ?? {}) },
    },
    soft403
  );
  if (r.status === 403 && soft403) throw new GraphForbiddenError();

  if (!r.ok) {
    const detail = await r.text();
    let message = `Outlook returned ${r.status}`;
    try {
      message = JSON.parse(detail)?.error?.message ?? message;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(message);
  }

  // sendMail and the update endpoints answer 202/204 with no body.
  return (r.status === 204 || r.status === 202 ? null : await r.json()) as T;
}

/**
 * Graph's well-known folder names, mapped to the four this UI shows.
 *
 * Using the well-known names rather than folder ids matters: ids differ per
 * mailbox, so hardcoding one person's Inbox id would break for everyone else.
 */
const WELL_KNOWN: Record<BaseFolder, string> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
  archive: "archive",
  junk: "junkemail",
  deleted: "deleteditems",
};

const FOLDER_LABEL: Record<BaseFolder, string> = {
  inbox: "Inbox",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  junk: "Junk",
  deleted: "Deleted Items",
};

const isOwn = (f: FolderId): f is `id:${string}` => f.startsWith("id:");
/** A folder as a Graph path segment: its well-known name, or its own id. */
const folderRef = (f: FolderId) => (isOwn(f) ? encodeURIComponent(f.slice(3)) : WELL_KNOWN[f]);
/** A folder as a move's destination, which takes the id itself. */
const destinationOf = (f: FolderId) => (isOwn(f) ? f.slice(3) : WELL_KNOWN[f]);

interface GraphFolder {
  id: string;
  displayName: string;
  totalItemCount: number;
  unreadItemCount: number;
}

interface GraphMessage {
  id: string;
  conversationId: string;
  subject: string | null;
  from?: { emailAddress: { name?: string; address?: string } };
  sender?: { emailAddress: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress: { name?: string; address?: string } }>;
  ccRecipients?: Array<{ emailAddress: { name?: string; address?: string } }>;
  receivedDateTime: string;
  bodyPreview: string | null;
  body?: { contentType: string; content: string };
  isRead: boolean;
  isDraft: boolean;
  hasAttachments: boolean;
  importance: string;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  flag?: { flagStatus?: string };
  webLink?: string;
}

const recipient = (r?: { emailAddress: { name?: string; address?: string } }): Recipient => ({
  emailAddress: { name: r?.emailAddress?.name ?? "", address: r?.emailAddress?.address ?? "" },
});

/**
 * Graph's message, in the shape the UI already reads.
 *
 * The field names line up almost exactly -- which was the point of shaping the
 * mock on Graph in the first place -- so this is a thin adapter rather than a
 * translation layer. `mailbox` and `folder` are the only additions, because
 * Graph infers both from the token and the URL while the UI wants them stated.
 */
function adapt(m: GraphMessage, mailbox: string, folder: FolderId): MailMessage {
  const html = m.body?.contentType?.toLowerCase() === "html";
  return {
    id: m.id,
    conversationId: m.conversationId,
    mailbox,
    folder,
    subject: m.subject || "(no subject)",
    from: recipient(m.from ?? m.sender),
    toRecipients: (m.toRecipients ?? []).map(recipient),
    ccRecipients: (m.ccRecipients ?? []).map(recipient),
    receivedDateTime: m.receivedDateTime,
    bodyPreview: m.bodyPreview ?? "",
    body: {
      contentType: html ? "html" : "text",
      content: m.body?.content ?? m.bodyPreview ?? "",
    },
    isRead: m.isRead,
    isDraft: m.isDraft,
    hasAttachments: m.hasAttachments,
    attachments: [],
    importance: (m.importance as MailMessage["importance"]) ?? "normal",
    internetMessageHeaders: m.internetMessageHeaders,
    flagged: m.flag?.flagStatus === "flagged",
    webLink: m.webLink,
  };
}

/**
 * The body, wrapped so it arrives looking like it did in the CRM.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FONT HAS TO BE STATED
 *
 * Outlook renders an HTML mail in whatever the recipient's own compose theme
 * is — usually Calibri or Aptos — unless the message says otherwise. The CRM's
 * editor shows one font and the sent mail showed another, which is why a
 * signature that lined up on screen arrived looking different.
 *
 * Microsoft YaHei is set here because it is what this desk sends in. It carries
 * Latin and CJK in one face, so a message that quotes a Chinese agent's name
 * does not switch fonts mid-line, and it is present on every Windows machine
 * the recipients use.
 *
 * WHY A DIV AND NOT A STYLE BLOCK
 *
 * Outlook strips <style> from the body of a received message, and Gmail scopes
 * it unpredictably. An inline font-family on a wrapping div is the only thing
 * that survives every client — which is the same reason the whole editor emits
 * inline styles rather than classes.
 *
 * The values are lib/mailStyle.ts's, the same ones the editor's page is drawn
 * with, and `forOutlook` writes them into every table cell, which Outlook
 * would otherwise set in Times New Roman (lib/mailHtml.ts).
 * ---------------------------------------------------------------------------
 */
function asOutgoingHtml(content: string): string {
  return `<div style="font-family:${MAIL_FONT};font-size:${MAIL_SIZE};color:${MAIL_COLOR}">` + forOutlook(content) + `</div>`;
}

/** Outlook's own folders that are not places anybody files mail. */
const SYSTEM_FOLDERS = new Set(["outbox", "conversation history", "sync issues", "rss feeds", "rss subscriptions", "clutter", "scheduled"]);

/**
 * Every folder worth showing: the four tabs, Junk and Deleted Items, and the
 * person's own folders — top-level ones and those one level down (a customer's
 * folder under Inbox), as Outlook's folder pane lists them.
 *
 * The six well-known ones are recognised by id (knownFolderIds), not by name,
 * so a mailbox in another language still finds them.
 */
export async function listFolders(mailbox: string): Promise<MailFolder[]> {
  const [data, ids] = await Promise.all([
    graph<{ value: Array<GraphFolder & { childFolderCount?: number }> }>(
      "/me/mailFolders?$top=100&$select=id,displayName,totalItemCount,unreadItemCount,childFolderCount"
    ),
    knownFolderIds(mailbox),
  ]);
  const top = data.value;
  // One level down, for the folders that have any — the Inbox first, which is
  // where most people keep a folder per customer. At most a dozen parents.
  const parents = top.filter((f) => (f.childFolderCount ?? 0) > 0 && !SYSTEM_FOLDERS.has(f.displayName.toLowerCase())).slice(0, 12);
  const children = await Promise.all(
    parents.map((p) =>
      graph<{ value: GraphFolder[] }>(
        `/me/mailFolders/${encodeURIComponent(p.id)}/childFolders?$top=100&$select=id,displayName,totalItemCount,unreadItemCount`
      )
        .then((r) => r.value.map((c) => ({ ...c, parent: p })))
        .catch(() => [] as Array<GraphFolder & { parent: GraphFolder }>)
    )
  );

  const byId = new Map(top.map((f) => [f.id, f]));
  const known: Array<[BaseFolder, KnownFolder]> = [
    ["inbox", "inbox"],
    ["sent", "sent"],
    ["drafts", "drafts"],
    ["archive", "archive"],
    ["junk", "junk"],
    ["deleted", "deleted"],
  ];
  const knownIds = new Set(Object.values(ids));
  const out: MailFolder[] = known.map(([id, k]) => {
    const hit = ids[k] ? byId.get(ids[k]!) : undefined;
    return {
      id,
      label: FOLDER_LABEL[id],
      total: hit?.totalItemCount ?? 0,
      // A Sent item or a draft being "unread" is meaningless.
      unread: id === "sent" || id === "drafts" ? 0 : hit?.unreadItemCount ?? 0,
    };
  });

  const own = (f: GraphFolder, depth: number, parent?: string): MailFolder => ({
    id: `id:${f.id}`,
    label: f.displayName,
    total: f.totalItemCount,
    unread: f.unreadItemCount,
    depth,
    parent,
  });
  // The Inbox's own folders first — where most people keep one per customer —
  // then the top-level ones, each with the folders inside it.
  for (const c of children.flat().filter((x) => x.parent.id === ids.inbox)) out.push(own(c, 1, "Inbox"));
  for (const f of top) {
    if (knownIds.has(f.id) || SYSTEM_FOLDERS.has(f.displayName.toLowerCase())) continue;
    out.push(own(f, 0));
    for (const c of children.flat().filter((x) => x.parent.id === f.id)) out.push(own(c, 1, f.displayName));
  }
  return out;
}

/**
 * One page of a folder, and how to ask for the next.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGES AT ALL
 *
 * It used to fetch $top=40 and stop, with nothing to ask for more. A mailbox
 * with eighty unread showed the newest forty and silently hid the rest — the
 * folder tab said 80 because that count comes from the folder's own metadata,
 * not from the list, so the two disagreed and the list was the one that was
 * wrong. Everything older than the fortieth message was unreachable.
 *
 * Graph answers with @odata.nextLink when there is more, which is a complete
 * URL carrying its own skip token. Following it is the only correct way to walk
 * a mail folder: an offset would drift as new mail arrives at the top.
 * ---------------------------------------------------------------------------
 */
export interface MessagePage {
  messages: MailMessage[];
  /** Pass back to listMore for the next page. Absent means this is the end. */
  nextLink?: string;
}

const LIST_SELECT =
  "id,conversationId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,isDraft,hasAttachments,importance,flag,webLink";

export async function listMessages(
  mailbox: string,
  folder: FolderId,
  q?: string,
  /** Outlook's Filter: unread only, or flagged only. */
  filter?: "unread" | "flagged"
): Promise<MessagePage> {
  // Graph refuses $orderby with a $filter on other properties unless the sort
  // property is filtered on first — hence the receivedDateTime clause, which
  // matches everything.
  const only = filter
    ? `&$filter=${encodeURIComponent(
        `receivedDateTime ge 1900-01-01T00:00:00Z and ${filter === "unread" ? "isRead eq false" : "flag/flagStatus eq 'flagged'"}`
      )}`
    : "";
  // $search and $orderby cannot be combined in Graph; search results come back
  // by relevance, which is the right order for a search anyway.
  const path = q?.trim()
    ? `/me/mailFolders/${folderRef(folder)}/messages?$top=50&$select=${LIST_SELECT}&$search=${encodeURIComponent(`"${q.trim()}"`)}`
    : `/me/mailFolders/${folderRef(folder)}/messages?$top=50&$select=${LIST_SELECT}&$orderby=receivedDateTime desc${only}`;

  const data = await graph<{ value: GraphMessage[]; "@odata.nextLink"?: string }>(path, {
    // ConsistencyLevel is required for $search on messages.
    headers: q?.trim() ? { ConsistencyLevel: "eventual" } : {},
  });
  return {
    messages: data.value.map((m) => adapt(m, mailbox, folder)),
    nextLink: data["@odata.nextLink"],
  };
}

/**
 * The next page, from the link Graph handed back.
 *
 * The link is an absolute URL rather than a path, so it cannot go through
 * `graph()` — which prefixes the v1.0 base and would produce a doubled URL.
 */
export async function listMore(
  mailbox: string,
  folder: FolderId,
  nextLink: string
): Promise<MessagePage> {
  // Only ever a link Graph itself produced, and only against Graph's own host.
  if (!nextLink.startsWith("https://graph.microsoft.com/")) {
    throw new Error("Refusing to follow a page link that is not Microsoft Graph.");
  }

  const r = await graphFetch(nextLink);
  if (!r.ok) throw new Error(`Outlook returned ${r.status}`);

  const data = (await r.json()) as { value: GraphMessage[]; "@odata.nextLink"?: string };
  return {
    messages: data.value.map((m) => adapt(m, mailbox, folder)),
    nextLink: data["@odata.nextLink"],
  };
}

/**
 * Search, the way Outlook searches: the whole mailbox or one folder, with a
 * line of each message around the first match and the folder it is in.
 *
 * The bodies are asked for as plain text, which is small, and cut down to the
 * one line here; the list never holds a whole body. Deleted and junk mail are
 * left out. `$search` does not take `$orderby`, so the page is sorted newest
 * first here.
 */
export async function searchMessages(
  mailbox: string,
  query: string,
  folder: FolderId | null
): Promise<MessagePage> {
  const kql = kqlFor(query);
  const base = folder ? `/me/mailFolders/${folderRef(folder)}/messages` : "/me/messages";
  const [data, ids] = await Promise.all([
    graph<{ value: SearchHit[]; "@odata.nextLink"?: string }>(
      `${base}?$top=25&$select=${LIST_SELECT},parentFolderId,body&$search=${encodeURIComponent(kql)}`,
      { headers: { ConsistencyLevel: "eventual", Prefer: 'outlook.body-content-type="text"' } }
    ),
    knownFolderIds(mailbox),
  ]);
  return { messages: searchResults(data.value, mailbox, ids, folder, query), nextLink: data["@odata.nextLink"] };
}

/** The next page of a search, from the link Graph handed back. */
export async function searchMore(
  mailbox: string,
  query: string,
  folder: FolderId | null,
  nextLink: string
): Promise<MessagePage> {
  if (!nextLink.startsWith("https://graph.microsoft.com/")) {
    throw new Error("Refusing to follow a page link that is not Microsoft Graph.");
  }
  const [r, ids] = await Promise.all([
    graphFetch(nextLink, { headers: { ConsistencyLevel: "eventual", Prefer: 'outlook.body-content-type="text"' } }),
    knownFolderIds(mailbox),
  ]);
  if (!r.ok) throw new Error(`Outlook returned ${r.status}`);
  const data = (await r.json()) as { value: SearchHit[]; "@odata.nextLink"?: string };
  return { messages: searchResults(data.value, mailbox, ids, folder, query), nextLink: data["@odata.nextLink"] };
}

type SearchHit = GraphMessage & { parentFolderId?: string };

function searchResults(
  hits: SearchHit[],
  mailbox: string,
  ids: Partial<Record<KnownFolder, string>>,
  folder: FolderId | null,
  query: string
): MailMessage[] {
  const terms = searchTerms(query);
  const label = (id?: string): { folder: FolderId; label: string } => {
    if (folder) return { folder, label: isOwn(folder) ? "Folder" : FOLDER_LABEL[folder] };
    if (id && id === ids.sent) return { folder: "sent", label: "Sent" };
    if (id && id === ids.drafts) return { folder: "drafts", label: "Drafts" };
    if (id && id === ids.archive) return { folder: "archive", label: "Archive" };
    // Inbox, or a folder of the person's own that the four tabs do not show.
    return { folder: "inbox", label: id && ids.inbox && id !== ids.inbox ? "Other folder" : "Inbox" };
  };
  return hits
    .filter((m) => !m.parentFolderId || (m.parentFolderId !== ids.deleted && m.parentFolderId !== ids.junk))
    .map((m) => {
      const where = label(m.parentFolderId);
      const text = plainText(m.body?.content ?? m.bodyPreview ?? "", m.body?.contentType?.toLowerCase() === "html");
      const out = adapt({ ...m, body: undefined }, mailbox, where.folder);
      return { ...out, searchSnippet: snippetAround(text, terms), folderLabel: where.label };
    })
    .sort((a, b) => (Date.parse(b.receivedDateTime) || 0) - (Date.parse(a.receivedDateTime) || 0));
}

/**
 * Messages already opened in this tab, kept in memory (7 Oct).
 *
 * Opening a message is one to three trips to Outlook — the message, its
 * attachment list, the inline pictures — 300 ms to a second from here, and the
 * desk opens the same handful over and over: back to the customer's mail after
 * a look at the quote, the thread again after a colleague's reply. A body does
 * not change once it has arrived, so the second opening is the first's.
 *
 * Memory only, never storage: mail bodies are not written anywhere a later
 * user of the machine could find them, and they go on sign-out (with the
 * Outlook link, `clearGraphToken`). Drafts are not kept — they are edited. What
 * does change on a message (read, flagged) is kept up to date by the calls
 * that change it; a message moved or deleted has a new id and is forgotten.
 * A row the pointer rests on is read ahead of the click (`prefetchMessage`).
 */
const OPENED_MAX = 80;
const OPENED_MS = 15 * 60_000;
const opened = new Map<string, { at: number; m: MailMessage }>();
const reading = new Map<string, Promise<MailMessage>>();

function keepOpened(m: MailMessage) {
  opened.delete(m.id);
  opened.set(m.id, { at: Date.now(), m });
  while (opened.size > OPENED_MAX) opened.delete(opened.keys().next().value as string);
}

/** A change made to a message: the kept copy follows it, and a read on its way is not kept. */
function touchOpened(id: string, patch?: Partial<MailMessage>) {
  reading.delete(id);
  const hit = opened.get(id);
  if (!hit) return;
  if (patch) hit.m = { ...hit.m, ...patch };
  else opened.delete(id);
}

/** Everything kept, on sign-out or a different mailbox. */
export function forgetOpenedMail() {
  opened.clear();
  reading.clear();
}

export async function getMessage(mailbox: string, id: string, folder: FolderId): Promise<MailMessage> {
  const hit = opened.get(id);
  if (hit && hit.m.mailbox === mailbox && Date.now() - hit.at < OPENED_MS) return { ...hit.m, folder };
  let p = reading.get(id);
  if (!p) {
    const going: Promise<MailMessage> = readMessage(mailbox, id, folder)
      .then((m) => {
        if (!m.isDraft && reading.get(id) === going) keepOpened(m);
        return m;
      })
      .finally(() => {
        if (reading.get(id) === going) reading.delete(id);
      });
    reading.set(id, going);
    p = going;
  }
  return { ...(await p), folder };
}

/** Read a message ahead of its opening — the pointer resting on its row. Quiet. */
export function prefetchMessage(mailbox: string, id: string, folder: FolderId): void {
  if (opened.has(id) || reading.has(id)) return;
  void getMessage(mailbox, id, folder).catch(() => {});
}

/**
 * Which of these messages an inbox rule forwarded here, and from whose mailbox.
 *
 * Read from the one header that proves it, X-MS-Exchange-Inbox-Rules-Loop
 * (services/forwardChain), which a list never carries: Graph sends headers
 * only when asked, and asking for them on a whole page is slow. So the caller
 * names only the messages that could be a forward, and they are asked about
 * twenty to a $batch request, for their headers alone.
 *
 * A message with the header maps to the rule's mailbox, one without it to
 * null, and one gone (moved, deleted) to null too. One the answer did not
 * come back for — throttled, a server error — is left out, to be asked again.
 */
export async function ruleForwarders(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  type Answer = { id: string; status: number; body?: { internetMessageHeaders?: Array<{ name: string; value: string }> } };
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const data = await graph<{ responses?: Answer[] }>("/$batch", {
      method: "POST",
      body: JSON.stringify({
        requests: chunk.map((id, n) => ({ id: String(n), method: "GET", url: `/me/messages/${encodeURIComponent(id)}?$select=internetMessageHeaders` })),
      }),
    });
    for (const r of data.responses ?? []) {
      const id = chunk[Number(r.id)];
      if (!id) continue;
      if (r.status === 404) out.set(id, null);
      if (r.status !== 200) continue;
      const chain = readForwardChain({ internetMessageHeaders: r.body?.internetMessageHeaders ?? [] } as unknown as MailMessage);
      out.set(id, chain?.auto ? chain.forwardedBy : null);
    }
  }
  return out;
}

async function readMessage(
  mailbox: string,
  id: string,
  folder: FolderId
): Promise<MailMessage> {
  // Ask for HTML explicitly.
  //
  // Graph serves the body in whatever form the mailbox is configured to prefer,
  // and a mailbox set to plain text answers with the message flattened: no
  // tables, no colours, the rate card reduced to runs of spaces. The header
  // says which form this app can render, so the answer does not depend on a
  // setting nobody here can see.
  // internetMessageHeaders is NOT in Graph's default field set — it has to be
  // asked for, and asking for anything means asking for everything, because
  // $select replaces the default rather than adding to it. Naming body here is
  // what keeps the reading pane working.
  const select =
    `${LIST_SELECT},body,internetMessageHeaders`;

  const m = await graph<GraphMessage>(
    `/me/messages/${encodeURIComponent(id)}?$select=${select}`,
    { headers: { Prefer: 'outlook.body-content-type="html"' } }
  );
  const full = adapt(m, mailbox, folder);

  /*
    `hasAttachments` is NOT the test for whether there are attachments to fetch.

    Graph documents it as excluding inline ones: "if a message contains only
    inline attachments, this property is false". A signature logo is precisely
    that -- inline, and the only attachment on the message -- so every message
    whose sole attachment is the logo reports false, the fetch below never ran,
    and the image was dropped exactly as it had been before any of this existed.

    The body is the honest test. If it says `cid:` then something inline is
    being pointed at, whatever the flag claims. `hasAttachments` stays in the
    condition for the real files, which the body never mentions.
  */
  const referencesInline = full.body.content.includes("cid:");

  if (m.hasAttachments || referencesInline) {
    /*
      `contentId` is deliberately NOT selected here.

      It belongs to `fileAttachment`, a type derived from `attachment`, and the
      collection is typed as the base. Asking for a derived property on a base
      collection is how you get a 400 back — which would not cost a logo, it
      would throw out of getMessage and take the whole message body with it.
      Every field named below is on the base type.

      The Content-ID comes from fetching the attachment itself, further down,
      where the response IS a fileAttachment and carries it.
    */
    const at = await graph<{
      value: Array<{
        id: string;
        name: string;
        size: number;
        contentType: string;
        isInline?: boolean;
      }>;
    }>(
      `/me/messages/${encodeURIComponent(id)}/attachments` +
        `?$select=id,name,size,contentType,isInline`
    );

    // Only the real ones. An Outlook signature's logo is an attachment by the
    // same mechanism as a packing list, and listing it as though somebody sent
    // a file called image001.png is noise on every message from that sender.
    full.attachments = at.value
      .filter((a) => !isEmbeddedImage(a))
      .map((a) => ({ id: a.id, name: a.name, size: a.size, contentType: a.contentType }));

    full.body.content = await resolveInlineImages(id, full.body.content, at.value);
  }
  return full;
}

/**
 * Turns `cid:` references into data URIs the browser can actually draw.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BODY IS REWRITTEN HERE AND NOT IN THE VIEW
 *
 * Because `cid:` is not a scheme a browser resolves. It names an attachment
 * that travelled with the message, and the bytes come from a second Graph call.
 * MailBody used to delete these images — correctly, given that nothing had
 * fetched the bytes — which is why every signature arrived without its logo.
 *
 * Resolving them at fetch time means the body handed to the view is already
 * complete, and MailBody's removal of unresolved `cid:` images stays as the
 * right fallback for the ones this could not get.
 *
 * WHY THERE IS A SIZE CAP
 *
 * A data URI is base64, so it costs about a third more than the bytes and it
 * lives in the HTML string rather than in a cache. A signature logo is a few
 * kilobytes and worth it. Somebody's 8MB inline screenshot is not: it would be
 * carried in memory, re-parsed by DOMPurify on every render, and inlined again
 * in the quoted copy of every reply underneath it.
 *
 * Over the cap the image is left as `cid:` and MailBody drops it, which is the
 * behaviour everything had before this existed.
 * ---------------------------------------------------------------------------
 */
const INLINE_IMAGE_CAP = 512 * 1024;

async function resolveInlineImages(
  messageId: string,
  html: string,
  attachments: Array<{
    id: string;
    contentType: string;
    size: number;
    isInline?: boolean;
  }>
): Promise<string> {
  const wanted = attachments.filter((a) => isEmbeddedImage(a) && a.size <= INLINE_IMAGE_CAP);
  if (!wanted.length || !html.includes("cid:")) return html;

  const resolved = await Promise.all(
    wanted.map(async (a) => {
      try {
        // No $select: this response is a fileAttachment, and contentId and
        // contentBytes are both on it. Naming fields here would put the same
        // derived-property problem back, one level down.
        const one = await graph<{ contentBytes?: string; contentId?: string | null }>(
          `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.id)}`
        );
        if (!one.contentBytes || !one.contentId) return null;
        return { cid: one.contentId, uri: `data:${a.contentType};base64,${one.contentBytes}` };
      } catch {
        // One logo that will not load is not a reason to fail the message.
        return null;
      }
    })
  );

  return rewriteCidImages(
    html,
    resolved.filter((r): r is ResolvedImage => r !== null)
  );
}

export async function setRead(_mailbox: string, id: string, isRead: boolean): Promise<void> {
  touchOpened(id, { isRead });
  await graph(`/me/messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead }),
  });
}

/** Flagged for follow-up, or the flag taken off. */
export async function setFlag(id: string, flagged: boolean): Promise<void> {
  touchOpened(id, { flagged });
  await graph(`/me/messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ flag: { flagStatus: flagged ? "flagged" : "notFlagged" } }),
  });
}

/**
 * Moves a message and says the id it has now: Graph gives a moved message a new
 * one, and a snooze has to keep the id that moves it back. A message no longer
 * there (moved or deleted in Outlook meanwhile) is `null`, not an error.
 */
export async function moveToFolder(id: string, destinationId: string): Promise<string | null> {
  touchOpened(id);
  // `destinationId` is a folder's Graph id or a well-known name ("inbox").
  const r = await graphFetch(`${GRAPH}/me/messages/${encodeURIComponent(id)}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destinationId }),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Outlook returned ${r.status}`);
  return ((await r.json()) as { id: string }).id;
}

/**
 * The "Snoozed" folder in this mailbox, made the first time it is needed.
 * Outlook's own snooze keeps mail in a folder of that name too, so a snooze
 * set here is found where Outlook users expect it.
 */
const snoozedIds = new Map<string, Promise<string>>();
export function snoozedFolderId(mailbox: string): Promise<string> {
  const kept = snoozedIds.get(mailbox);
  if (kept) return kept;
  const found = (async () => {
    const hit = await graph<{ value: Array<{ id: string }> }>(
      `/me/mailFolders?$filter=${encodeURIComponent("displayName eq 'Snoozed'")}&$select=id`
    );
    if (hit.value[0]) return hit.value[0].id;
    const made = await graph<{ id: string }>("/me/mailFolders", { method: "POST", body: JSON.stringify({ displayName: "Snoozed" }) });
    return made.id;
  })();
  found.catch(() => snoozedIds.delete(mailbox));
  snoozedIds.set(mailbox, found);
  return found;
}

/**
 * Outlook's own inbox rules (Graph messageRules), run by Exchange as mail
 * arrives — whether or not anybody has the CRM open.
 *
 * They need the delegated permission MailboxSettings.ReadWrite. Every call
 * here is "soft" on 403: without the permission the rules screen says what to
 * grant, and the rest of Outlook stays connected.
 */
export interface MailRuleInput {
  displayName: string;
  isEnabled: boolean;
  fromAddresses: string[];
  subjectContains: string[];
  bodyOrSubjectContains: string[];
  hasAttachments: boolean;
  moveToFolder: FolderId | null;
  markAsRead: boolean;
  markImportant: boolean;
  deleteIt: boolean;
  stopProcessingRules: boolean;
}
export interface MailRule extends MailRuleInput {
  id: string;
  sequence: number;
}

interface GraphRule {
  id: string;
  displayName: string;
  sequence: number;
  isEnabled: boolean;
  conditions?: {
    fromAddresses?: Array<{ emailAddress: { address: string } }>;
    subjectContains?: string[];
    bodyOrSubjectContains?: string[];
    hasAttachments?: boolean;
  };
  actions?: {
    moveToFolder?: string;
    markAsRead?: boolean;
    markImportance?: string;
    delete?: boolean;
    stopProcessingRules?: boolean;
  };
}

const RULES = "/me/mailFolders/inbox/messageRules";

export async function listRules(mailbox: string): Promise<MailRule[]> {
  const [data, ids] = await Promise.all([graph<{ value: GraphRule[] }>(RULES, {}, true), knownFolderIds(mailbox)]);
  const folderOf = (id?: string): FolderId | null => {
    if (!id) return null;
    const known = (Object.entries(ids) as Array<[KnownFolder, string]>).find(([, v]) => v === id)?.[0];
    return known && known in WELL_KNOWN ? (known as BaseFolder) : `id:${id}`;
  };
  return data.value
    .map((r) => ({
      id: r.id,
      sequence: r.sequence,
      displayName: r.displayName,
      isEnabled: r.isEnabled,
      fromAddresses: (r.conditions?.fromAddresses ?? []).map((a) => a.emailAddress.address),
      subjectContains: r.conditions?.subjectContains ?? [],
      bodyOrSubjectContains: r.conditions?.bodyOrSubjectContains ?? [],
      hasAttachments: !!r.conditions?.hasAttachments,
      moveToFolder: folderOf(r.actions?.moveToFolder),
      markAsRead: !!r.actions?.markAsRead,
      markImportant: r.actions?.markImportance === "high",
      deleteIt: !!r.actions?.delete,
      stopProcessingRules: !!r.actions?.stopProcessingRules,
    }))
    .sort((a, b) => a.sequence - b.sequence);
}

export async function createRule(mailbox: string, input: MailRuleInput, sequence: number): Promise<void> {
  const ids = await knownFolderIds(mailbox);
  const folderId = (f: FolderId) => (isOwn(f) ? f.slice(3) : ids[f as KnownFolder]);
  const conditions: GraphRule["conditions"] = {};
  if (input.fromAddresses.length) conditions.fromAddresses = input.fromAddresses.map((address) => ({ emailAddress: { address } }));
  if (input.subjectContains.length) conditions.subjectContains = input.subjectContains;
  if (input.bodyOrSubjectContains.length) conditions.bodyOrSubjectContains = input.bodyOrSubjectContains;
  if (input.hasAttachments) conditions.hasAttachments = true;
  const actions: GraphRule["actions"] = {};
  if (input.moveToFolder) {
    const to = folderId(input.moveToFolder);
    if (!to) throw new Error("That folder could not be found in this mailbox.");
    actions.moveToFolder = to;
  }
  if (input.markAsRead) actions.markAsRead = true;
  if (input.markImportant) actions.markImportance = "high";
  if (input.deleteIt) actions.delete = true;
  if (input.stopProcessingRules) actions.stopProcessingRules = true;
  await graph(RULES, { method: "POST", body: JSON.stringify({ displayName: input.displayName, sequence, isEnabled: input.isEnabled, conditions, actions }) }, true);
}

export async function setRuleEnabled(id: string, isEnabled: boolean): Promise<void> {
  await graph(`${RULES}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ isEnabled }) }, true);
}

export async function deleteRule(id: string): Promise<void> {
  await graph(`${RULES}/${encodeURIComponent(id)}`, { method: "DELETE" }, true);
}

/** To Deleted Items, as Outlook's Delete does — recoverable there, not gone. */
export async function deleteMessage(id: string): Promise<void> {
  touchOpened(id);
  await graph(`/me/messages/${encodeURIComponent(id)}/move`, {
    method: "POST",
    body: JSON.stringify({ destinationId: "deleteditems" }),
  });
}

/**
 * Keeps what is written as a draft in Outlook, unsent.
 *
 * A reply or a forward is started from Graph's own createReply / createForward,
 * so the draft is already in its thread when it is finished later — in Outlook
 * or here. A draft being edited is written over.
 */
export async function saveDraft(input: {
  draftId?: string;
  replyToId?: string;
  forwardOfId?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  content: string;
  attachments?: OutgoingAttachment[];
}): Promise<void> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
  const out = await outgoing(input.content, input.attachments);
  const files = attachmentPayload(out.attachments).attachments ?? [];

  let id = input.draftId;
  if (!id) {
    const made = await graph<{ id: string }>(
      input.replyToId
        ? `/me/messages/${encodeURIComponent(input.replyToId)}/createReply`
        : input.forwardOfId
          ? `/me/messages/${encodeURIComponent(input.forwardOfId)}/createForward`
          : "/me/messages",
      { method: "POST", body: input.replyToId || input.forwardOfId ? undefined : JSON.stringify({ subject: input.subject }) }
    );
    id = made.id;
  }
  const at = `/me/messages/${encodeURIComponent(id)}`;
  await graph(at, {
    method: "PATCH",
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "HTML", content: asOutgoingHtml(out.content) },
      toRecipients: recipients(input.to),
      ccRecipients: recipients(input.cc ?? []),
      ...(input.bcc?.length ? { bccRecipients: recipients(input.bcc) } : {}),
    }),
  });
  for (const f of files) {
    await graph(`${at}/attachments`, { method: "POST", body: JSON.stringify(f) });
  }
}

export async function moveMessage(
  _mailbox: string,
  id: string,
  folder: FolderId
): Promise<void> {
  touchOpened(id);
  await graph(`/me/messages/${encodeURIComponent(id)}/move`, {
    method: "POST",
    body: JSON.stringify({ destinationId: destinationOf(folder) }),
  });
}

/**
 * Sends, and says which conversation it started.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT /me/sendMail
 *
 * Because it answers 202 with an empty body. The message is gone and there is
 * no id, no conversation, nothing to file against — which is fine for a reply
 * somebody typed and useless for a request whose whole point is to recognise
 * the answer when it arrives.
 *
 * Creating the draft first returns the message, conversation id included. The
 * id changes when it moves to Sent Items, so it is not worth keeping; the
 * CONVERSATION id does not, and that is the one the partner's reply will carry.
 * ---------------------------------------------------------------------------
 */
/**
 * A file to go out on a message.
 *
 * `contentBytes` is base64 WITHOUT the `data:` prefix, which is what Graph
 * wants and is not what `FileReader.readAsDataURL` produces — see
 * `bytesToBase64` in services/attachments.ts, which is the one place that
 * conversion happens.
 */
export interface OutgoingAttachment {
  name: string;
  contentType: string;
  contentBytes: string;
  /** Shown in the body as `cid:<contentId>` rather than listed as a file. */
  isInline?: boolean;
  contentId?: string;
}

/**
 * Graph's ceiling for attaching files to a message in the request itself.
 *
 * ---------------------------------------------------------------------------
 * Above roughly 3MB the attachment has to go up through an upload session:
 * create it, PUT the bytes in ranges, then send. That is a different and much
 * longer code path, and the documents this desk sends are a few pages of
 * generated PDF — far under it.
 *
 * So the limit is enforced rather than worked around, and it is checked
 * BEFORE the draft is created. Graph's own failure arrives after the draft
 * exists, which would leave an unsent draft in the mailbox for every oversized
 * attachment somebody tried — and the error it returns names a request size
 * rather than a file, so nobody would know which one.
 * ---------------------------------------------------------------------------
 */
const ATTACHMENT_CAP = 3 * 1024 * 1024;

/** The `attachments` array for a Graph message, or nothing when there are none. */
function attachmentPayload(list: OutgoingAttachment[] | undefined) {
  if (!list?.length) return {};

  // base64 is 4 characters per 3 bytes; this is the size of what actually goes
  // over the wire, which is the thing Graph measures.
  const total = list.reduce((n, a) => n + a.contentBytes.length, 0);
  if (total > ATTACHMENT_CAP) {
    const biggest = [...list].sort((a, b) => b.contentBytes.length - a.contentBytes.length)[0];
    throw new Error(
      `Attachments come to ${(total / 1024 / 1024).toFixed(1)}MB, over the 3MB a single mail can carry. ` +
        `The largest is ${biggest.name}. Send it from Outlook, or send fewer at a time.`
    );
  }

  return {
    attachments: list.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
      ...(a.isInline ? { isInline: true, contentId: a.contentId } : {}),
    })),
  };
}

/**
 * The body and attachments as they go: our pictures carried inside the message.
 *
 * ---------------------------------------------------------------------------
 * A picture that is only a link shows as a blank box in Outlook until the
 * reader chooses "download pictures". So every picture of ours — the logo
 * (/brand/…, lib/inlineBrand.ts) and anything put into a mail or signature
 * from the editor (the project's public storage) — goes as an inline
 * attachment and is referred to as cid:. Anything else is left as it is:
 * this does not reach out to fetch arbitrary addresses.
 *
 * Inline pictures count towards the 3MB a mail can carry. They are taken in
 * order while they fit beside the files attached; one that would not fit is
 * left as its link, which still shows once pictures are allowed, rather than
 * failing the send.
 *
 * And each picture gets a width attribute if it has none: Outlook ignores
 * max-width and draws a picture at its own pixel size, so a screenshot shown
 * at 640 in the editor would arrive at 1920.
 * ---------------------------------------------------------------------------
 */
async function outgoing(content: string, attachments: OutgoingAttachment[] | undefined): Promise<{ content: string; attachments: OutgoingAttachment[] }> {
  const origin = window.location.origin;
  const storage = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/`;
  const brand = new Map(brandImages(content, origin).map((b) => [b.src, b]));
  const doc = new DOMParser().parseFromString(`<body>${content}</body>`, "text/html");

  let budget = ATTACHMENT_CAP - (attachments ?? []).reduce((n, a) => n + a.contentBytes.length, 0);
  const inline: OutgoingAttachment[] = [];
  const cids = new Map<string, string>();
  let n = 0;

  for (const img of Array.from(doc.body.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    let url: URL;
    try {
      url = new URL(src, origin);
    } catch {
      continue;
    }
    const logo = brand.get(src);
    const ours = !!logo || url.href.startsWith(storage);
    let bytes: Uint8Array | null = null;

    if (ours && !cids.has(src)) {
      try {
        const r = await fetch(url.toString());
        if (r.ok) {
          bytes = new Uint8Array(await r.arrayBuffer());
          const b64 = bytesToBase64(bytes);
          if (b64.length <= budget) {
            budget -= b64.length;
            const file = logo?.file ?? `image${++n}.${(url.pathname.split(".").pop() || "png").toLowerCase()}`;
            const contentId = logo?.contentId ?? `${file.replace(/\.[^.]+$/, "")}.${Date.now().toString(36)}@aashish-logistics`;
            inline.push({ name: file, contentType: r.headers.get("content-type")?.split(";")[0] || imageType(file), contentBytes: b64, isInline: true, contentId });
            cids.set(src, contentId);
          }
        }
      } catch {
        // Left as a link.
      }
    }

    if (!img.getAttribute("width")) {
      const own = await pixelWidth(bytes, url.toString());
      const cap = Number((img.getAttribute("style") ?? "").match(/max-width\s*:\s*([\d.]+)px/i)?.[1]) || MAIL_IMAGE_MAX;
      if (own) img.setAttribute("width", String(Math.min(own, cap)));
    }
  }
  doc.body.querySelectorAll("img").forEach((img) => {
    const cid = cids.get(img.getAttribute("src") ?? "");
    if (cid) img.setAttribute("src", `cid:${cid}`);
  });
  return { content: doc.body.innerHTML, attachments: [...(attachments ?? []), ...inline] };
}

/** A picture's own width, from its bytes or failing that by loading it; null if neither works in 5s. */
async function pixelWidth(bytes: Uint8Array | null, url: string): Promise<number | null> {
  if (bytes) {
    try {
      const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
      const w = bmp.width;
      bmp.close();
      return w;
    } catch {
      /* fall through to loading it */
    }
  }
  return new Promise((resolve) => {
    const img = new Image();
    const t = window.setTimeout(() => resolve(null), 5000);
    img.onload = () => {
      window.clearTimeout(t);
      resolve(img.naturalWidth || null);
    };
    img.onerror = () => {
      window.clearTimeout(t);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * The bytes of one attachment on one message.
 *
 * Fetched to be copied elsewhere. The id is only meaningful against the
 * mailbox the token belongs to, which is exactly why anything that wants to
 * keep the file has to take the bytes rather than the reference.
 */
export async function getAttachmentBytes(
  messageId: string,
  attachmentId: string
): Promise<{ name: string; contentType: string; size: number; contentBytes: string }> {
  // No $select. contentBytes belongs to fileAttachment, a type derived from
  // attachment, and naming a derived property on the base type is a 400 —
  // the same trap the inline-image fetch documents further down.
  const a = await graph<{
    name: string;
    contentType: string;
    size: number;
    contentBytes?: string;
  }>(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);

  if (!a.contentBytes) {
    // An itemAttachment (a forwarded mail) or a referenceAttachment (a OneDrive
    // link) has no bytes of its own. Neither is a file to be filed.
    throw new Error(`"${a.name}" is not a file attachment, so there is nothing to save.`);
  }
  return { name: a.name, contentType: a.contentType, size: a.size, contentBytes: a.contentBytes };
}

export async function sendTracked(input: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  content: string;
  attachments?: OutgoingAttachment[];
}): Promise<{ conversationId: string; draftId: string }> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
  const out = await outgoing(input.content, input.attachments);

  const draft = await graph<{ id: string; conversationId: string }>("/me/messages", {
    method: "POST",
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "HTML", content: asOutgoingHtml(out.content) },
      toRecipients: recipients(input.to),
      ccRecipients: recipients(input.cc ?? []),
      ...(input.bcc?.length ? { bccRecipients: recipients(input.bcc) } : {}),
      ...attachmentPayload(out.attachments),
    }),
  });

  await graph(`/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" });

  return { conversationId: draft.conversationId, draftId: draft.id };
}

/**
 * Every message in a conversation.
 *
 * Used to find a partner's reply to a request we sent. Graph filters on
 * conversationId directly, which is the only identifier that survives the round
 * trip — subjects get rewritten and message ids change.
 *
 * Returns messages from every folder, so a reply that an inbox rule has already
 * moved somewhere is still found.
 */
/**
 * Every message involving an address, across the whole mailbox.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT listMessages WITH A QUERY
 *
 * That one is scoped to a folder, which is the right shape for the mail screen
 * — you are reading the inbox, and searching narrows the inbox. It is the wrong
 * shape for "everything we have exchanged with this agent", because half of
 * that is in Sent. Correspondence with a partner is a two-sided thing and a
 * view that shows only their half is misleading in the one way that matters:
 * it looks like nobody answered.
 *
 * WHY $search AND NOT $filter
 *
 * A filter would have to name every field an address can appear in — from,
 * toRecipients, ccRecipients — and `toRecipients/any(...)` collections are
 * exactly where Graph's filter support gets thin.
 *
 * THE QUERY IS KQL, AND THE CALLER WRITES IT
 *
 * `$search` on messages is interpreted as KQL, so `participants:"x@y.com"`
 * matches the from, to, cc and bcc fields and a bare `"x@y.com"` matches the
 * indexed text — subject and body.
 *
 * Those two are not interchangeable, and getting it wrong is quiet. A bare
 * phrase does NOT reliably match an address that appears only in a recipient
 * field, so searching a partner's address as free text finds the mail they sent
 * us and misses most of what we sent them. Half an exchange, reading as though
 * nobody ever replied.
 *
 * So this takes the query as written rather than wrapping it in quotes and
 * deciding for the caller. `participants:` is what correspondence means;
 * the bare phrase is a different question and belongs to whoever is asking it.
 *
 * WHY THE FOLDER IS INBOX FOR EVERYTHING
 *
 * The query spans folders and Graph does not say which one each result came
 * from. Nothing on the partner screen reads the folder — it is used to build a
 * link back into the mail view, and inbox is the one that resolves. Getting a
 * message by id does not depend on it either.
 * ---------------------------------------------------------------------------
 */
export async function searchMailbox(mailbox: string, kql: string): Promise<MailMessage[]> {
  const q = kql.trim();
  if (!q) return [];

  const data = await graph<{ value: GraphMessage[] }>(
    `/me/messages?$top=50&$select=${LIST_SELECT}&$search=${encodeURIComponent(q)}`,
    // Required for $search on messages, same as the folder-scoped search.
    { headers: { ConsistencyLevel: "eventual" } }
  );

  return data.value.map((m) => adapt(m, mailbox, "inbox"));
}

/** `participants:"a@b.com"` — the from, to, cc and bcc of every message. */
export const participantsQuery = (address: string) =>
  `participants:"${address.trim().replace(/"/g, "")}"`;

/** A bare phrase — subject and body, not the recipient fields. */
export const mentionsQuery = (address: string) => `"${address.trim().replace(/"/g, "")}"`;

/**
 * The ids behind the folders a conversation is sorted by, per mailbox.
 *
 * A message's parentFolderId is an opaque id that differs from one mailbox to
 * the next, so the well-known names are resolved once and compared against. A
 * folder that cannot be resolved (no Archive yet) is simply left out; a mailbox
 * where none could be is not remembered, so the next conversation asks again.
 */
type KnownFolder = "inbox" | "sent" | "drafts" | "archive" | "deleted" | "junk";
const KNOWN_FOLDER: Record<KnownFolder, string> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
  archive: "archive",
  deleted: "deleteditems",
  junk: "junkemail",
};
const knownIds = new Map<string, Promise<Partial<Record<KnownFolder, string>>>>();

function knownFolderIds(mailbox: string): Promise<Partial<Record<KnownFolder, string>>> {
  const kept = knownIds.get(mailbox);
  if (kept) return kept;
  const asked = Promise.all(
    (Object.keys(KNOWN_FOLDER) as KnownFolder[]).map((k) =>
      graph<{ id: string }>(`/me/mailFolders/${KNOWN_FOLDER[k]}?$select=id`)
        .then((f) => [k, f.id] as const)
        .catch(() => [k, ""] as const)
    )
  ).then((pairs) => {
    const found = Object.fromEntries(pairs.filter(([, id]) => id)) as Partial<Record<KnownFolder, string>>;
    if (!Object.keys(found).length) knownIds.delete(mailbox);
    return found;
  });
  knownIds.set(mailbox, asked);
  return asked;
}

/**
 * Every message in one conversation, wherever it sits — Inbox, Sent, Archive.
 *
 * What the Mail page's conversation view and the case file read a thread from.
 * Deleted and junk messages are left out, as Outlook leaves them out of its own
 * conversation view, and each message says which folder it is in, so the page
 * can tell what was sent from here from what arrived.
 *
 * Unordered: Graph refuses $orderby alongside a conversationId filter, so the
 * caller sorts. A hundred is more than any freight thread runs to.
 */
export async function messagesInConversation(
  mailbox: string,
  conversationId: string
): Promise<MailMessage[]> {
  const [data, ids] = await Promise.all([
    graph<{ value: Array<GraphMessage & { parentFolderId?: string }> }>(
      `/me/messages?$select=${LIST_SELECT},parentFolderId` +
        `&$filter=conversationId eq '${conversationId.replace(/'/g, "''")}'` +
        `&$top=100`
    ),
    knownFolderIds(mailbox),
  ]);
  const folderOf = (id?: string): FolderId =>
    !id ? "inbox" : id === ids.sent ? "sent" : id === ids.drafts ? "drafts" : id === ids.archive ? "archive" : "inbox";
  // Drafts are left out too: an unsent draft in a customer's thread read, on the
  // case file, exactly like a mail that had gone to them.
  return data.value
    .filter((m) => !m.isDraft)
    .filter((m) => !m.parentFolderId || (m.parentFolderId !== ids.deleted && m.parentFolderId !== ids.junk))
    .map((m) => adapt(m, mailbox, folderOf(m.parentFolderId)));
}

/**
 * Sends a draft that already exists in the mailbox (one started in Outlook),
 * with whatever was changed in the compose window.
 *
 * The draft is updated and then sent, rather than a copy sent and the draft
 * left behind: it keeps the attachments already on it, it keeps its place in
 * a thread if it was a reply, and the Drafts folder does not keep a copy of a
 * mail that has gone. Bcc is only written when one was given, so a Bcc set in
 * Outlook — which the compose window cannot see — is not wiped.
 */
export async function sendDraft(input: {
  draftId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  content: string;
  attachments?: OutgoingAttachment[];
}): Promise<void> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
  const out = await outgoing(input.content, input.attachments);
  const files = attachmentPayload(out.attachments).attachments ?? [];
  const at = `/me/messages/${encodeURIComponent(input.draftId)}`;

  await graph(at, {
    method: "PATCH",
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "HTML", content: asOutgoingHtml(out.content) },
      toRecipients: recipients(input.to),
      ccRecipients: recipients(input.cc ?? []),
      ...(input.bcc?.length ? { bccRecipients: recipients(input.bcc) } : {}),
    }),
  });
  // Added one by one, so the attachments already on the draft stay.
  for (const f of files) {
    await graph(`${at}/attachments`, { method: "POST", body: JSON.stringify(f) });
  }
  await graph(`${at}/send`, { method: "POST" });
}

/**
 * Replies to a message, in its own thread, with the body as composed.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG
 *
 * Replies were going out through /me/sendMail as fresh messages. That endpoint
 * starts a new conversation and sets no In-Reply-To or References headers, so
 * however right the "Re:" subject looked in our own list, the recipient's
 * client had nothing to thread on and filed it as a separate exchange. A
 * customer with a running quotation thread got a second, unrelated-looking
 * message every time the desk answered.
 *
 * WHY createReply AND NOT /reply
 *
 * /reply takes a `comment` and lets Graph build the body — it appends its own
 * quoted copy of the original underneath. Our compose box has already built the
 * body, quote and all, so that route would send the thread twice.
 *
 * createReply hands back a DRAFT that already carries the conversation id and
 * the threading headers, and whose body we are free to replace. Overwriting it
 * and sending is the only way to get correct threading and still send exactly
 * what the person saw in the editor.
 *
 * WHY THE RECIPIENTS ARE SET EXPLICITLY
 *
 * createReply addresses the original sender. That is usually right and is
 * sometimes not — the operator may have added a colleague, removed somebody, or
 * redirected it entirely — so what they typed wins over what Graph assumed.
 * ---------------------------------------------------------------------------
 */
export async function replyTracked(input: {
  replyToId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  content: string;
  attachments?: OutgoingAttachment[];
}): Promise<{ conversationId: string }> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));

  // Before the draft exists, so an oversized attachment does not leave one
  // behind in the mailbox.
  const out = await outgoing(input.content, input.attachments);
  const files = attachmentPayload(out.attachments).attachments ?? [];

  const draft = await graph<{ id: string; conversationId: string }>(
    `/me/messages/${encodeURIComponent(input.replyToId)}/createReply`,
    { method: "POST" }
  );
  const at = `/me/messages/${encodeURIComponent(draft.id)}`;

  await graph(at, {
    method: "PATCH",
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "HTML", content: asOutgoingHtml(out.content) },
      toRecipients: recipients(input.to),
      ccRecipients: recipients(input.cc ?? []),
      bccRecipients: recipients(input.bcc ?? []),
    }),
  });

  /*
    Each file posted onto the draft, as a forward's are.

    Graph does not add attachments through a PATCH of the message: they were
    in the PATCH body and it ignored them, so every reply went without its
    files — a quotation in the customer's thread left without its PDF, and
    without the logo, which travels as an inline attachment the letter points
    at by cid: (1 Oct, ALG09014-26).
  */
  for (const f of files) {
    await graph(`${at}/attachments`, { method: "POST", body: JSON.stringify(f) });
  }

  await graph(`${at}/send`, { method: "POST" });

  return { conversationId: draft.conversationId };
}

/**
 * A forward, through Graph's own forward so the original's attachments go
 * with it — and its inline pictures, which the quoted copy in the body
 * refers to by cid:.
 *
 * The draft Graph makes already holds those files; anything added in the CRM
 * is posted onto it one by one rather than written over its attachment list.
 */
export async function forwardTracked(input: {
  forwardOfId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  content: string;
  attachments?: OutgoingAttachment[];
}): Promise<{ conversationId: string }> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
  const out = await outgoing(input.content, input.attachments);
  const files = attachmentPayload(out.attachments).attachments ?? [];

  const draft = await graph<{ id: string; conversationId: string }>(
    `/me/messages/${encodeURIComponent(input.forwardOfId)}/createForward`,
    { method: "POST" }
  );
  const at = `/me/messages/${encodeURIComponent(draft.id)}`;
  await graph(at, {
    method: "PATCH",
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "HTML", content: asOutgoingHtml(out.content) },
      toRecipients: recipients(input.to),
      ccRecipients: recipients(input.cc ?? []),
      bccRecipients: recipients(input.bcc ?? []),
    }),
  });
  for (const f of files) {
    await graph(`${at}/attachments`, { method: "POST", body: JSON.stringify(f) });
  }
  await graph(`${at}/send`, { method: "POST" });
  return { conversationId: draft.conversationId };
}

/**
 * A new message, starting its own conversation.
 *
 * Replies do NOT come through here — they go to `replyTracked`, which is the
 * only path that sets the threading headers. This used to take a `replyToId`
 * and branch to /reply, and the branch was dead: nothing passed one, so every
 * reply fell through to /me/sendMail and started a fresh conversation. The
 * parameter is gone rather than left as a route that looks like it threads.
 */
export async function sendMessage(input: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  content: string;
  attachments?: OutgoingAttachment[];
}): Promise<void> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
  const out = await outgoing(input.content, input.attachments);

  await graph("/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: input.subject,
        // HTML rather than plain text, to match what Outlook itself sends.
        // A bare text/plain message from a domain with no sending history is
        // among the easiest things for a strict receiver to reject, and the
        // same message composed in Outlook Web -- same sender, same recipient --
        // was being delivered where this one was not.
        body: { contentType: "HTML", content: asOutgoingHtml(out.content) },
        toRecipients: recipients(input.to),
        // Omitted entirely when empty. An explicit empty array is legal but
        // there is no reason to send a header nobody asked for.
        ...(input.cc?.length ? { ccRecipients: recipients(input.cc) } : {}),
        ...(input.bcc?.length ? { bccRecipients: recipients(input.bcc) } : {}),
        ...attachmentPayload(out.attachments),
      },
      saveToSentItems: true,
    }),
  });
}

/** One sent message, as the mail log keeps it (086). */
export interface SentItem {
  graph_id: string;
  internet_message_id: string;
  conversation_id: string;
  sent_at: string;
  subject: string;
  preview: string;
  to: Array<{ name: string; address: string }>;
  cc: Array<{ name: string; address: string }>;
  has_attachments: boolean;
}

/**
 * Everything this mailbox has sent since a moment, newest first, from Sent
 * Items — so mail sent from Outlook itself is included, not only mail sent
 * from the CRM. Stops after `maxPages` of fifty; the next copy picks up where
 * this one ended.
 */
export async function sentSince(sinceIso: string, maxPages = 10): Promise<SentItem[]> {
  const select = "id,internetMessageId,conversationId,subject,bodyPreview,toRecipients,ccRecipients,sentDateTime,hasAttachments";
  const since = sinceIso.replace(/\.\d{3}Z$/, "Z");
  let path: string | undefined =
    `/me/mailFolders/sentitems/messages?$top=50&$select=${select}` +
    `&$filter=${encodeURIComponent(`sentDateTime ge ${since}`)}&$orderby=${encodeURIComponent("sentDateTime desc")}`;
  const who = (r?: { emailAddress: { name?: string; address?: string } }) => ({
    name: r?.emailAddress?.name ?? "",
    address: (r?.emailAddress?.address ?? "").toLowerCase(),
  });
  const out: SentItem[] = [];
  for (let page = 0; path && page < maxPages; page++) {
    const data: {
      value: Array<GraphMessage & { internetMessageId?: string; sentDateTime?: string }>;
      "@odata.nextLink"?: string;
    } = await graph(path);
    for (const m of data.value) {
      if (!m.internetMessageId || !m.sentDateTime) continue;
      out.push({
        graph_id: m.id,
        internet_message_id: m.internetMessageId,
        conversation_id: m.conversationId,
        sent_at: m.sentDateTime,
        subject: m.subject ?? "",
        preview: m.bodyPreview ?? "",
        to: (m.toRecipients ?? []).map(who),
        cc: (m.ccRecipients ?? []).map(who),
        has_attachments: m.hasAttachments,
      });
    }
    path = data["@odata.nextLink"];
  }
  return out;
}

/** The address Microsoft says this token belongs to — used to label the mailbox. */
export async function whoami(): Promise<string | null> {
  try {
    const me = await graph<{ mail?: string; userPrincipalName?: string }>(
      "/me?$select=mail,userPrincipalName"
    );
    return me.mail ?? me.userPrincipalName ?? null;
  } catch {
    return null;
  }
}
