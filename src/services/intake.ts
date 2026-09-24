import { supabase } from "../lib/supabase";
import type { Enquiry } from "./enquiries";
import type { MailMessage } from "./backend";
import { looksLikeWebEnquiry, parseWebEnquiry } from "./webEnquiry";

// Re-exported so callers keep one import for everything intake-shaped, while the
// logic itself lives somewhere a unit test can reach without a network client.
export { planApply, type ApplyPlan } from "./applyPlan";

/**
 * The intake queue: things that arrived and are not yet a case.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE SERVICE
 *
 * Every write that matters happens inside a database function, not here. Push a
 * row through and a customer, a reference, a linked call and two timeline
 * entries all appear together or none of them do. Doing that from the browser
 * in four calls would leave a customer with no enquiry behind every failed
 * network request, and the desk would grow duplicates on every retry.
 *
 * So this file is thin on purpose. It reads, and it names the four decisions:
 * capture, push, set aside, reopen.
 * ---------------------------------------------------------------------------
 */

export type IntakeStatus = "new" | "promoted" | "dismissed";
export type IntakeChannel = "call" | "email" | "whatsapp" | "web" | "walk_in" | "manual";

export const CHANNEL_LABEL: Record<IntakeChannel, string> = {
  call: "Phone call",
  email: "Email",
  whatsapp: "WhatsApp",
  web: "Web form",
  walk_in: "Walk-in",
  manual: "Entered by hand",
};

export const INTAKE_STATUS_LABEL: Record<IntakeStatus, string> = {
  new: "Waiting",
  promoted: "Pushed through",
  dismissed: "Set aside",
};

export interface Intake {
  id: string;
  status: IntakeStatus;
  channel: IntakeChannel;

  contact_name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;

  origin: string | null;
  destination: string | null;
  cargo: string | null;
  notes: string | null;

  call_id: string | null;
  message_id: string | null;
  conversation_id: string | null;
  subject: string | null;

  enquiry_ref: string | null;
  dismissed_reason: string | null;

  received_at: string;
  captured_by: string | null;
  settled_at: string | null;
  settled_by: string | null;
  updated_at: string;
}

/** Everything in the queue, newest arrival first. */
export async function listIntake(status?: IntakeStatus): Promise<Intake[]> {
  let q = supabase.from("intake").select("*");
  if (status) q = q.eq("status", status);
  const { data, error } = await q.order("received_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Intake[];
}

/** How many rows are waiting, counted by the database rather than by us. */
export async function countWaiting(): Promise<number> {
  const { count, error } = await supabase
    .from("intake")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  if (error) throw error;
  return count ?? 0;
}

/** Types a row into the queue by hand — the phone-on-the-desk case. */
export async function captureIntake(input: {
  channel: IntakeChannel;
  contact_name?: string;
  company?: string;
  phone?: string;
  email?: string;
  origin?: string;
  destination?: string;
  cargo?: string;
  notes?: string;
}): Promise<Intake> {
  const clean = <T extends string | undefined>(v: T) => (v && v.trim() ? v.trim() : null);
  const { data, error } = await supabase
    .from("intake")
    .insert({
      channel: input.channel,
      contact_name: clean(input.contact_name),
      company: clean(input.company),
      phone: clean(input.phone),
      email: clean(input.email)?.toLowerCase() ?? null,
      origin: clean(input.origin),
      destination: clean(input.destination),
      cargo: clean(input.cargo),
      notes: clean(input.notes),
    })
    .select()
    .single();
  if (error) throw error;
  return data as Intake;
}

/**
 * Puts an email in the queue.
 *
 * The message never touches the database until this is called: mail is read
 * from Graph at the moment somebody opens it, so the fields are passed in
 * rather than looked up. What the server does that the browser cannot is
 * decide whether this message is already queued or already filed, which is why
 * it is an RPC and not an insert.
 *
 * The conversation id travels with it. Bound at promotion, it is what makes
 * every later reply file itself against the new reference.
 */
export async function captureMessage(m: MailMessage): Promise<Intake> {
  // A website submission is read before it is filed. Its header sender is a
  // form mailer, so taking the contact from it would file every enquiry the
  // site ever produces under one customer called netlify.com.
  const web = looksLikeWebEnquiry(m) ? parseWebEnquiry(m) : null;

  const { data, error } = await supabase.rpc("capture_message_as_intake", {
    p_message_id: m.id,
    p_conversation_id: m.conversationId ?? null,
    p_subject: m.subject ?? null,
    p_received_at: m.receivedDateTime ?? null,
    p_channel: web ? "web" : "email",

    p_contact_name: web ? web.contact_name : m.from.emailAddress.name || null,
    p_email: web ? web.email : m.from.emailAddress.address || null,
    p_company: web?.company ?? null,
    p_phone: web?.phone ?? null,
    p_origin: web?.origin ?? null,
    p_destination: web?.destination ?? null,
    p_cargo: web?.cargo ?? null,

    // For a form, what the visitor typed. For anything else, the preview is
    // all there is without pulling the whole body down.
    p_preview: web ? web.notes : m.bodyPreview ?? null,
  });
  if (error) throw error;
  return data as Intake;
}

/**
 * Which of these messages are already in the queue, and what became of them.
 *
 * The mail list needs this to say "already queued" instead of offering a push
 * that would return the same row. Keyed by message id, so a lookup per row is
 * a map read rather than a request.
 */
export async function intakeByMessage(
  ids: string[]
): Promise<Map<string, Pick<Intake, "id" | "status" | "enquiry_ref">>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from("intake")
    .select("id, status, enquiry_ref, message_id")
    .in("message_id", ids);
  if (error) throw error;
  return new Map(
    (data ?? []).map((r) => [
      r.message_id as string,
      { id: r.id as string, status: r.status as IntakeStatus, enquiry_ref: r.enquiry_ref as string | null },
    ])
  );
}

/** Corrects a queued row before it is pushed through. */
export async function updateIntake(id: string, patch: Partial<Intake>): Promise<Intake> {
  const { data, error } = await supabase
    .from("intake")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Intake;
}

/**
 * Pushes a queued row into the inbound pipeline.
 *
 * `customerId` attaches it to a customer the desk already has. Left out, the
 * database decides: an email it has seen before returns that customer, and
 * anything else mints a new one.
 */
export async function promoteIntake(
  id: string,
  customerId?: string,
  /** Also take it on, so it lands on your own list rather than the shared board. */
  claim = false,
  /**
   * Hand it to this person instead. Needs the permission, which the database
   * checks inside the same transaction — so a refusal leaves no reference
   * behind rather than one nobody asked for.
   */
  assignTo?: string | null
): Promise<Enquiry> {
  const { data, error } = await supabase.rpc("promote_intake", {
    p_id: id,
    p_customer_id: customerId ?? null,
    p_claim: claim,
    p_assign_to: assignTo ?? null,
  });
  if (error) throw error;
  return data as Enquiry;
}

/**
 * Queue a message, push it through and take it on, in one press.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SKIPS THE QUEUE
 *
 * The queue exists so a reference is not allocated for every message in the
 * inbox. It earns that on a morning's unread mail, most of which is replies and
 * circulars. It earns nothing when somebody has the message open, has read it,
 * and knows it is theirs — the decision the queue defers has already been made,
 * and three presses to record a choice made in the first one is friction with
 * no safety attached.
 *
 * The row still passes through intake and is still promoted by the same
 * function under the same guards, so the trail is identical. Only the number of
 * presses changes.
 *
 * The two calls are deliberately not merged. If the second fails the first has
 * still left a row in the queue, which is the right place for it to wait and is
 * exactly where somebody would look for it.
 * ---------------------------------------------------------------------------
 */
/**
 * Queues a message, pushes it through, and puts it on somebody else's list.
 *
 * The permission is checked inside the same transaction as the promotion, so a
 * refusal leaves nothing behind — no customer, no reference, no row on the
 * board that nobody asked for. Checking it after the reference was allocated
 * would be checking it too late.
 */
export async function assignMessageTo(m: MailMessage, userId: string): Promise<Enquiry> {
  const row = await captureMessage(m);
  return promoteIntake(row.id, undefined, false, userId);
}

/**
 * A message straight onto the inbound board: queued and pushed through in one
 * press, for whoever takes it. The desk decides from the mail itself, so a
 * stop in a queue between the two was a stop nobody made.
 *
 * Not merged into one call, for the same reason as below: if the push is
 * refused (no name to open it under), the row waits in the queue, and the
 * Enquiries page lists what is waiting.
 */
export async function sendMessageToInbound(m: MailMessage): Promise<Enquiry> {
  const row = await captureMessage(m);
  return promoteIntake(row.id);
}

export async function takeMessageOn(m: MailMessage): Promise<Enquiry> {
  const row = await captureMessage(m);
  return promoteIntake(row.id, undefined, true);
}

/** Sets a row aside. The reason is required by the database, not just the form. */
export async function dismissIntake(id: string, reason: string): Promise<Intake> {
  const { data, error } = await supabase.rpc("dismiss_intake", { p_id: id, p_reason: reason });
  if (error) throw error;
  return data as Intake;
}

/** Puts a set-aside row back in the queue. */
export async function reopenIntake(id: string): Promise<Intake> {
  const { data, error } = await supabase.rpc("reopen_intake", { p_id: id });
  if (error) throw error;
  return data as Intake;
}

/**
 * What is missing before this row can become an enquiry.
 *
 * The same rule the database enforces, stated in the interface so the button
 * can say why it is disabled rather than failing on the press. Keeping both is
 * deliberate: the server rule is the one that counts, and this one exists only
 * so nobody has to discover it by being refused.
 */
export function blocksPromotion(row: Intake, customerId?: string): string | null {
  if (customerId) return null;
  const named = (row.contact_name ?? "").trim() || (row.company ?? "").trim();
  if (!named) return "Add a caller name or a company, or pick an existing customer.";
  return null;
}
