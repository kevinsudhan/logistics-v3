import type { MailMessage } from "../services/mockMail";

/**
 * A mailbox's mail, sorted: written to it from outside, written to it from
 * within the company, CC'd to it, and forwarded to it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 *
 * aashish@ (the admin) is sent everything parasuraman@ and info@ send and
 * receive, by rules set up in Exchange, whether or not they put him on it. So
 * his Inbox is mostly their correspondence, and his own mail is lost in it.
 * The Mail page sorts it four ways:
 *
 *   My emails       mail written to him from outside the company — a
 *                   customer, a carrier, an agent: his address on the To line;
 *   Primary         mail written to him from within the company — a
 *                   colleague's, his address on the To line;
 *   CC'd            mail he was copied on: his address on the Cc line —
 *                   with who copied him;
 *   Auto-forwarded  mail he is sent without being named on it — with whose
 *                   mailbox it came out of.
 *
 * Within the company is a sender at the mailbox's own domain, or one of the
 * staff on another (`Lens.people`). Every user has the first three; the
 * fourth is the admin's.
 *
 * HOW A FORWARD IS TOLD FROM MAIL WRITTEN TO HIM
 *
 * A rule reaches him one of two ways, and they look different:
 *
 *   - a FORWARD re-sends the mail To: aashish@, From: the mailbox whose rule
 *     it is, "FW:" in front. On its face it is mail written to him. What
 *     proves otherwise is the header Exchange stamps on everything an inbox
 *     rule sends, X-MS-Exchange-Inbox-Rules-Loop, naming that mailbox
 *     (services/forwardChain). A list carries no headers, so the messages that
 *     could be one are asked about by themselves (graphMail.ruleForwarders)
 *     and the answers kept: `Lens.forwards`. Until a message's answer is in it
 *     is `Lens.checking`, in no view but everything, so a forward is never
 *     shown as his own mail and then taken back.
 *   - a COPY (a redirect, a Bcc, a transport rule) delivers the mail as it
 *     was: its own From, To and Cc, his address on none of them. Not being
 *     named is the trace. Mail to a group lands here too, and a real Bcc.
 *
 * WHOSE MAIL
 *
 * CC'd mail is filed under who sent it: who copied him. Forwarded mail under
 * the mailbox whose rule forwarded it; a copy under its sender and every one
 * of our own addresses (the mailbox's domain) it went to, so a customer's
 * mail to info@ is info@'s (received) and parasuraman@'s reply is his (sent).
 * Outside recipients are left out: everyone our people ever wrote to would
 * bury the two mailboxes being looked for.
 * ---------------------------------------------------------------------------
 */

/** Messages an inbox rule forwarded to the mailbox, by id: whose rule, or null for none. */
export type RuleForwards = ReadonlyMap<string, string | null>;

/** The mailbox a message is read from, and what is known about its forwards. */
export interface Lens {
  mailbox: string;
  forwards?: RuleForwards;
  /** Being asked about: perhaps a forward, not yet known. */
  checking?: ReadonlySet<string>;
  /** The staff's addresses, lower case: within the company though not at the mailbox's domain. */
  people?: ReadonlySet<string>;
}

const norm = (a: string | undefined | null) => (a ?? "").trim().toLowerCase();
const domainOf = (mailbox: string) => norm(mailbox).split("@")[1] ?? "";
const oursIn = (mailbox: string) => {
  const domain = domainOf(mailbox);
  return (a: string) => Boolean(domain) && a.endsWith(`@${domain}`);
};

export type Addressed = "to" | "cc" | "forward" | "copy" | "sent";

export function addressedAs(m: MailMessage, lens: Lens): Addressed {
  const me = norm(lens.mailbox);
  if (norm(m.from?.emailAddress?.address) === me) return "sent";
  const by = norm(lens.forwards?.get(m.id));
  if (by && by !== me) return "forward";
  if (m.toRecipients.some((r) => norm(r.emailAddress?.address) === me)) return "to";
  if (m.ccRecipients.some((r) => norm(r.emailAddress?.address) === me)) return "cc";
  return "copy";
}

/** "mine" is My emails: written to the mailbox from outside the company. */
export type Bucket = "mine" | "primary" | "cc" | "forwarded";

/** Whether a message is from within the company: our domain, or one of the staff. */
export function fromWithin(m: MailMessage, lens: Lens): boolean {
  const from = norm(m.from?.emailAddress?.address);
  return Boolean(from) && (oursIn(lens.mailbox)(from) || Boolean(lens.people?.has(from)));
}

/** Which of the four a message is in; none for the mailbox's own, or one still being checked. */
export function bucketOf(m: MailMessage, lens: Lens): Bucket | null {
  if (lens.checking?.has(m.id)) return null;
  const a = addressedAs(m, lens);
  if (a === "to") return fromWithin(m, lens) ? "primary" : "mine";
  return a === "cc" ? "cc" : a === "forward" || a === "copy" ? "forwarded" : null;
}

/**
 * The messages that could be a rule's forward and have not been asked about:
 * on the To line, and from one of our own addresses (a rule forwards as the
 * mailbox it belongs to) or with "FW:" in front.
 */
export function forwardSuspects(messages: MailMessage[], lens: Lens): MailMessage[] {
  const me = norm(lens.mailbox);
  const ours = oursIn(lens.mailbox);
  return messages.filter((m) => {
    if (lens.forwards?.has(m.id) || lens.checking?.has(m.id)) return false;
    if (addressedAs(m, { mailbox: lens.mailbox }) !== "to") return false;
    const from = norm(m.from?.emailAddress?.address);
    return (ours(from) && from !== me) || /^\s*(fw|fwd)\s*:/i.test(m.subject ?? "");
  });
}

export interface Party {
  address: string;
  name: string;
  /** Sent the message, or (one of ours) was sent it. */
  role: "sent" | "received";
  /** One of our own addresses. */
  ours: boolean;
}

/** Whose a message is, in the view it is in (see WHOSE MAIL above). */
export function partiesOf(m: MailMessage, lens: Lens): Party[] {
  const ours = oursIn(lens.mailbox);
  const me = norm(lens.mailbox);
  const from = norm(m.from?.emailAddress?.address);
  const fromName = m.from?.emailAddress?.name?.trim() || from;
  const a = addressedAs(m, lens);
  if (a === "cc") return from ? [{ address: from, name: fromName, role: "sent", ours: ours(from) }] : [];
  if (a === "forward") {
    const by = norm(lens.forwards?.get(m.id));
    return [{ address: by, name: from === by ? fromName : by, role: "received", ours: ours(by) }];
  }
  if (a !== "copy") return [];
  const out: Party[] = [];
  const seen = new Set<string>([me]);
  if (from && !seen.has(from)) {
    seen.add(from);
    out.push({ address: from, name: fromName, role: "sent", ours: ours(from) });
  }
  for (const r of [...m.toRecipients, ...m.ccRecipients]) {
    const addr = norm(r.emailAddress?.address);
    if (!addr || seen.has(addr) || !ours(addr)) continue;
    seen.add(addr);
    out.push({ address: addr, name: r.emailAddress?.name?.trim() || addr, role: "received", ours: true });
  }
  return out;
}

/** Everything, or one of the four. */
export type MailView = "all" | Bucket;
/** Of one of our mailboxes' forwarded mail: both ways, what it was sent, or what it sent. */
export type Direction = "any" | "received" | "sent";

export interface ViewChoice {
  view: MailView;
  /** In CC'd: who copied the mailbox. In Auto-forwarded: whose mail it is. */
  person: string | null;
  direction: Direction;
}

export const EVERYTHING: ViewChoice = { view: "all", person: null, direction: "any" };

export function inView(m: MailMessage, lens: Lens, c: ViewChoice): boolean {
  if (c.view === "all") return true;
  if (bucketOf(m, lens) !== c.view) return false;
  if (!c.person) return true;
  const person = norm(c.person);
  return partiesOf(m, lens).some((p) => p.address === person && (c.direction === "any" || p.role === c.direction));
}

export interface Copier {
  address: string;
  name: string;
  ours: boolean;
  /** Messages of theirs in the view: ones they sent, ones sent to them. */
  sent: number;
  received: number;
}

/** The people a view's mail is from: the choices for its picker, ours first, then by how many. */
export function copiers(messages: MailMessage[], lens: Lens, bucket: "cc" | "forwarded"): Copier[] {
  const by = new Map<string, Copier>();
  for (const m of messages) {
    if (bucketOf(m, lens) !== bucket) continue;
    for (const p of partiesOf(m, lens)) {
      const c = by.get(p.address) ?? { address: p.address, name: p.name, ours: p.ours, sent: 0, received: 0 };
      // The name a person gives themselves, sending, over one somebody typed for them.
      if (p.role === "sent" && p.name !== p.address) c.name = p.name;
      if (c.name === c.address && p.name !== p.address) c.name = p.name;
      c[p.role]++;
      by.set(p.address, c);
    }
  }
  const total = (c: Copier) => c.sent + c.received;
  return [...by.values()].sort((a, b) => Number(b.ours) - Number(a.ours) || total(b) - total(a) || a.name.localeCompare(b.name));
}

/**
 * Why a message is in the mailbox, in a word or two for its row: "CC", whose
 * mail a forward or copy is ("Info Desk's"), or "BCC" for a copy of nobody's
 * of ours. Nothing for mail written to it, or its own.
 */
export function copyNote(m: MailMessage, lens: Lens): { label: string; title: string } | null {
  const a = addressedAs(m, lens);
  if (a === "cc") return { label: "CC", title: `CC'd to you by ${m.from?.emailAddress?.name || m.from?.emailAddress?.address}` };
  if (a === "forward") {
    const p = partiesOf(m, lens)[0];
    return { label: `${p.name}'s`, title: `Auto-forwarded to you by a rule in ${p.address}'s mailbox` };
  }
  if (a !== "copy") return null;
  const ours = partiesOf(m, lens).find((p) => p.ours);
  return ours
    ? { label: `${ours.name}'s`, title: `A copy of ${ours.name}'s mail (${ours.address}): you are not named on it` }
    : { label: "BCC", title: "You are not named on it: a Bcc, or mail to a group" };
}

// ---------------------------------------------------------------------------
// Kept in this browser, per mailbox: conveniences, so nothing depends on them
// ---------------------------------------------------------------------------

const viewKey = (mailbox: string) => `mail:view:${norm(mailbox)}`;
/** What the views were called on 13 Oct, before there were three. ("mine" is new: "direct" was To me, now Primary.) */
const RENAMED: Record<string, MailView> = { direct: "primary", copied: "forwarded" };

export function readViewChoice(mailbox: string): ViewChoice {
  try {
    const v = JSON.parse(localStorage.getItem(viewKey(mailbox)) ?? "null") as { view?: string; person?: unknown; direction?: unknown } | null;
    const view = (RENAMED[v?.view ?? ""] ?? v?.view) as MailView | undefined;
    if (!view || !["all", "mine", "primary", "cc", "forwarded"].includes(view)) return EVERYTHING;
    return {
      view,
      person: (view === "cc" || view === "forwarded") && typeof v?.person === "string" ? v.person : null,
      direction: v?.direction === "sent" || v?.direction === "received" ? v.direction : "any",
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

const forwardsKey = (mailbox: string) => `mail:ruleForwards:${norm(mailbox)}`;
/** The answers kept: enough for a few weeks of a busy Inbox, the oldest let go first. */
const FORWARDS_KEPT = 1500;

export function readRuleForwards(mailbox: string): Map<string, string | null> {
  try {
    const kept = JSON.parse(localStorage.getItem(forwardsKey(mailbox)) ?? "[]") as Array<[string, string | null]>;
    return new Map(Array.isArray(kept) ? kept.filter((e) => Array.isArray(e) && typeof e[0] === "string") : []);
  } catch {
    return new Map();
  }
}

export function keepRuleForwards(mailbox: string, forwards: RuleForwards) {
  try {
    localStorage.setItem(forwardsKey(mailbox), JSON.stringify([...forwards].slice(-FORWARDS_KEPT)));
  } catch {
    // Not kept: they are asked about again next time, which is all that costs.
  }
}

/**
 * The picker's choices: ALG's own people only — the staff, and any of our
 * addresses in the mail (a shared mailbox like imports@ need not be a login) —
 * never outside senders, who are hundreds and are not who is being looked for.
 * Each with how much of the view's mail is theirs; the mailbox itself left out.
 */
export function colleagues(found: Copier[], staff: Array<{ email: string; full_name: string }>, mailbox: string): Copier[] {
  const me = norm(mailbox);
  const ours = oursIn(mailbox);
  const by = new Map<string, Copier>();
  for (const s of staff) {
    const address = norm(s.email);
    if (!address || address === me) continue;
    by.set(address, { address, name: s.full_name?.trim() || address, ours: true, sent: 0, received: 0 });
  }
  for (const c of found) {
    if (c.address === me) continue;
    const known = by.get(c.address);
    if (known) by.set(c.address, { ...c, name: known.name, ours: true });
    else if (ours(c.address)) by.set(c.address, c);
  }
  const total = (c: Copier) => c.sent + c.received;
  return [...by.values()].sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name));
}
