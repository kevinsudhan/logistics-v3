import { supabase } from "../lib/supabase";

/**
 * What reference, if any, a mail thread carries.
 *
 * ---------------------------------------------------------------------------
 * TWO SERIES, TWO TABLES, ONE QUESTION
 *
 * A conversation with an agent is one of three things, and the desk wants to
 * tell them apart at a glance:
 *
 *   ALG09012-26   it is about a shipment. `enquiry_threads` bound this
 *                 conversation to an enquiry, which happened automatically the
 *                 first time somebody filed it.
 *   PALG09003-26  it is partner correspondence somebody decided to track. A
 *                 rate negotiation, a credit argument, a change of contact.
 *                 Nothing mints these; a person presses the button.
 *   nothing       most mail. A line and an answer. Giving it a number would
 *                 spend the series on things nobody will ever look up.
 *
 * WHY NOT ONE TABLE WITH A KIND COLUMN
 *
 * Because `enquiry_threads` is not ours to change: it is how every filed
 * message reaches its case file, and it has a foreign key to `enquiries` that
 * carries the cascade. A partner thread has no enquiry and never will, so it
 * would sit in that table with a null where the not-null is. Two tables, each
 * saying one true thing.
 * ---------------------------------------------------------------------------
 */

export type RefKind = "shipment" | "partner" | "none";

export interface ThreadRef {
  conversationId: string;
  /** `ALG09012-26`, `PALG09003-26`, or null when the thread carries neither. */
  ref: string | null;
  kind: RefKind;
}

/**
 * The references for a set of conversations, in one round trip per series.
 *
 * Takes the ids rather than a partner, because the partner screen already
 * knows which conversations it is showing and asking again by partner would
 * answer a different question — a thread can involve an agent without anybody
 * having filed it against them.
 */
export async function refsFor(conversationIds: string[]): Promise<Map<string, ThreadRef>> {
  const out = new Map<string, ThreadRef>();
  const ids = [...new Set(conversationIds.filter(Boolean))];
  if (!ids.length) return out;

  const [enquiries, partners] = await Promise.all([
    supabase.from("enquiry_threads").select("conversation_id, enquiry_ref").in("conversation_id", ids),
    supabase.from("partner_threads").select("conversation_id, ref").in("conversation_id", ids),
  ]);

  if (enquiries.error) throw new Error(enquiries.error.message);
  if (partners.error) throw new Error(partners.error.message);

  for (const row of enquiries.data ?? []) {
    const r = row as { conversation_id: string; enquiry_ref: string };
    out.set(r.conversation_id, {
      conversationId: r.conversation_id,
      ref: r.enquiry_ref,
      kind: "shipment",
    });
  }

  // Partner references are applied second and deliberately do not overwrite a
  // shipment one. A thread that turned out to be about a job is about that job;
  // the enquiry reference is the one the customer has been quoted.
  for (const row of partners.data ?? []) {
    const r = row as { conversation_id: string; ref: string };
    if (out.has(r.conversation_id)) continue;
    out.set(r.conversation_id, { conversationId: r.conversation_id, ref: r.ref, kind: "partner" });
  }

  return out;
}

/** Gives a thread a PALG reference. Pressing twice returns the first one. */
export async function assignPartnerRef(input: {
  conversationId: string;
  partnerId: string;
  subject?: string;
  note?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("assign_partner_ref", {
    p_conversation_id: input.conversationId,
    p_partner_id: input.partnerId,
    p_subject: input.subject ?? "",
    p_note: input.note ?? "",
  });
  if (error) throw error;
  return (data as { ref: string }).ref;
}

/** What the filter chips offer, in the order they are shown. */
export const REF_FILTERS: Array<{ key: RefKind | "all"; label: string; hint: string }> = [
  { key: "all", label: "All", hint: "Every thread with this partner" },
  { key: "shipment", label: "ALG — shipments", hint: "Threads filed against an enquiry" },
  { key: "partner", label: "PALG — partner", hint: "Correspondence given its own reference" },
  { key: "none", label: "Unreferenced", hint: "Not tracked under either series" },
];
