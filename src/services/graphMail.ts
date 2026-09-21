import { supabase } from "../lib/supabase";
import type { FolderId, MailMessage, Recipient } from "./mockMail";

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
 * Microsoft's -- so the token is stashed at sign-in and, when Graph answers 401,
 * the mailbox reports that it needs reconnecting rather than silently showing
 * nothing. Signing in again is the fix, and is one click.
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

export function storeGraphToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearGraphToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function hasGraphToken(): boolean {
  return !!sessionStorage.getItem(TOKEN_KEY);
}

/** Thrown when Microsoft rejects the token, so the UI can offer a reconnect. */
export class GraphAuthError extends Error {
  constructor(message = "Your Outlook connection has expired. Sign in again to reconnect.") {
    super(message);
    this.name = "GraphAuthError";
  }
}

async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) throw new GraphAuthError("Outlook is not connected on this session.");

  const r = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  // 401 is an expired or revoked token; 403 is a permission the app was never
  // granted. Both mean "reconnect", and neither is worth a stack trace at the user.
  if (r.status === 401 || r.status === 403) {
    clearGraphToken();
    throw new GraphAuthError();
  }

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
 * `graph()` — which prefixes the v1.0 base and would produce a doubled URL. The
 * token handling is repeated here deliberately for that one reason.
 */
export async function listMore(
  mailbox: string,
  folder: FolderId,
  nextLink: string
): Promise<MessagePage> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) throw new GraphAuthError("Outlook is not connected on this session.");

  // Only ever a link Graph itself produced, and only against Graph's own host.
  if (!nextLink.startsWith("https://graph.microsoft.com/")) {
    throw new Error("Refusing to follow a page link that is not Microsoft Graph.");
  }

  const r = await fetch(nextLink, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401 || r.status === 403) {
    clearGraphToken();
    throw new GraphAuthError();
  }
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

  if (m.hasAttachments) {
    const at = await graph<{ value: Array<{ name: string; size: number; contentType: string }> }>(
      `/me/messages/${encodeURIComponent(id)}/attachments?$select=name,size,contentType`
    );
    full.attachments = at.value.map((a) => ({
      name: a.name,
      size: a.size,
      contentType: a.contentType,
    }));
  }
  return full;
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
export async function sendTracked(input: {
  to: string[];
  cc?: string[];
  subject: string;
  content: string;
}): Promise<{ conversationId: string; draftId: string }> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));

  const draft = await graph<{ id: string; conversationId: string }>("/me/messages", {
    method: "POST",
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "HTML", content: asOutgoingHtml(input.content) },
      toRecipients: recipients(input.to),
      ccRecipients: recipients(input.cc ?? []),
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
 * exactly where Graph's filter support gets thin. $search covers all of them,
 * plus the body, which is what finds the thread where somebody was added
 * halfway through.
 *
 * It is a looser match, deliberately. A message that merely mentions the
 * address is a message about this partner, and on this screen that is a useful
 * thing to be shown rather than a false positive.
 *
 * WHY THE FOLDER IS INBOX FOR EVERYTHING
 *
 * The query spans folders and Graph does not say which one each result came
 * from. Nothing on the partner screen reads the folder — it is used to build a
 * link back into the mail view, and inbox is the one that resolves. Getting a
 * message by id does not depend on it either.
 * ---------------------------------------------------------------------------
 */
export async function searchMailbox(mailbox: string, query: string): Promise<MailMessage[]> {
  const q = query.trim();
  if (!q) return [];

  const data = await graph<{ value: GraphMessage[] }>(
    `/me/messages?$top=50&$select=${LIST_SELECT}&$search=${encodeURIComponent(`"${q}"`)}`,
    // Required for $search on messages, same as the folder-scoped search.
    { headers: { ConsistencyLevel: "eventual" } }
  );

  return data.value.map((m) => adapt(m, mailbox, "inbox"));
}

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
}): Promise<{ conversationId: string }> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));

  const draft = await graph<{ id: string; conversationId: string }>(
    `/me/messages/${encodeURIComponent(input.replyToId)}/createReply`,
    { method: "POST" }
  );

  await graph(`/me/messages/${encodeURIComponent(draft.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "HTML", content: asOutgoingHtml(input.content) },
      toRecipients: recipients(input.to),
      ccRecipients: recipients(input.cc ?? []),
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
}): Promise<void> {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));

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
        body: { contentType: "HTML", content: asOutgoingHtml(input.content) },
        toRecipients: recipients(input.to),
        // Omitted entirely when empty. An explicit empty array is legal but
        // there is no reason to send a header nobody asked for.
        ...(input.cc?.length ? { ccRecipients: recipients(input.cc) } : {}),
      },
      saveToSentItems: true,
    }),
  });
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

/** Captures the Microsoft token Supabase returns after the OAuth round trip. */
export async function captureGraphTokenFromSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = (data.session as { provider_token?: string } | null)?.provider_token;
  if (token) storeGraphToken(token);
}
