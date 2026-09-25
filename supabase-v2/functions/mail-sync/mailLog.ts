/**
 * What a sent mail was, read from its subject (086).
 *
 * ---------------------------------------------------------------------------
 * Team oversight lists every mail the desk sends, whether from the CRM or
 * straight from Outlook. The CRM's own mails have subjects it wrote — "[ALG…]
 * Booking confirmation", "… PRE-ALERT …", "Quotation ALG…" — so the kind and
 * the job can be read back from the subject even when the mail comes in from
 * Outlook's Sent Items rather than from the CRM's send button. Anything else is
 * a reply, a forward, or other mail, said as such rather than guessed at.
 * ---------------------------------------------------------------------------
 */

export type MailKind =
  | "quotation"
  | "confirmation"
  | "pre_alert"
  | "update"
  | "tracking"
  | "transport"
  | "rfq"
  | "reply"
  | "forward"
  | "other";

export const MAIL_KIND_LABEL: Record<MailKind, string> = {
  quotation: "Quotation",
  confirmation: "Booking confirmation",
  pre_alert: "Pre-alert",
  update: "Shipment update",
  tracking: "Tracking link",
  transport: "Pickup / delivery request",
  rfq: "Rate request",
  reply: "Reply",
  forward: "Forward",
  other: "New mail",
};

/** In order: the first that matches decides. A reply to a quotation is a reply. */
const RULES: Array<[RegExp, MailKind]> = [
  [/^\s*(re|aw|antw|sv)\s*:/i, "reply"],
  [/^\s*(fw|fwd|wg)\s*:/i, "forward"],
  [/pre-?alert/i, "pre_alert"],
  [/booking confirmation/i, "confirmation"],
  [/\bquotation\b/i, "quotation"],
  [/shipment update/i, "update"],
  [/track your shipment/i, "tracking"],
  [/(pickup|delivery) request/i, "transport"],
  [/rate request/i, "rfq"],
];

export function mailKind(subject: string | null | undefined): MailKind {
  const s = subject ?? "";
  return RULES.find(([re]) => re.test(s))?.[1] ?? "other";
}

/**
 * The job or partner reference a subject carries: our token "[ALG09004-26]"
 * first, then a bare one ("Quotation ALG09004-26"), so a quotation subject —
 * which has no brackets — still lands on its job.
 */
export function refInSubject(subject: string | null | undefined): string | null {
  const s = subject ?? "";
  const token = s.match(/\[((?:PALG|ALG)\d{5}-\d{2})\]/i);
  if (token) return token[1].toUpperCase();
  const bare = s.match(/\b((?:PALG|ALG)\d{5}-\d{2})\b/i);
  return bare ? bare[1].toUpperCase() : null;
}

/** "ops@gfp.ae" → "gfp.ae": who a mail went to, by company, for grouping. */
export const domainOf = (address: string) => (address.split("@")[1] ?? "").toLowerCase();

export interface Addressee {
  name: string;
  address: string;
}

/** "Omar (ops@gfp.ae), Wei Ling +2" — the to line, short enough for a table cell. */
export function recipientsText(list: Addressee[], max = 2): string {
  const shown = list.slice(0, max).map((r) => (r.name && r.name !== r.address ? `${r.name} <${r.address}>` : r.address));
  const more = list.length - shown.length;
  return shown.join(", ") + (more > 0 ? ` +${more}` : "");
}
