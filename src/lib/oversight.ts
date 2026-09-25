import { domainOf, MAIL_KIND_LABEL, recipientsText, type Addressee, type MailKind } from "./mailLog";

/**
 * Team oversight's arithmetic: which period, whose mail, one feed of what the
 * desk did, and what each person did in it (086).
 *
 * Pure, so it can be tested on plain rows; the page only draws it.
 */

export type Period = "today" | "yesterday" | "7d" | "30d" | "month";

export const PERIOD_LABEL: Record<Period, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
};

/** The period as instants, on the browser's clock — the desk's, in IST. `to` null means now. */
export function periodRange(p: Period, now: Date = new Date()): { from: Date; to: Date | null } {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysBack = (n: number) => new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - n);
  switch (p) {
    case "today":
      return { from: midnight, to: null };
    case "yesterday":
      return { from: daysBack(1), to: midnight };
    case "7d":
      return { from: daysBack(6), to: null };
    case "30d":
      return { from: daysBack(29), to: null };
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
  }
}

export const within = (at: string, r: { from: Date; to: Date | null }) => {
  const t = Date.parse(at);
  return t >= r.from.getTime() && (r.to === null || t < r.to.getTime());
};

export interface PersonLike {
  id: string;
  email: string;
  full_name: string;
}

export interface MailLike {
  id: string;
  mailbox: string;
  sent_at: string;
  subject: string;
  preview: string;
  to_addrs: Addressee[];
  cc_addrs: Addressee[];
  has_attachments: boolean;
  enquiry_ref: string | null;
  kind: MailKind;
  synced_by: string | null;
}

export interface EventLike {
  id: string;
  enquiry_ref: string;
  kind: string;
  summary: string;
  actor: string | null;
  at: string;
}

export interface StepLike {
  id: string;
  shipment_id: string;
  label: string;
  done_at: string | null;
  done_by: string | null;
}

/**
 * Whose mail it is: the person whose CRM login is that mailbox, else the
 * person whose session copied it in. A shared mailbox like info@ that nobody
 * logs in to the CRM as is credited to whoever reads it in the CRM.
 */
export function personOfMail(m: Pick<MailLike, "mailbox" | "synced_by">, people: PersonLike[]): string | null {
  const own = people.find((p) => p.email.toLowerCase() === m.mailbox.toLowerCase());
  return own?.id ?? m.synced_by ?? null;
}

export type Source = "mail" | "event" | "step";

export interface ActivityItem {
  id: string;
  at: string;
  who: string | null;
  source: Source;
  /** The pill: "Pre-alert", "Taken on", "Step done". */
  label: string;
  text: string;
  ref: string | null;
  mail?: MailLike;
}

/** What each timeline event is called in the feed; anything else by its kind, in words. */
export const EVENT_LABEL: Record<string, string> = {
  created: "Opened",
  promoted_from_intake: "From queue",
  assigned: "Taken on",
  unassigned: "Put back",
  field_updated: "Updated",
  mail_linked: "Mail filed",
  quote_sent: "Quoted",
  verbal_accept: "Verbal yes",
  accepted: "Accepted",
  declined: "Declined",
  promoted: "Booked",
  partner_assigned: "Partner",
  hbl_issued: "House bill",
  hbl_received: "B/L received",
  hbl_confirmed: "B/L confirmed",
  hbl_final: "Final B/L in",
  do_issued: "DO issued",
  hbl_originals_out: "Originals out",
  hbl_surrendered: "Originals back",
  telex_released: "Telex release",
  cargo_released: "Released",
  console_attached: "On console",
  console_detached: "Off console",
  mbl_recorded: "Master B/L",
  signoff: "Signed off",
};

export const eventLabel = (kind: string) => EVENT_LABEL[kind] ?? kind.replace(/_/g, " ");

/** One feed, newest first: the mail sent, the timeline events and the steps ticked, in the period. */
export function buildActivity(input: {
  events: EventLike[];
  mails: MailLike[];
  steps: StepLike[];
  people: PersonLike[];
  shipmentRef: (shipmentId: string) => string | null;
  range: { from: Date; to: Date | null };
}): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const m of input.mails) {
    if (!within(m.sent_at, input.range)) continue;
    const to = recipientsText([...m.to_addrs, ...m.cc_addrs], 2);
    out.push({
      id: `m:${m.id}`,
      at: m.sent_at,
      who: personOfMail(m, input.people),
      source: "mail",
      label: MAIL_KIND_LABEL[m.kind] ?? "Mail",
      text: `${m.subject || "(no subject)"}${to ? ` → ${to}` : ""}`,
      ref: m.enquiry_ref,
      mail: m,
    });
  }
  for (const e of input.events) {
    if (!within(e.at, input.range)) continue;
    out.push({ id: `e:${e.id}`, at: e.at, who: e.actor, source: "event", label: eventLabel(e.kind), text: e.summary, ref: e.enquiry_ref });
  }
  for (const s of input.steps) {
    if (!s.done_at || !within(s.done_at, input.range)) continue;
    const ref = input.shipmentRef(s.shipment_id);
    out.push({ id: `s:${s.id}`, at: s.done_at, who: s.done_by, source: "step", label: "Step done", text: s.label, ref });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export interface PersonStats {
  mails: number;
  /** Who they wrote to: mails per company domain, most first. */
  domains: Array<[string, number]>;
  takenOn: number;
  quoted: number;
  booked: number;
  steps: number;
  lastAt: string | null;
}

/** What one person did in the feed. Counts, not a score: nobody is ranked. */
export function statsFor(personId: string, items: ActivityItem[]): PersonStats {
  const mine = items.filter((i) => i.who === personId);
  const domains = new Map<string, number>();
  for (const i of mine) {
    if (!i.mail) continue;
    // Mails per company, not addresses: one mail to two people at GFP is one.
    for (const d of new Set(i.mail.to_addrs.map((r) => domainOf(r.address)).filter(Boolean))) {
      domains.set(d, (domains.get(d) ?? 0) + 1);
    }
  }
  const of = (source: Source, label?: string) => mine.filter((i) => i.source === source && (!label || i.label === label)).length;
  return {
    mails: of("mail"),
    domains: [...domains].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    takenOn: of("event", "Taken on"),
    quoted: of("event", "Quoted"),
    booked: of("event", "Booked"),
    steps: of("step"),
    lastAt: mine[0]?.at ?? null,
  };
}
