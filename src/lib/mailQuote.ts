/**
 * Reply, reply all and forward, the way Outlook writes them (25 Sep 2026).
 *
 * The message being answered goes under a rule with Outlook's own header —
 * From, Sent, To, Cc, Subject — so a thread started in the CRM reads the same
 * in the customer's Outlook as one started there. Until now a reply quoted in
 * Gmail's style ("On …, … wrote:" and an indented block), which Outlook users
 * read as a message from somewhere else.
 */
import { formatDate } from "./dates";
import type { MailMessage, Recipient } from "../services/mockMail";

export type ComposeMode = "reply" | "replyAll" | "forward";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const who = (r: Recipient) => {
  const { name, address } = r.emailAddress;
  return name && name.toLowerCase() !== address.toLowerCase() ? `${name} <${address}>` : address;
};

/** "Re: …" or "Fw: …", without stacking a second one on a subject that has it. */
export function composeSubject(subject: string, mode: ComposeMode): string {
  const s = subject.trim();
  if (mode === "forward") return /^(fw|fwd):/i.test(s) ? s : `Fw: ${s}`;
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/**
 * Who a reply goes to. Reply: the sender. Reply all: the sender and everyone
 * on To, and everyone on Cc, less this mailbox and anybody twice.
 */
export function replyRecipients(m: Pick<MailMessage, "from" | "toRecipients" | "ccRecipients">, mode: ComposeMode, me: string): { to: string[]; cc: string[] } {
  if (mode === "forward") return { to: [], cc: [] };
  const mine = me.trim().toLowerCase();
  const seen = new Set<string>([mine]);
  const take = (list: Recipient[]) =>
    list
      .map((r) => r.emailAddress.address.trim())
      .filter((a) => {
        const k = a.toLowerCase();
        if (!a || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  const sender = m.from?.emailAddress?.address?.trim() ?? "";
  // Replying to something this mailbox sent answers the people it went to.
  const fromMe = sender.toLowerCase() === mine;
  if (mode === "reply") {
    return fromMe ? { to: take(m.toRecipients ?? []), cc: [] } : { to: take(m.from ? [m.from] : []), cc: [] };
  }
  const to = take([...(fromMe ? [] : m.from ? [m.from] : []), ...(m.toRecipients ?? [])]);
  const cc = take(m.ccRecipients ?? []);
  return { to, cc };
}

/** Outlook's header over the quoted message. */
export function quoteHeaderHtml(m: Pick<MailMessage, "from" | "toRecipients" | "ccRecipients" | "receivedDateTime" | "subject">): string {
  const sent = formatDate(m.receivedDateTime, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const line = (label: string, value: string) => (value ? `<b>${label}:</b> ${esc(value)}<br>` : "");
  // Outlook's own markup: a thin rule, then the lines, then a blank line.
  return (
    `<div style="border:none;border-top:solid #e1e1e1 1.0pt;padding:3.0pt 0 0 0">` +
    line("From", m.from ? who(m.from) : "") +
    line("Sent", sent) +
    line("To", (m.toRecipients ?? []).map(who).join("; ")) +
    line("Cc", (m.ccRecipients ?? []).map(who).join("; ")) +
    line("Subject", m.subject ?? "").replace(/<br>$/, "") +
    `</div><div><br></div>`
  );
}

/** The quoted message's own body as HTML, plain text kept as its lines. */
export function quotedBodyHtml(m: Pick<MailMessage, "body">): string {
  return m.body.contentType === "html" ? m.body.content : esc(m.body.content).replace(/\r?\n/g, "<br>");
}
