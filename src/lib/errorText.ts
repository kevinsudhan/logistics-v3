/**
 * What to put on screen when a database call fails.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT JUST `e.message`
 *
 * Postgres splits a failure into a message and a hint, and our RPCs use both
 * deliberately. `promote_enquiry` is the clearest case:
 *
 *   message: Cannot start a shipment: ARX-C0007-E01 was accepted on a call
 *            but not confirmed in writing
 *   hint:    Send the quotation and confirm from their reply, or record the
 *            confirmation with a note.
 *
 * The message says what is wrong. The hint says what to do about it. Showing
 * only the message leaves somebody correctly informed and still stuck, which
 * is how a working guard comes to be reported as a bug.
 *
 * postgrest-js says the same thing in its own PostgrestError docstring: the
 * single most useful field is usually `hint`.
 *
 * WHY THE HINT IS RETURNED SEPARATELY RATHER THAN CONCATENATED
 *
 * So the caller can set it in quieter type underneath. Run together they read
 * as one long sentence and the instruction gets lost in the complaint.
 * ---------------------------------------------------------------------------
 */

/** A PostgrestError carries these alongside the standard Error fields. */
function hintOf(e: unknown): string | null {
  if (e && typeof e === "object" && "hint" in e) {
    const h = (e as { hint?: unknown }).hint;
    if (typeof h === "string" && h.trim()) return h.trim();
  }
  return null;
}

export interface FailureText {
  message: string;
  hint: string | null;
}

/**
 * @param fallback what to say when the error carries nothing readable — always
 *   phrased as what failed, never "something went wrong".
 */
export function failureText(e: unknown, fallback: string): FailureText {
  const message = e instanceof Error && e.message.trim() ? e.message : fallback;
  return { message, hint: hintOf(e) };
}
