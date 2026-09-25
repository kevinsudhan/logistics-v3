import { supabase } from "../lib/supabase";
import { bytesToBase64 } from "../lib/base64";
import { brandImages, imageType, withContentIds } from "../lib/inlineBrand";
import type { FolderId, MailMessage, Recipient } from "./mockMail";
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

/**
 * Where the Microsoft token is kept.
 *
 * sessionStorage, alongside the Supabase session and for the same reason: desk
 * machines are shared, and a mailbox token must not outlive the browser tab.
 */
const TOKEN_KEY = "araxys.graphToken";
/** When that token runs out (epoch ms); absent while its lifetime is unknown. */
const EXPIRES_KEY = "araxys.graphTokenExpires";
/** Which sign-in's refresh token the server already holds, so a reload does not hand it over again. */
const LINKED_KEY = "araxys.outlookLinked";

export function storeGraphToken(token: string | null, expiresInSeconds?: number) {
  if (!token) return;
  sessionStorage.setItem(TOKEN_KEY, token);
  if (expiresInSeconds) sessionStorage.setItem(EXPIRES_KEY, String(Date.now() + expiresInSeconds * 1000));
  else sessionStorage.removeItem(EXPIRES_KEY);
}

export function clearGraphToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRES_KEY);
  sessionStorage.removeItem(LINKED_KEY);
  adopted = null;
}

export function hasGraphToken(): boolean {
  return !!sessionStorage.getItem(TOKEN_KEY);
}

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
async function graphFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const call = (token: string) =>
    fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } });
  let r = await call(await usableToken());
  if (r.status === 401) r = await call(await renew());

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

async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  // A path, or a next-page link Graph itself handed back (and only Graph's).
  const url = path.startsWith("https://graph.microsoft.com/") ? path : `${GRAPH}${path}`;
  const r = await graphFetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...((init.headers as Record<string, string> | undefined) ?? {}) },
  });

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
const WELL_KNOWN: Record<FolderId, string> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
  archive: "archive",
};

const FOLDER_LABEL: Record<FolderId, string> = {
  inbox: "Inbox",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
};

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
 * ---------------------------------------------------------------------------
 */
const SEND_FONT = "'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";

function asOutgoingHtml(content: string): string {
  return (
    `<div style="font-family:${SEND_FONT};font-size:10.5pt;color:#14150f">` +
    content +
    `</div>`
  );
}

export async function listFolders(mailbox: string): Promise<MailFolder[]> {
  const data = await graph<{ value: GraphFolder[] }>(
    "/me/mailFolders?$top=60&$select=id,displayName,totalItemCount,unreadItemCount"
  );

  // Match Graph's folders to ours by display name, so a mailbox in another
  // language or with renamed folders degrades to zeroes rather than throwing.
  const byName = new Map(data.value.map((f) => [f.displayName.toLowerCase(), f]));
  const lookup: Record<FolderId, string[]> = {
    inbox: ["inbox"],
    sent: ["sent items", "sent"],
    drafts: ["drafts"],
    archive: ["archive"],
  };

  return (Object.keys(WELL_KNOWN) as FolderId[]).map((id) => {
    const hit = lookup[id].map((n) => byName.get(n)).find(Boolean);
    return {
      id,
      label: FOLDER_LABEL[id],
      total: hit?.totalItemCount ?? 0,
      unread: id === "inbox" ? hit?.unreadItemCount ?? 0 : 0,
    };
  });
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
  "id,conversationId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,isDraft,hasAttachments,importance";

export async function listMessages(
  mailbox: string,
  folder: FolderId,
  q?: string
): Promise<MessagePage> {
  // $search and $orderby cannot be combined in Graph; search results come back
  // by relevance, which is the right order for a search anyway.
  const path = q?.trim()
    ? `/me/mailFolders/${WELL_KNOWN[folder]}/messages?$top=50&$select=${LIST_SELECT}&$search=${encodeURIComponent(`"${q.trim()}"`)}`
    : `/me/mailFolders/${WELL_KNOWN[folder]}/messages?$top=50&$select=${LIST_SELECT}&$orderby=receivedDateTime desc`;

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

export async function getMessage(
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
  await graph(`/me/messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead }),
  });
}

export async function moveMessage(
  _mailbox: string,
  id: string,
  folder: FolderId
): Promise<void> {
  await graph(`/me/messages/${encodeURIComponent(id)}/move`, {
    method: "POST",
    body: JSON.stringify({ destinationId: WELL_KNOWN[folder] }),
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
 * The body and attachments as they go: our logo carried inside the message.
 *
 * See lib/inlineBrand.ts. An image that cannot be fetched is left as the link
 * it was — a logo the reader has to click to see is still better than a send
 * that fails over it.
 */
async function outgoing(content: string, attachments: OutgoingAttachment[] | undefined): Promise<{ content: string; attachments: OutgoingAttachment[] }> {
  const found = brandImages(content, window.location.origin);
  const inline: OutgoingAttachment[] = [];
  const embedded = [];
  for (const img of found) {
    try {
      const r = await fetch(new URL(img.src, window.location.origin).toString());
      if (!r.ok) continue;
      inline.push({
        name: img.file,
        contentType: imageType(img.file),
        contentBytes: bytesToBase64(new Uint8Array(await r.arrayBuffer())),
        isInline: true,
        contentId: img.contentId,
      });
      embedded.push(img);
    } catch {
      // Left as a link.
    }
  }
  return { content: withContentIds(content, embedded), attachments: [...(attachments ?? []), ...inline] };
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

export async function messagesInConversation(
  mailbox: string,
  conversationId: string
): Promise<MailMessage[]> {
  const data = await graph<{ value: GraphMessage[] }>(
    `/me/messages?$select=${LIST_SELECT}` +
      `&$filter=conversationId eq '${conversationId.replace(/'/g, "''")}'` +
      `&$top=25`
  );
  // The folder is not knowable from this query and nothing here needs it.
  return data.value.map((m) => adapt(m, mailbox, "inbox"));
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
  subject: string;
  content: string;
  attachments?: OutgoingAttachment[];
}): Promise<{ conversationId: string }> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));

  // Before the draft exists, so an oversized attachment does not leave one
  // behind in the mailbox.
  const out = await outgoing(input.content, input.attachments);
  const files = attachmentPayload(out.attachments);

  const draft = await graph<{ id: string; conversationId: string }>(
    `/me/messages/${encodeURIComponent(input.replyToId)}/createReply`,
    { method: "POST" }
  );

  await graph(`/me/messages/${encodeURIComponent(draft.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "HTML", content: asOutgoingHtml(out.content) },
      toRecipients: recipients(input.to),
      ccRecipients: recipients(input.cc ?? []),
      ...files,
    }),
  });

  await graph(`/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" });

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
