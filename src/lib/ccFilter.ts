import type { MailMessage } from "../services/mockMail";

/**
 * Mail sent to the mailbox, and mail it only has a copy of — and whose.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 *
 * aashish@ is copied on everything parasuraman@ and info@ send and receive,
 * by a rule an administrator set up in Exchange, whether or not they put him
 * on the mail. So his Inbox is mostly other people's correspondence, and the
 * mail actually written to him is lost in it. This sorts the one from the
 * other, and the copies by whose mail they are.
 *
 * HOW A MESSAGE IS TOLD APART
 *
 * By where the mailbox's own address is on it:
 *
 *   - on the To line: written to us ("to");
 *   - on the Cc line: we were copied, openly ("cc");
 *   - on neither: we have a copy we are not named on ("copy"). That is the
 *     admin rule's copy, a Bcc, or mail to a group — a copy carries its
 *     original From, To and Cc untouched, and a Bcc line is never shown to a
 *     recipient, so not being named is the only trace any of them leave;
 *   - from the mailbox itself: its own mail ("sent"), neither of the above.
 *
 * WHOSE MAIL A COPY IS
 *
 * Everybody it is between, as far as the mailbox is concerned: whoever sent
 * it, and every one of our own addresses (the mailbox's domain) it was sent
 * to. A customer's mail to info@ is the customer's (sent) and info@'s
 * (received); parasuraman@'s reply is his (sent). Choosing parasuraman@ then
 * shows his mail in and out — what the rule copies — and choosing a customer
 * shows what they sent. Outside recipients are left out: a list of everyone
 * our people ever wrote to would bury the two or three mailboxes being looked
 * for.
 * ---------------------------------------------------------------------------
 */

export type Addressed = "to" | "cc" | "copy" | "sent";

const norm = (a: string | undefined | null) => (a ?? "").trim().toLowerCase();

export function addressedAs(m: MailMessage, mailbox: string): Addressed {
  const me = norm(mailbox);
  if (norm(m.from?.emailAddress?.address) === me) return "sent";
  if (m.toRecipients.some((r) => norm(r.emailAddress?.address) === me)) return "to";
  if (m.ccRecipients.some((r) => norm(r.emailAddress?.address) === me)) return "cc";
  return "copy";
}

/** Copied, openly or not: on the Cc line, or not named on it at all. */
export const copied = (m: MailMessage, mailbox: string) => {
  const a = addressedAs(m, mailbox);
  return a === "cc" || a === "copy";
};

/** The mailbox's own domain: whose addresses count as ours. */
const domainOf = (mailbox: string) => norm(mailbox).split("@")[1] ?? "";

export interface Party {
  address: string;
  name: string;
  /** Sent the message, or (one of ours) was sent it. */
  role: "sent" | "received";
  /** One of our own addresses. */
  ours: boolean;
}

/** Who a copied message is between: its sender, and our own addresses it went to. */
export function partiesOf(m: MailMessage, mailbox: string): Party[] {
  const me = norm(mailbox);
  const domain = domainOf(mailbox);
  const isOurs = (a: string) => Boolean(domain) && a.endsWith(`@${domain}`);
  const out: Party[] = [];
  const seen = new Set<string>([me]);
  const from = norm(m.from?.emailAddress?.address);
  if (from && !seen.has(from)) {
    seen.add(from);
    out.push({ address: from, name: m.from?.emailAddress?.name?.trim() || from, role: "sent", ours: isOurs(from) });
  }
  for (const r of [...m.toRecipients, ...m.ccRecipients]) {
    const a = norm(r.emailAddress?.address);
    if (!a || seen.has(a) || !isOurs(a)) continue;
    seen.add(a);
    out.push({ address: a, name: r.emailAddress?.name?.trim() || a, role: "received", ours: true });
  }
  return out;
}

/** Everything; mail written to the mailbox; or mail it was copied on. */
export type MailView = "all" | "direct" | "copied";
/** Of one person's mail: both ways, what they were sent, or what they sent. */
export type Direction = "any" | "received" | "sent";

export interface ViewChoice {
  view: MailView;
  /** With "copied": only mail between this address and anyone. */
  person: string | null;
  direction: Direction;
}

export const EVERYTHING: ViewChoice = { view: "all", person: null, direction: "any" };

export function inView(m: MailMessage, mailbox: string, c: ViewChoice): boolean {
  if (c.view === "all") return true;
  if (c.view === "direct") return addressedAs(m, mailbox) === "to";
  if (!copied(m, mailbox)) return false;
  if (!c.person) return true;
  const person = norm(c.person);
  return partiesOf(m, mailbox).some((p) => p.address === person && (c.direction === "any" || p.role === c.direction));
}

export interface Copier {
  address: string;
  name: string;
  ours: boolean;
  /** Copies of mail they sent, and of mail sent to them. */
  sent: number;
  received: number;
}

/** Whose mail the mailbox has copies of: ours first, then by how much. The choices for "whose mail". */
export function copiers(messages: MailMessage[], mailbox: string): Copier[] {
  const by = new Map<string, Copier>();
  for (const m of messages) {
    if (!copied(m, mailbox)) continue;
    for (const p of partiesOf(m, mailbox)) {
      const c = by.get(p.address) ?? { address: p.address, name: p.name, ours: p.ours, sent: 0, received: 0 };
      // The name a person gives themselves, sending, over the one somebody typed for them.
      if (p.role === "sent" && p.name !== p.address) c.name = p.name;
      c[p.role]++;
      by.set(p.address, c);
    }
  }
  const total = (c: Copier) => c.sent + c.received;
  return [...by.values()].sort((a, b) => Number(b.ours) - Number(a.ours) || total(b) - total(a) || a.name.localeCompare(b.name));
}

/** The view chosen in this mailbox last time: a convenience of this browser, so nothing depends on it. */
const viewKey = (mailbox: string) => `mail:view:${norm(mailbox)}`;

export function readViewChoice(mailbox: string): ViewChoice {
  try {
    const v = JSON.parse(localStorage.getItem(viewKey(mailbox)) ?? "null") as Partial<ViewChoice> | null;
    if (!v || !["all", "direct", "copied"].includes(v.view ?? "")) return EVERYTHING;
    return {
      view: v.view!,
      person: v.view === "copied" && typeof v.person === "string" ? v.person : null,
      direction: v.direction === "sent" || v.direction === "received" ? v.direction : "any",
    };
  } catch {
    return EVERYTHING;
  }
}

export function keepViewChoice(mailbox: string, c: ViewChoice) {
  try {
    if (c.view === "all") localStorage.removeItem(viewKey(mailbox));
    else localStorage.setItem(viewKey(mailbox), JSON.stringify(c));
  } catch {
    // Blocked or full: the view still works for as long as the page is open.
  }
}

/**
 * Why a message the mailbox was copied on is in it, in a word or two for its
 * row: "CC", whose mail a rule's copy is ("Parasuraman's"), or "BCC" for a
 * copy of nobody's of ours. Nothing for mail written to it, or its own.
 */
export function copyNote(m: MailMessage, mailbox: string): { label: string; title: string } | null {
  const a = addressedAs(m, mailbox);
  if (a === "cc") return { label: "CC", title: "You were on the Cc line" };
  if (a !== "copy") return null;
  const ours = partiesOf(m, mailbox).find((p) => p.ours);
  return ours
    ? { label: `${ours.name}'s`, title: `A copy of ${ours.name}'s mail (${ours.address}): you are not named on it` }
    : { label: "BCC", title: "You are not named on it: a Bcc, or mail to a group" };
}
