/**
 * The mail client: Outlook through Graph once it is connected, the in-memory
 * mailbox (./mockBackend) before that.
 *
 * It was once also the client for an Express backend (server/, inherited from
 * v1, with the voice desk's calls, records and space board), switched by
 * VITE_MOCK_BACKEND and VITE_API_BASE. The server went on 26 Sep 2026 and the
 * voice-era calls, the switch and both variables on 1 Oct: nothing called them.
 * Everything else in the CRM reads and writes through Supabase directly.
 */
import { mockGet, mockPost } from "./mockBackend";

const get = <T,>(path: string) => mockGet(path) as Promise<T>;
const post = <T,>(path: string, body: unknown) => mockPost(path, body) as Promise<T>;

// ---- mail ----------------------------------------------------------------

/**
 * Outlook, through the CRM.
 *
 * Every call names the mailbox explicitly. Against real Microsoft Graph the
 * mailbox is implied by the signed-in user's token and these become
 * /me/mailFolders and /me/messages -- but keeping it an argument means the
 * scoping is something the code states rather than something it assumes, and
 * a shared desk address is never one bug away from showing someone else's mail.
 */
export type { MailMessage, Recipient, FolderId } from "./mockMail";
import type { MailMessage, FolderId } from "./mockMail";
import { allMessages } from "./mockMail";
import { readForwardChain } from "./forwardChain";
import { hasHit, plainText, searchTerms, snippetAround } from "../lib/searchHighlight";

export interface MailFolder {
  id: FolderId;
  label: string;
  total: number;
  unread: number;
  depth?: number;
  parent?: string;
}

import * as graph from "./graphMail";
import { syncSentSoon } from "./mailLog";

export { GraphAuthError, hasGraphToken, clearGraphToken, whoami } from "./graphMail";

/**
 * Real Outlook when this session has a Microsoft token, the in-memory mailbox
 * otherwise.
 *
 * The fallback is not a convenience -- it is what keeps the mail screens usable
 * for design work, and what the app shows before anyone has connected Outlook.
 * `hasGraphToken()` is checked per call rather than once at module load because
 * the token arrives after sign-in, not before this file is imported.
 */
const live = () => graph.hasGraphToken();

export const getMailFolders = async (mailbox: string) =>
  live()
    ? { folders: await graph.listFolders(mailbox) }
    : get<{ folders: MailFolder[] }>(`/api/mail/folders?mailbox=${encodeURIComponent(mailbox)}`);

export const getMailMessages = async (
  mailbox: string,
  folder: FolderId,
  q?: string,
  filter?: "unread" | "flagged"
): Promise<{ messages: MailMessage[]; nextLink?: string }> =>
  live()
    ? graph.listMessages(mailbox, folder, q, filter)
    : get<{ messages: MailMessage[] }>(
        `/api/mail/messages?mailbox=${encodeURIComponent(mailbox)}&folder=${folder}` +
          (q ? `&q=${encodeURIComponent(q)}` : "") +
          (filter ? `&filter=${filter}` : "")
      );

/**
 * Which of these messages an inbox rule forwarded here, and from whose mailbox
 * (graphMail.ruleForwarders). The in-memory mailbox carries its headers, so
 * they are read where they are.
 */
export const getRuleForwarders = async (messages: MailMessage[]): Promise<Map<string, string | null>> => {
  if (live()) return graph.ruleForwarders(messages.map((m) => m.id));
  return new Map(messages.map((m) => {
    const chain = readForwardChain(m);
    return [m.id, chain?.auto ? chain.forwardedBy : null];
  }));
};

/** Flag for follow-up, or take the flag off. */
export const setMailFlag = async (mailbox: string, id: string, flagged: boolean) => {
  if (live()) return graph.setFlag(id, flagged);
  return post(`/api/mail/messages/${encodeURIComponent(id)}/flag`, { mailbox, flagged });
};

/** To Deleted Items (recoverable there). */
export const deleteMailMessage = async (mailbox: string, id: string) => {
  if (live()) return graph.deleteMessage(id);
  return post(`/api/mail/messages/${encodeURIComponent(id)}/delete`, { mailbox });
};

/**
 * The next page of a folder. Only the live mailbox pages — the in-memory one
 * hands back everything it has in one go, so it never produces a link.
 */
export const getMoreMailMessages = async (
  mailbox: string,
  folder: FolderId,
  nextLink: string
): Promise<{ messages: MailMessage[]; nextLink?: string }> =>
  graph.listMore(mailbox, folder, nextLink);

/**
 * Mail search, Outlook's way: every folder (`folder` null) or one, each result
 * with the line around its first match and the folder it is in. Without Outlook,
 * the local store's own (running the app locally only).
 */
export const searchMessages = async (
  mailbox: string,
  query: string,
  folder: FolderId | null
): Promise<{ messages: MailMessage[]; nextLink?: string }> => {
  if (live()) return graph.searchMessages(mailbox, query, folder);
  const terms = searchTerms(query);
  const label: Record<string, string> = { inbox: "Inbox", sent: "Sent", drafts: "Drafts", archive: "Archive", junk: "Junk", deleted: "Deleted Items" };
  const messages = allMessages()
    .filter((m) => m.mailbox === mailbox && (!folder || m.folder === folder))
    .map((m) => ({ m, text: plainText(m.body.content, m.body.contentType === "html") }))
    // Every word must appear, in any order, as Outlook reads a search.
    .filter(({ m, text }) =>
      query
        .split(/\s+/)
        .filter(Boolean)
        .every((w) => hasHit(`${m.subject} ${m.from.emailAddress.name} ${m.from.emailAddress.address} ${text}`, searchTerms(w)))
    )
    .map(({ m, text }) => ({ ...m, searchSnippet: snippetAround(text, terms), folderLabel: label[m.folder] ?? "Folder" }))
    .sort((a, b) => Date.parse(b.receivedDateTime) - Date.parse(a.receivedDateTime));
  return { messages };
};

/** The next page of a search. Only the live mailbox pages. */
export const searchMoreMessages = async (mailbox: string, query: string, folder: FolderId | null, nextLink: string) =>
  graph.searchMore(mailbox, query, folder, nextLink);

export const getMailMessage = async (mailbox: string, id: string, folder: FolderId = "inbox") =>
  live()
    ? { message: await graph.getMessage(mailbox, id, folder) }
    : get<{ message: MailMessage }>(
        `/api/mail/messages/${encodeURIComponent(id)}?mailbox=${encodeURIComponent(mailbox)}`
      );

/** The message read ahead of its opening (the live mailbox only; quiet). */
export const prefetchMailMessage = (mailbox: string, id: string, folder: FolderId = "inbox") => {
  if (live()) graph.prefetchMessage(mailbox, id, folder);
};

export const setMailRead = async (mailbox: string, id: string, isRead: boolean) => {
  if (live()) return graph.setRead(mailbox, id, isRead);
  return post<{ message: MailMessage }>(`/api/mail/messages/${encodeURIComponent(id)}/read`, {
    mailbox,
    isRead,
  });
};

export const moveMailMessage = async (mailbox: string, id: string, folder: FolderId) => {
  if (live()) return graph.moveMessage(mailbox, id, folder);
  return post<{ message: MailMessage }>(`/api/mail/messages/${encodeURIComponent(id)}/move`, {
    mailbox,
    folder,
  });
};

/**
 * Sends one message and reports the conversation it started.
 *
 * Only meaningful against a real mailbox: the in-memory one has no threading to
 * track, so it reports an empty conversation and the caller records the ask
 * without a way to match a reply — which is correct, because in the demo
 * mailbox no reply is ever coming.
 */
/**
 * Sending without Outlook is refused on the live site, in words.
 *
 * Until 25 Sep 2026 a send with no Microsoft connection went to the demo
 * mailbox and came back as success: a quotation "sent" by somebody signed in
 * with a password never left, and a rate request was recorded as asked when
 * nobody had been. The demo mailbox is for running the app locally only.
 */
const NOT_CONNECTED = "Outlook is not connected, so nothing was sent. Connect Outlook on the Mail page, then send it again.";
const demoMail = import.meta.env.DEV;

export const sendTrackedMail = async (input: {
  to: string[];
  cc?: string[];
  subject: string;
  content: string;
}): Promise<{ conversationId: string | null }> => {
  if (!live()) {
    if (demoMail) return { conversationId: null };
    throw new Error(NOT_CONNECTED);
  }
  const { conversationId } = await graph.sendTracked(input);
  // Into the desk's mail log for oversight once Outlook has filed it (086).
  syncSentSoon();
  return { conversationId };
};

/**
 * Every message in one conversation, wherever it now sits. Unordered.
 * Without Outlook, the local store's own (running the app locally only).
 */
export const conversationMessages = async (
  mailbox: string,
  conversationId: string
): Promise<MailMessage[]> =>
  live()
    ? graph.messagesInConversation(mailbox, conversationId)
    : demoMail
      ? allMessages().filter((m) => m.mailbox === mailbox && m.conversationId === conversationId)
      : [];

/**
 * Every message in the mailbox matching a KQL query, across all folders.
 *
 * The caller writes the query, because `participants:"x@y"` and a bare phrase
 * are different questions — see the header of `graphMail.searchMailbox`.
 */
export const searchMail = async (mailbox: string, kql: string): Promise<MailMessage[]> =>
  live() ? graph.searchMailbox(mailbox, kql) : [];

export const sendMail = async (body: {
  mailbox: string;
  fromName: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  content: string;
  conversationId?: string;
  replyToId?: string;
  /** A forward: through Graph's own, so the original's attachments go too. */
  forwardOfId?: string;
  /** A draft already in the mailbox (started in Outlook): updated, then sent itself. */
  draftId?: string;
  attachments?: graph.OutgoingAttachment[];
}) => {
  if (live()) {
    if (body.draftId) {
      await graph.sendDraft({
        draftId: body.draftId,
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject,
        content: body.content,
        attachments: body.attachments,
      });
      syncSentSoon();
      return;
    }
    if (body.forwardOfId) {
      await graph.forwardTracked({
        forwardOfId: body.forwardOfId,
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject,
        content: body.content,
        attachments: body.attachments,
      });
      syncSentSoon();
      return;
    }

    /*
      A reply goes through the reply path, not the send path.
      --------------------------------------------------------------------
      /me/sendMail starts a new conversation and sets no In-Reply-To or
      References headers, so a reply sent that way lands outside the thread
      it is answering however right the "Re:" subject looks. Threading is
      what `replyToId` buys, and it is only correct when it is used.
    */
    if (body.replyToId) {
      await graph.replyTracked({
        replyToId: body.replyToId,
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject,
        content: body.content,
        attachments: body.attachments,
      });
      syncSentSoon();
      return;
    }

    await graph.sendMessage({
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject,
      content: body.content,
      attachments: body.attachments,
    });
    syncSentSoon();
    return;
  }
  if (!demoMail) throw new Error(NOT_CONNECTED);
  return post<{ message: MailMessage }>("/api/mail/send", body);
};

/**
 * One attachment's bytes, to download. Only a real mailbox has them; the local
 * store's messages carry names and sizes only.
 */
export const getMailAttachment = async (
  messageId: string,
  attachmentId: string
): Promise<{ name: string; contentType: string; size: number; contentBytes: string }> => {
  if (!live()) {
    // Running locally: the local store's own file, when it carries one.
    const a = demoMail
      ? (allMessages().find((m) => m.id === messageId)?.attachments.find((x) => x.id === attachmentId) as
          | { name: string; contentType: string; size: number; contentBytes?: string }
          | undefined)
      : undefined;
    if (a?.contentBytes) return { name: a.name, contentType: a.contentType, size: a.size, contentBytes: a.contentBytes };
    throw new Error("Connect Outlook on the Mail page to open attachments.");
  }
  return graph.getAttachmentBytes(messageId, attachmentId);
};

/** Keeps a message being written as a draft in Outlook, unsent. */
export const saveMailDraft = async (body: {
  mailbox: string;
  fromName: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  content: string;
  draftId?: string;
  replyToId?: string;
  forwardOfId?: string;
  attachments?: graph.OutgoingAttachment[];
}) => {
  if (live()) return graph.saveDraft(body);
  if (!demoMail) throw new Error(NOT_CONNECTED);
  return post("/api/mail/draft", body);
};

/** True when this session is talking to a real Outlook mailbox. */
export const mailIsLive = () => graph.hasGraphToken();
