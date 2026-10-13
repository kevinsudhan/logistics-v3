import type { MailMessage } from "../services/mockMail";

/**
 * Mail the mailbox was copied on, and mail it was not.
 *
 * ---------------------------------------------------------------------------
 * HOW A MESSAGE IS TOLD APART
 *
 * By where the mailbox's own address is on it: on the To line it was sent to
 * us; on the Cc line we were copied. On neither, we were blind-copied — a
 * recipient never sees the Bcc line, so being on neither is the only trace of
 * it. Mail sent to a group or an alias address the mailbox receives lands
 * there too, which is why the filter names it "CC & BCC" and not just "CC".
 *
 * Mail the mailbox sent itself is neither: it was not copied on its own mail.
 * ---------------------------------------------------------------------------
 */

export type Addressed = "to" | "cc" | "bcc" | "sent";

const same = (a: string | undefined, b: string) => (a ?? "").trim().toLowerCase() === b;

export function addressedAs(m: MailMessage, mailbox: string): Addressed {
  const me = mailbox.trim().toLowerCase();
  if (same(m.from?.emailAddress?.address, me)) return "sent";
  if (m.toRecipients.some((r) => same(r.emailAddress?.address, me))) return "to";
  if (m.ccRecipients.some((r) => same(r.emailAddress?.address, me))) return "cc";
  return "bcc";
}

/** Copied, openly or blind. */
export const copied = (m: MailMessage, mailbox: string) => {
  const a = addressedAs(m, mailbox);
  return a === "cc" || a === "bcc";
};

export type CcView = "all" | "copied" | "direct";

/** Whether a message is one the view shows; `from` narrows the copied ones to one sender. */
export function inCcView(m: MailMessage, mailbox: string, view: CcView, from: string | null): boolean {
  if (view === "all") return true;
  const a = addressedAs(m, mailbox);
  if (view === "direct") return a === "to";
  if (a !== "cc" && a !== "bcc") return false;
  return !from || same(m.from?.emailAddress?.address, from.trim().toLowerCase());
}

export interface CcSender {
  address: string;
  name: string;
  /** How many of the messages they copied the mailbox on. */
  count: number;
}

/** Who copied the mailbox, most often first: the choices for "copied by". */
export function ccSenders(messages: MailMessage[], mailbox: string): CcSender[] {
  const by = new Map<string, CcSender>();
  for (const m of messages) {
    if (!copied(m, mailbox)) continue;
    const address = (m.from?.emailAddress?.address ?? "").trim();
    if (!address) continue;
    const key = address.toLowerCase();
    const was = by.get(key);
    if (was) was.count++;
    else by.set(key, { address, name: m.from?.emailAddress?.name?.trim() || address, count: 1 });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
