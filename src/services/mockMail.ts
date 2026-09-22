/**
 * Mailboxes for the in-CRM Outlook client.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SHAPE LOOKS LIKE MICROSOFT GRAPH
 *
 * Real Outlook means Microsoft Graph: /me/mailFolders, /me/messages,
 * /me/sendMail, behind OAuth against the tenant. That needs a server -- the
 * client secret and the refresh tokens cannot live in a browser bundle -- and
 * v2 deliberately has no server.
 *
 * So the messages below carry Graph's field names and nesting exactly:
 * `from.emailAddress.address`, `toRecipients[]`, `receivedDateTime`,
 * `bodyPreview`, `body.contentType`, `isRead`, `conversationId`. Nothing here
 * is a convenient invention.
 *
 * The point is that wiring up the real thing becomes a transport change rather
 * than a rewrite: swap the four functions at the bottom of this file for Graph
 * calls and the entire UI keeps working, because it is already reading the
 * shape Graph returns. Getting this wrong -- inventing `sender`, `date`,
 * `read` -- is what turns a mail mock into a week of refactoring later.
 * ---------------------------------------------------------------------------
 */

const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN).toISOString();

export type FolderId = "inbox" | "sent" | "drafts" | "archive";

export interface Recipient {
  emailAddress: { name: string; address: string };
}

export interface MailMessage {
  id: string;
  conversationId: string;
  /** Which mailbox this sits in — Graph scopes by the signed-in user; we scope explicitly. */
  mailbox: string;
  folder: FolderId;
  subject: string;
  from: Recipient;
  toRecipients: Recipient[];
  ccRecipients: Recipient[];
  receivedDateTime: string;
  bodyPreview: string;
  body: { contentType: "text" | "html"; content: string };
  isRead: boolean;
  isDraft: boolean;
  hasAttachments: boolean;
  /**
   * The real attachments — inline signature logos are filtered out.
   *
   * `id` is Graph's, and is only resolvable with a token for the mailbox that
   * holds the message. It is here so the bytes can be fetched once, to be
   * copied somewhere that does not depend on one person's mailbox; it is not
   * something to store.
   */
  attachments: Array<{ id?: string; name: string; size: number; contentType: string }>;
  importance: "low" | "normal" | "high";
  /**
   * The raw internet headers, when they were asked for.
   *
   * Only ever populated on a message fetched in full: Graph omits them from a
   * list unless $select names them, and forty sets of headers is a slow request
   * for something read on one message at a time. Absent means "not fetched",
   * not "none" — which is why every reader here treats missing as unknown.
   */
  internetMessageHeaders?: Array<{ name: string; value: string }>;
}

const r = (name: string, address: string): Recipient => ({ emailAddress: { name, address } });

const DESK = {
  aashish: r("Aashish", "aashish@aashishlogistics.com"),
  parasu: r("Parasu", "parasu@aashishlogistics.com"),
  aarathy: r("Aarathy", "aarathy@aashishlogistics.com"),
  info: r("Info Desk", "info@aashishlogistics.com"),
  imports: r("Imports Desk", "imports@aashishlogistics.com"),
};

let seq = 0;
function msg(m: Partial<MailMessage> & Pick<MailMessage, "mailbox" | "subject" | "from" | "body">): MailMessage {
  seq += 1;
  const content = m.body.content;
  return {
    id: `msg-${seq}`,
    conversationId: m.conversationId ?? `conv-${seq}`,
    folder: "inbox",
    toRecipients: [r("", m.mailbox)],
    ccRecipients: [],
    receivedDateTime: ago(seq * 47),
    bodyPreview: content.replace(/\s+/g, " ").trim().slice(0, 140),
    isRead: false,
    isDraft: false,
    hasAttachments: false,
    attachments: [],
    importance: "normal",
    ...m,
  } as MailMessage;
}

/**
 * Each desk sees a different mailbox, which is the point of scoping by login:
 * imports@ lives in arrival notices and customs, aarathy@ in documentation,
 * parasu@ in carrier operations. If every account showed the same inbox the
 * per-user sign-in would be decoration.
 */
/**
 * Empty on purpose.
 *
 * This held a set of invented freight emails. They were useful while the mail
 * client was being built, and became a liability the moment Outlook was
 * connected: a mailbox showing convincing messages that were never sent to
 * anybody is worse than one showing nothing.
 *
 * With no Outlook connection the mail screens are empty and say why. The store
 * still accepts sends so the compose path can be exercised without delivering
 * anything, which is the one case where a local message is honest.
 */
const messages: MailMessage[] = [];

// ---------------------------------------------------------------------------
// Queries — the four operations the UI needs
// ---------------------------------------------------------------------------

export const FOLDERS: Array<{ id: FolderId; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "drafts", label: "Drafts" },
  { id: "archive", label: "Archive" },
];

const forMailbox = (mailbox: string) => messages.filter((m) => m.mailbox === mailbox);

/**
 * Every message across every desk mailbox.
 *
 * The case file needs this: a shipment's correspondence is spread over info@,
 * imports@ and whoever else was involved, and filing by enquiry has to see all
 * of it rather than one person's inbox.
 */
export const allMessages = () => messages;

export function listFolders(mailbox: string) {
  return FOLDERS.map((f) => {
    const inFolder = forMailbox(mailbox).filter((m) => m.folder === f.id);
    return {
      id: f.id,
      label: f.label,
      total: inFolder.length,
      // Only unread in the inbox is worth badging; a Sent item being "unread" is meaningless.
      unread: f.id === "inbox" ? inFolder.filter((m) => !m.isRead).length : 0,
    };
  });
}

export function listMessages(mailbox: string, folder: FolderId, q?: string) {
  let list = forMailbox(mailbox).filter((m) => m.folder === folder);

  if (q?.trim()) {
    const needle = q.trim().toLowerCase();
    list = list.filter(
      (m) =>
        m.subject.toLowerCase().includes(needle) ||
        m.bodyPreview.toLowerCase().includes(needle) ||
        m.from.emailAddress.name.toLowerCase().includes(needle) ||
        m.from.emailAddress.address.toLowerCase().includes(needle)
    );
  }

  // Newest first, as every mail client does.
  return [...list].sort(
    (a, b) => Date.parse(b.receivedDateTime) - Date.parse(a.receivedDateTime)
  );
}

export function getMessage(mailbox: string, id: string) {
  return forMailbox(mailbox).find((m) => m.id === id) ?? null;
}

export function setRead(mailbox: string, id: string, isRead: boolean) {
  const m = getMessage(mailbox, id);
  if (!m) return null;
  m.isRead = isRead;
  return m;
}

export function moveMessage(mailbox: string, id: string, folder: FolderId) {
  const m = getMessage(mailbox, id);
  if (!m) return null;
  m.folder = folder;
  return m;
}

export function sendMessage(input: {
  mailbox: string;
  fromName: string;
  to: string[];
  cc?: string[];
  subject: string;
  content: string;
  /** Set when replying, so the sent copy threads with the original. */
  conversationId?: string;
}) {
  seq += 1;
  const sent: MailMessage = {
    id: `msg-${seq}`,
    conversationId: input.conversationId ?? `conv-${seq}`,
    mailbox: input.mailbox,
    folder: "sent",
    subject: input.subject,
    from: r(input.fromName, input.mailbox),
    toRecipients: input.to.map((a) => r("", a)),
    ccRecipients: (input.cc ?? []).map((a) => r("", a)),
    receivedDateTime: new Date().toISOString(),
    bodyPreview: input.content.replace(/\s+/g, " ").trim().slice(0, 140),
    body: { contentType: "text", content: input.content },
    isRead: true,
    isDraft: false,
    hasAttachments: false,
    attachments: [],
    importance: "normal",
  };
  messages.push(sent);
  return sent;
}
