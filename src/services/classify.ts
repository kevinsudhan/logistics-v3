import { supabase } from "../lib/supabase";
import type { MailMessage } from "./backend";
import { readForwardChain } from "./forwardChain";

/**
 * What a model thinks an email is.
 *
 * ---------------------------------------------------------------------------
 * A PROPOSAL, NOT A DECISION
 *
 * Nothing here writes. The reading is shown next to the message and the
 * operator decides what to do with it, exactly as they do with the website-form
 * parse in `webEnquiry.ts` — same principle, wider reach: that one reads a
 * known layout with regular expressions, this one reads prose.
 *
 * The two overlap on purpose. A Netlify submission has a fixed shape and the
 * regex is faster, free and cannot hallucinate, so it stays the first choice.
 * This is for the mail that arrives written by a person.
 *
 * WHY THE KEY IS NOT HERE
 *
 * It is in the `classify-enquiry` Edge Function, which is the only place it
 * exists. The function is deployed with verify_jwt on, so this call carries the
 * caller's Supabase session and an anonymous request gets a 401 rather than a
 * turn on somebody else's bill.
 * ---------------------------------------------------------------------------
 */

export interface Reading {
  is_enquiry: boolean;
  /** 0 to 1. Below 0.5 the model is saying it is unsure, and it means it. */
  confidence: number;
  reason: string;
  summary: string;

  /**
   * A reference the message already carries — "ENQ NO: 0293", a job number.
   *
   * Worth pulling out on its own because of what it means: the desk has already
   * numbered this. Pushing it through would allocate a second reference for
   * work that has one, and references are permanent. Shown so whoever is about
   * to press the button can match it instead.
   */
  reference: string | null;

  contact_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  origin: string | null;
  destination: string | null;

  /** What a consol agent asks for. Added to the function's schema in 046's pass. */
  incoterm?: string | null;
  ready_date?: string | null;
  pickup_location?: string | null;
  piece_count?: number | null;
  piece_length_cm?: number | null;
  piece_width_cm?: number | null;
  piece_height_cm?: number | null;
  weight_per_piece_kg?: number | null;
  gross_weight_kg?: number | null;
  volume_cbm?: number | null;
  consignee_name?: string | null;
  consignee_country?: string | null;
  stackable?: boolean | null;
  transport_mode?: "sea_lcl" | "sea_fcl" | "air" | "road" | null;
  consignee_address?: string | null;
  package_count?: number | null;
  package_type?: string | null;
  hs_code?: string | null;
  net_weight_kg?: number | null;
  msds_provided?: boolean | null;
  cfs_location?: string | null;
  cargo_cutoff?: string | null;
  si_cutoff?: string | null;
  marks_and_numbers?: string | null;
  freight_terms?: "prepaid" | "collect" | null;
  notify_name?: string | null;
  notify_address?: string | null;
  un_number?: string | null;
  imo_class?: string | null;
  packing_group?: "I" | "II" | "III" | null;
  flash_point_c?: number | null;

  /** What the job includes (061) and the cargo questions (063). */
  trade_direction?: "export" | "import" | "cross_trade" | null;
  pickup_required?: boolean | null;
  delivery_required?: boolean | null;
  delivery_location?: string | null;
  customer_reference?: string | null;
  expected_delivery_date?: string | null;
  transit_days?: number | null;
  hazardous?: boolean | null;
  /** Every distinct piece size, in centimetres and kilograms. */
  dimension_lines?: Array<{
    pieces: number | null;
    length_cm: number | null;
    width_cm: number | null;
    height_cm: number | null;
    weight_per_piece_kg: number | null;
    gross_weight_kg: number | null;
  }> | null;
  cargo: string | null;

  model: string;
  usage: { promptTokenCount?: number; candidatesTokenCount?: number } | null;
}

/** Fields the intake queue has a slot for, in the order they read on screen. */
export const READABLE: Array<[keyof Reading, string]> = [
  ["contact_name", "Name"],
  ["company", "Company"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["origin", "Origin"],
  ["destination", "Destination"],
  ["cargo", "Cargo"],
];

/**
 * Reads a message.
 *
 * The body is sent as text rather than HTML: the markup is a third of the
 * tokens and none of the meaning, and tokens are what this costs.
 */
export async function readMessage(m: MailMessage): Promise<Reading> {
  const html = m.body?.contentType === "html";
  const content = m.body?.content ?? m.bodyPreview ?? "";

  /**
   * The sender the model is told about is the real one, where it is knowable.
   *
   * A mail auto-forwarded by info@ arrives saying it is from info@, and telling
   * the model that is telling it something false — it then has to work back to
   * the customer from the body, which it sometimes does and sometimes does not.
   * `readForwardChain` establishes the original sender from headers and the
   * forward block by regular expression, so where it has an answer that answer
   * is a fact and is worth more than the model's reconstruction of it.
   *
   * Where it has no answer, nothing changes: the header sender is passed as
   * before and the prompt's own rules apply.
   */
  const chain = readForwardChain(m);

  return readText({
    subject: m.subject,
    from: chain?.originalFrom ?? m.from.emailAddress.address,
    body: html ? stripTags(content) : content,
  });
}

/**
 * The same read, from fields rather than a mailbox message.
 *
 * A queued row is not a MailMessage — it is what was kept of one, or something
 * typed in by hand after a phone call — and it is worth reading for a different
 * reason: on the queue the blank fields are the ones somebody is about to type,
 * so a proposal saves the typing rather than the judgement.
 */
export async function readText(input: {
  subject?: string | null;
  from?: string | null;
  body?: string | null;
}): Promise<Reading> {
  const { data, error } = await supabase.functions.invoke("classify-enquiry", {
    body: {
      subject: input.subject ?? undefined,
      from: input.from ?? undefined,
      body: input.body ?? undefined,
    },
  });

  if (error) throw new Error(error.message);
  // The function answers 200 with an `error` key for a Gemini-side failure, so
  // that Google's own message survives instead of being flattened to "failed".
  if (data && typeof data === "object" && "error" in data) {
    const d = data as { error: string; detail?: string };
    throw new Error(d.detail ? `${d.error} ${d.detail}` : d.error);
  }
  return data as Reading;
}

/**
 * Drafts a reply to a message.
 *
 * Returns the body only — no sign-off and no signature, because the compose
 * window already seeds the signature and a second one written by a model is how
 * a reply goes out signed twice.
 *
 * `instruction` is the operator's steer in their own words ("tell them the
 * space is confirmed, ask for the packing list"). Left empty, the model answers
 * what the thread asked.
 */
export async function draftReply(m: MailMessage, instruction?: string): Promise<string> {
  const html = m.body?.contentType === "html";
  const content = m.body?.content ?? m.bodyPreview ?? "";

  const { data, error } = await supabase.functions.invoke("classify-enquiry", {
    body: {
      mode: "draft",
      subject: m.subject,
      from: m.from.emailAddress.address,
      body: html ? stripTags(content) : content,
      instruction: instruction?.trim() || undefined,
    },
  });

  if (error) throw new Error(error.message);
  const d = data as { draft?: string; error?: string; detail?: string };
  if (d.error) throw new Error(d.detail ? `${d.error} ${d.detail}` : d.error);
  if (!d.draft) throw new Error("The model returned an empty draft.");
  return d.draft;
}

/** Which model names this key can reach — for pinning GEMINI_MODEL. */
export async function availableModels(): Promise<{ configured: string; available: string[] }> {
  const { data, error } = await supabase.functions.invoke("classify-enquiry", { method: "GET" });
  if (error) throw new Error(error.message);
  return data as { configured: string; available: string[] };
}

/**
 * HTML to something worth reading, without a parser.
 *
 * DOMParser would be more correct, but this runs on every classify and the
 * result is thrown at a model rather than rendered — so scripts, styles and
 * tags come out, entities are decoded, and blank lines are collapsed. Anything
 * subtler would be accuracy nobody can see.
 */
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
