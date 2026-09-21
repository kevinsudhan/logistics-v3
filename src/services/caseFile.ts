/**
 * The case file: customers, enquiries, and the parties on each shipment.
 *
 * ---------------------------------------------------------------------------
 * WHY THE REFERENCE IS OURS AND NOT MICROSOFT'S
 *
 * A shipment is not one email thread. It is the customer, the shipping line,
 * the CFS, the customs broker, the trucker and the overseas agent -- six or
 * more separate threads, each with its own conversationId, plus phone calls.
 * No thread identifier can span those, so the enquiry reference is issued by
 * this system and everything else attaches to it.
 *
 * It also has to exist before any email does: a phone call creates an enquiry,
 * and that enquiry needs an identity immediately.
 *
 * conversationId is not discarded -- it demotes. It stops being the identity
 * and becomes one auto-filing signal alongside the subject token, the sender's
 * address, and container or BL numbers found in the body.
 * ---------------------------------------------------------------------------
 */

/** Who a correspondent is to a shipment. Drives the grouping on the case file. */
export type PartyRole =
  | "client"
  // The far-end agent. Filing them under "Other" was always wrong, and became
  // untenable once assigning a partner started creating parties by itself.
  | "overseas_agent"
  | "consol_partner"
  | "carrier"
  | "cha_customs"
  | "cfs_transport"
  | "other";

export const ROLE_LABEL: Record<PartyRole, string> = {
  client: "Client side",
  overseas_agent: "Overseas agents",
  consol_partner: "Consol partners",
  carrier: "Carrier / line",
  cha_customs: "CHA / customs",
  cfs_transport: "CFS / transport",
  other: "Other",
};

/** Display order on the case file — the customer first, incidental parties last. */
export const ROLE_ORDER: PartyRole[] = [
  "client",
  "overseas_agent",
  "consol_partner",
  "carrier",
  "cha_customs",
  "cfs_transport",
  "other",
];

export interface Customer {
  /** C0042 — stable, and the first half of every enquiry reference. */
  id: string;
  name: string;
  company: string;
  phones: string[];
  emails: string[];
}

export interface Party {
  enquiryRef: string;
  role: PartyRole;
  name: string;
  organisation: string;
  emails: string[];
}

export interface Enquiry {
  /** ARX-C0042-E03 — customer, then their third enquiry. */
  ref: string;
  customerId: string;
  /** The pipeline record this enquiry became, when it has one. */
  recordRef?: string;
  subject: string;
  origin: string;
  destination: string;
  cargo: string;
  volumeCbm?: number;
  containerCode?: string;
  containerNumber?: string;
  blNumber?: string;
  sailingDate?: string;
  stage: "enquiry" | "quoted" | "booked" | "in_transit" | "delivered";
  openedAt: string;
}

/** One mail thread belonging to an enquiry. An enquiry accumulates several. */
export interface EnquiryThread {
  enquiryRef: string;
  conversationId: string;
}

// ---------------------------------------------------------------------------
// Reference formatting
// ---------------------------------------------------------------------------

/**
 * The token embedded in outbound subjects so replies file themselves.
 *
 * Square brackets rather than parentheses: mail clients rewrite subjects on
 * reply and forward, and brackets survive that more reliably than most
 * punctuation while staying visually obvious to a human reading the subject.
 */
export const subjectToken = (ref: string) => `[${ref}]`;

/**
 * The three shapes a reference has ever had, newest first.
 *
 * ---------------------------------------------------------------------------
 * WHY THE OLD ONE IS STILL HERE
 *
 * `ARX-C0001-E01` stopped being minted in 044, but it is on every subject line
 * of every thread opened before then — and those threads are still running. A
 * customer replying today to a quotation sent last month sends back the token
 * they were given, and a parser that only knows the new shape would fail to
 * file it. References are permanent precisely so that this keeps working; the
 * reader has to be as long-lived as the thing it reads.
 *
 * PALG BEFORE ALG
 *
 * Alternation is first-match, and `ALG` is a suffix of `PALG`. Put the shorter
 * one first and `[PALG09003-26]` matches from the `ALG`, yielding a reference
 * that looks valid, belongs to the wrong series, and points at nothing.
 * ---------------------------------------------------------------------------
 */
const TOKEN_RE = /\[((?:PALG|ALG)\d{5}-\d{2}|ARX-C\d{4}-E\d{2})\]/i;

/** Pulls a reference out of a subject line, if the sender left ours intact. */
export function refFromSubject(subject: string): string | null {
  return subject.match(TOKEN_RE)?.[1]?.toUpperCase() ?? null;
}

/** Which series a reference belongs to, from the reference alone. */
export function seriesOf(ref: string): "shipment" | "partner" | null {
  const r = ref.toUpperCase();
  if (r.startsWith("PALG")) return "partner";
  if (r.startsWith("ALG") || r.startsWith("ARX-")) return "shipment";
  return null;
}

/** Adds the token to a subject, without doubling it on a reply. */
export function withToken(subject: string, ref: string): string {
  return refFromSubject(subject) ? subject : `${subjectToken(ref)} ${subject}`;
}

/*
 * `nextRef` used to live here: it worked out the next enquiry number for a
 * customer, in the ARX-C0001-E01 form, from the refs already in hand.
 *
 * It is gone rather than updated. Nothing called it — allocation moved into the
 * database, where `allocate_reference` takes the counter under a lock, because
 * two operators opening an enquiry in the same second would otherwise both read
 * the same maximum and mint the same reference. A client-side version of that
 * calculation cannot be made correct, and one sitting here still producing the
 * old format is a thing somebody would reach for on the assumption that it was.
 */

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

export interface FilingSignal {
  ref: string;
  /** How the link was established, shown in the UI so a guess never looks certain. */
  via: "thread" | "subject" | "reference-in-body" | "manual";
  confidence: "certain" | "likely";
}

/**
 * Works out which enquiry a message belongs to.
 *
 * Ordered by how much it can be trusted. A thread match is certain -- Outlook
 * itself says these messages are one conversation. A subject token is certain
 * too, since we put it there. A container or BL number in the body is only
 * likely: carriers routinely mention several bookings in one message.
 *
 * Returning null is a real answer. A misfiled email is worse than an unfiled
 * one, because it puts one customer's correspondence into another's file, so
 * anything unresolved goes to triage rather than to a best guess.
 */
export function fileMessage(
  message: { subject: string; conversationId: string; body: string },
  threads: EnquiryThread[],
  enquiries: Enquiry[]
): FilingSignal | null {
  const byThread = threads.find((t) => t.conversationId === message.conversationId);
  if (byThread) return { ref: byThread.enquiryRef, via: "thread", confidence: "certain" };

  const fromSubject = refFromSubject(message.subject);
  if (fromSubject && enquiries.some((e) => e.ref === fromSubject)) {
    return { ref: fromSubject, via: "subject", confidence: "certain" };
  }

  const haystack = `${message.subject} ${message.body}`.toUpperCase();
  const byNumber = enquiries.find(
    (e) =>
      (e.containerNumber && haystack.includes(e.containerNumber.toUpperCase())) ||
      (e.blNumber && haystack.includes(e.blNumber.toUpperCase()))
  );
  if (byNumber) {
    return { ref: byNumber.ref, via: "reference-in-body", confidence: "likely" };
  }

  return null;
}

/**
 * The role an address plays, from the parties already recorded.
 *
 * Deliberately not inferred from the address itself: ops@msc-agency.in is a
 * carrier only because somebody said so. An unrecognised sender comes back as
 * null and is asked about once, which is how the directory fills up.
 */
export function roleOf(address: string, parties: Party[]): PartyRole | null {
  const a = address.trim().toLowerCase();
  return parties.find((p) => p.emails.some((e) => e.toLowerCase() === a))?.role ?? null;
}
