import { supabase } from "../lib/supabase";
import { conversationMessages, sendTrackedMail, type MailMessage } from "./backend";
import type { Enquiry } from "./enquiries";

/**
 * Asking partners for a rate, and tracking what comes back.
 *
 * ---------------------------------------------------------------------------
 * WHY EACH PARTNER IS WRITTEN TO SEPARATELY
 *
 * One mail with six recipients is one conversation. Every reply would land in
 * the same thread and there would be no way to say which agent quoted what —
 * the thing the whole feature exists to answer.
 *
 * It also means no partner sees who else was asked, which is how a rate request
 * should work. They are competing; telling each of them that is a choice nobody
 * made deliberately.
 * ---------------------------------------------------------------------------
 */

export type QuoteStatus = "asked" | "replied" | "quoted" | "declined" | "no_reply";

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  asked: "Waiting",
  replied: "Replied",
  quoted: "Quoted",
  declined: "Declined",
  no_reply: "No reply",
};

export interface PartnerQuote {
  id: string;
  enquiry_ref: string;
  partner_id: string | null;
  partner_email: string;
  partner_label: string;
  batch_id: string;

  sent_at: string;
  sent_by: string | null;
  subject: string;
  conversation_id: string | null;
  sent_message_id: string | null;

  status: QuoteStatus;
  replied_at: string | null;
  reply_message_id: string | null;
  amount: number | null;
  currency: string | null;
  transit_days: number | null;
  valid_until: string | null;
  quote_notes: string | null;

  created_at: string;
  updated_at: string;
}

export async function listQuotes(ref: string): Promise<PartnerQuote[]> {
  const { data, error } = await supabase
    .from("partner_quotes")
    .select("*")
    .eq("enquiry_ref", ref)
    .order("sent_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PartnerQuote[];
}

/**
 * The request, written from what the enquiry actually knows.
 *
 * ---------------------------------------------------------------------------
 * IT ASKS FOR WHAT IS MISSING AND STATES WHAT IS NOT
 *
 * A rate request that says "please quote" and nothing else produces a reply
 * asking for the details, which costs a day. Everything the enquiry holds goes
 * in; everything it does not is simply absent rather than written as "TBA",
 * because a partner reading "Weight: TBA" learns nothing they did not already
 * know from its absence.
 *
 * NO FIGURE IS INVENTED HERE
 *
 * Every value is copied from the enquiry row. There is no model in this path —
 * a rate request that guessed at a volume would have somebody quoting against
 * a cargo that does not exist.
 * ---------------------------------------------------------------------------
 */
export function draftRequest(
  enquiry: Enquiry,
  fromName: string
): { subject: string; body: string } {
  const route = [enquiry.origin, enquiry.destination].filter(Boolean).join(" to ");
  const subject = route
    ? `Rate & space enquiry — ${route}${enquiry.cargo ? ` — ${enquiry.cargo}` : ""}`
    : `Rate & space enquiry — ${enquiry.ref}`;

  const rows = ([
    ["Origin", enquiry.origin],
    ["Destination", enquiry.destination],
    ["Commodity", enquiry.cargo],
    ["Incoterm", enquiry.incoterm],
    ["Pieces", enquiry.piece_count != null ? String(enquiry.piece_count) : null],
    ["Gross weight", enquiry.gross_weight_kg != null ? `${enquiry.gross_weight_kg} kg` : null],
    ["Volume", enquiry.volume_cbm != null ? `${enquiry.volume_cbm} CBM` : null],
    ["Cargo ready", enquiry.ready_date],
    ["Pick-up", enquiry.pickup_location],
  ] as Array<[string, string | null]>).filter(([, v]) => v != null && String(v).trim() !== "");

  const detail = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 14px 2px 0;color:#52544b">${k}</td>` +
        `<td style="padding:2px 0"><strong>${escapeHtml(String(v))}</strong></td></tr>`
    )
    .join("");

  const body = [
    `<p>Dear partner,</p>`,
    `<p>We have the following shipment in hand and would appreciate your best rate` +
      ` and confirmation of space.</p>`,
    `<table style="border-collapse:collapse;font-size:13px">${detail}</table>`,
    `<p>Kindly advise:</p>`,
    `<ul>`,
    `<li>All-in rate and the basis it is quoted on</li>`,
    `<li>Space availability and the next sailing you can take this on</li>`,
    `<li>Transit time and free days at destination</li>`,
    `<li>Validity of the rate</li>`,
    `</ul>`,
    `<p>We would be grateful for your reply at the earliest so we may revert to our customer.</p>`,
    `<p>Best regards,<br>${escapeHtml(fromName)}<br>Aashish Logistics Global</p>`,
  ].join("");

  return { subject, body };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The enquiry as plain facts, for a model that is allowed to use nothing else.
 *
 * Built from the same rows the template uses, so the two versions of the
 * request are working from an identical set of facts and differ only in how
 * they are written. A field the enquiry does not hold is simply absent — there
 * is nothing here for the model to mistake for a value.
 */
function factsFor(enquiry: Enquiry): string {
  return (
    [
      ["Our reference", enquiry.ref],
      ["Origin", enquiry.origin],
      ["Destination", enquiry.destination],
      ["Commodity", enquiry.cargo],
      ["Incoterm", enquiry.incoterm],
      ["Pieces", enquiry.piece_count != null ? String(enquiry.piece_count) : null],
      ["Gross weight", enquiry.gross_weight_kg != null ? `${enquiry.gross_weight_kg} kg` : null],
      ["Volume", enquiry.volume_cbm != null ? `${enquiry.volume_cbm} CBM` : null],
      ["Cargo ready", enquiry.ready_date],
      ["Pick-up", enquiry.pickup_location],
      ["Stackable", enquiry.stackable == null ? null : enquiry.stackable ? "yes" : "no"],
    ] as Array<[string, string | null]>
  )
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/**
 * The request, written by a model to an operator's brief.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE DEFAULT
 *
 * `draftRequest` above copies every figure straight off the enquiry row and
 * cannot get one wrong. That is the right thing to send most of the time, and
 * it is what the dialog opens with.
 *
 * This exists for the times the standard request is not the point — a chaser to
 * an agent who has gone quiet, a request that hinges on one awkward condition,
 * a partner who needs a different tone. Those are things an operator can
 * describe in a sentence and cannot express by editing a template.
 *
 * THE SUBJECT IS NOT REGENERATED
 *
 * It is built from the route and the commodity, which is what makes a partner's
 * reply thread and what makes it findable later. A model rewriting it gains a
 * nicer line and loses that.
 * ---------------------------------------------------------------------------
 */
export async function draftRequestWithAi(input: {
  enquiry: Enquiry;
  fromName: string;
  /** What the operator says this particular request should do. */
  instruction: string;
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke("classify-enquiry", {
    body: {
      mode: "rfq",
      subject: `Rate request from ${input.fromName}`,
      from: input.fromName,
      body: [
        "SHIPMENT DETAILS (use only these; invent nothing):",
        factsFor(input.enquiry),
        "",
        `SENDER: ${input.fromName}, Aashish Logistics Global`,
        "",
        `WHAT THIS REQUEST SHOULD DO: ${input.instruction.trim()}`,
      ].join("\n"),
    },
  });

  if (error) throw new Error(error.message);
  const d = data as { draft?: string; error?: string; detail?: string };
  if (d.error) throw new Error(d.detail ? `${d.error} ${d.detail}` : d.error);
  if (!d.draft) throw new Error("The model returned an empty request.");
  return d.draft;
}

export interface BurstResult {
  sent: PartnerQuote[];
  failed: Array<{ email: string; label: string; reason: string }>;
}

/**
 * Sends the request to each partner and records each one.
 *
 * ---------------------------------------------------------------------------
 * SENT ONE AT A TIME, AND RECORDED ONLY ON SUCCESS
 *
 * Sequential rather than in parallel: six simultaneous sends against a throttled
 * mailbox is how you get three of them refused, and this is not a hot path.
 *
 * A failure does not stop the rest. Five agents asked and one that could not be
 * reached is a far better outcome than the whole burst abandoned halfway, and
 * the failures are returned so the operator can see exactly who to chase by
 * hand. Nothing is recorded for a send that did not happen — a row saying
 * somebody was asked when they were not is worse than no row.
 * ---------------------------------------------------------------------------
 */
export async function sendBurst(input: {
  enquiry: Enquiry;
  partners: Array<{ id: string | null; email: string; label: string }>;
  subject: string;
  body: string;
}): Promise<BurstResult> {
  const batchId = crypto.randomUUID();
  const sent: PartnerQuote[] = [];
  const failed: BurstResult["failed"] = [];

  for (const p of input.partners) {
    try {
      const { conversationId } = await sendTrackedMail({
        to: [p.email],
        subject: input.subject,
        content: input.body,
      });

      const { data, error } = await supabase.rpc("record_rfq_sent", {
        p_ref: input.enquiry.ref,
        p_batch_id: batchId,
        p_partner_email: p.email,
        p_partner_label: p.label,
        p_partner_id: p.id,
        p_subject: input.subject,
        p_conversation_id: conversationId,
        p_message_id: null,
      });
      if (error) throw new Error(error.message);
      sent.push(data as PartnerQuote);
    } catch (e) {
      failed.push({
        email: p.email,
        label: p.label,
        reason: e instanceof Error ? e.message : "Could not send.",
      });
    }
  }

  return { sent, failed };
}

export interface FoundReply {
  quote: PartnerQuote;
  message: MailMessage;
}

/**
 * Looks for replies to the asks that are still waiting.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RUNS WHEN SOMEBODY LOOKS
 *
 * There is no server watching the mailbox — the CRM reads mail with the signed-
 * in person's own delegated token, which exists only while they are here. So
 * the check happens when the enquiry is opened, which is exactly when the
 * answer matters.
 *
 * WHAT COUNTS AS A REPLY
 *
 * A message in the conversation we started, that we did not send. The second
 * half matters: our own request is in that conversation too, and without the
 * test every ask would immediately report itself as its own reply.
 *
 * The sender address is deliberately NOT required to equal the one we wrote to.
 * Agents reply from shared mailboxes, from a colleague's account, from the
 * address the rate desk actually uses — and a reply in the thread we started is
 * a reply regardless of which of their addresses it came from.
 * ---------------------------------------------------------------------------
 */
export async function findReplies(
  mailbox: string,
  quotes: PartnerQuote[]
): Promise<FoundReply[]> {
  const waiting = quotes.filter((q) => q.conversation_id && q.status === "asked");
  const ours = mailbox.toLowerCase();

  /*
    All at once, not one after another.

    This used to await inside the loop, so checking six partners for replies
    was six Graph round trips end to end — and this runs behind a button an
    operator presses while looking at the screen. They are independent
    questions about different conversations; nothing here reads the previous
    answer.

    The catch stays per conversation, which is what it was for: one unreadable
    thread should not stop the others being checked. `Promise.all` would reject
    the lot on the first failure, so each promise swallows its own and returns
    nothing.
  */
  const results = await Promise.all(
    waiting.map(async (q): Promise<FoundReply | null> => {
      try {
        const msgs = await conversationMessages(mailbox, q.conversation_id!);
        const reply = msgs
          .filter((m) => (m.from.emailAddress.address ?? "").toLowerCase() !== ours)
          .sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime))[0];
        return reply ? { quote: q, message: reply } : null;
      } catch {
        return null;
      }
    })
  );

  return results.filter((r): r is FoundReply => r !== null);
}

export interface QuoteReading {
  amount: number | null;
  currency: string | null;
  basis: string | null;
  transit_days: number | null;
  valid_until: string | null;
  space_confirmed: boolean | null;
  declined: boolean;
  notes: string;
}

/**
 * A date the database will accept, or nothing.
 *
 * The schema asks the model for YYYY-MM-DD and it does not always comply — a
 * reply saying "valid till 30 September 2026" comes back in those words. The
 * column is a real `date`, so the choice is to parse it here or to hand
 * Postgres a string and hope. Anything unrecognised becomes null, which is the
 * honest answer: the validity is still in the notes for a person to read.
 */
function asDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  // Back to a plain date, in local terms — a validity is a day, not an instant.
  const p = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${p(parsed.getMonth() + 1)}-${p(parsed.getDate())}`;
}

/**
 * Reads the rate out of a partner's reply.
 *
 * Through the same Edge Function as everything else, so the Gemini key stays in
 * one place. A failure here is not a failure of the whole check: the reply is
 * still recorded, just without a number on it, which is the state a person
 * resolves by opening the mail.
 */
export async function readQuote(m: MailMessage): Promise<QuoteReading | null> {
  const html = m.body?.contentType === "html";
  const content = m.body?.content ?? m.bodyPreview ?? "";

  const { data, error } = await supabase.functions.invoke("classify-enquiry", {
    body: {
      mode: "quote",
      subject: m.subject,
      from: m.from.emailAddress.address,
      body: html ? stripTags(content) : content,
    },
  });
  if (error) return null;
  const d = data as Partial<QuoteReading> & { error?: string };
  if (!d || d.error) return null;

  return {
    amount: typeof d.amount === "number" ? d.amount : null,
    currency: d.currency?.trim().toUpperCase() || null,
    basis: d.basis?.trim() || null,
    transit_days: typeof d.transit_days === "number" ? d.transit_days : null,
    valid_until: asDate(d.valid_until),
    space_confirmed: typeof d.space_confirmed === "boolean" ? d.space_confirmed : null,
    declined: d.declined === true,
    // The basis belongs with the figure — "8500" and "8500 per CBM" are very
    // different numbers, and only one column holds the amount.
    notes: [d.basis?.trim() ? `Basis: ${d.basis.trim()}` : null, d.notes?.trim() || null]
      .filter(Boolean)
      .join(" — "),
  };
}

/** Markup out, so the model reads words rather than tags. */
function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function recordReply(
  id: string,
  input: {
    messageId: string;
    repliedAt?: string;
    amount?: number | null;
    currency?: string | null;
    transitDays?: number | null;
    validUntil?: string | null;
    notes?: string | null;
    declined?: boolean;
  }
): Promise<PartnerQuote> {
  const { data, error } = await supabase.rpc("record_rfq_reply", {
    p_id: id,
    p_message_id: input.messageId,
    p_replied_at: input.repliedAt ?? new Date().toISOString(),
    p_amount: input.amount ?? null,
    p_currency: input.currency ?? null,
    p_transit_days: input.transitDays ?? null,
    p_valid_until: input.validUntil ?? null,
    p_notes: input.notes ?? null,
    p_declined: input.declined ?? false,
  });
  if (error) throw new Error(error.message);
  return data as PartnerQuote;
}

/** A correction by hand, when the reading was wrong. */
export async function setQuote(
  id: string,
  input: {
    amount?: number | null;
    currency?: string | null;
    transitDays?: number | null;
    validUntil?: string | null;
    notes?: string | null;
    status?: QuoteStatus | null;
  }
): Promise<PartnerQuote> {
  const { data, error } = await supabase.rpc("set_quote", {
    p_id: id,
    p_amount: input.amount ?? null,
    p_currency: input.currency ?? null,
    p_transit_days: input.transitDays ?? null,
    p_valid_until: input.validUntil ?? null,
    p_notes: input.notes ?? null,
    p_status: input.status ?? null,
  });
  if (error) throw new Error(error.message);
  return data as PartnerQuote;
}

export async function markNoReply(id: string): Promise<void> {
  const { error } = await supabase.rpc("mark_no_reply", { p_id: id });
  if (error) throw new Error(error.message);
}

/** The cheapest quote on the board, when there is more than one to compare. */
export function bestOf(quotes: PartnerQuote[]): PartnerQuote | null {
  const priced = quotes.filter((q) => q.amount != null && q.status === "quoted");
  if (priced.length < 2) return null;
  // Only comparable within one currency. Mixed currencies need a rate nobody
  // here has, and picking a "best" across them would be arithmetic on guesses.
  const currencies = new Set(priced.map((q) => (q.currency ?? "").toUpperCase()));
  if (currencies.size > 1) return null;
  return priced.reduce((a, b) => (a.amount! <= b.amount! ? a : b));
}

/**
 * How the partner asks are going, for every enquiry on the board at once.
 *
 * ---------------------------------------------------------------------------
 * ONE QUERY, NOT ONE PER ROW
 *
 * The board shows forty enquiries. Asking each one separately whether it has
 * partner quotes would be forty requests to render one line of text per row,
 * and the whole table is small enough to summarise in a single read.
 *
 * Rows with no asks are simply absent from the map rather than present as
 * zeroes — the caller shows nothing for them, which is the truthful answer.
 * ---------------------------------------------------------------------------
 */
export interface QuoteProgress {
  asked: number;
  waiting: number;
  quoted: number;
  declined: number;
  /** The lowest figure among the quotes, where they are comparable. */
  best: number | null;
  currency: string | null;
}

export async function quoteProgress(refs: string[]): Promise<Map<string, QuoteProgress>> {
  if (!refs.length) return new Map();

  const { data, error } = await supabase
    .from("partner_quotes")
    .select("enquiry_ref, status, amount, currency")
    .in("enquiry_ref", refs);
  if (error) throw new Error(error.message);

  const out = new Map<string, QuoteProgress>();
  for (const row of data ?? []) {
    const ref = row.enquiry_ref as string;
    const p =
      out.get(ref) ??
      ({ asked: 0, waiting: 0, quoted: 0, declined: 0, best: null, currency: null } as QuoteProgress);

    p.asked++;
    if (row.status === "asked") p.waiting++;
    if (row.status === "quoted") p.quoted++;
    if (row.status === "declined") p.declined++;

    const amount = row.amount == null ? null : Number(row.amount);
    if (row.status === "quoted" && amount != null && Number.isFinite(amount)) {
      // Only comparable within one currency. Mixed currencies need a rate
      // nobody here has, so the figure is dropped rather than guessed at.
      const cur = (row.currency as string | null)?.toUpperCase() ?? null;
      if (p.best == null) {
        p.best = amount;
        p.currency = cur;
      } else if (p.currency === cur) {
        p.best = Math.min(p.best, amount);
      } else {
        p.best = null;
        p.currency = null;
      }
    }

    out.set(ref, p);
  }
  return out;
}
