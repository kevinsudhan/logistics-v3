import { supabase } from "../lib/supabase";
import type { MailMessage } from "./mockMail";

/**
 * A record of what the CRM answered, when, and by whom.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS WRITTEN HERE AND NOT READ FROM THE MAILBOX
 *
 * Graph access is delegated: a token reaches the signed-in person's mailbox and
 * nobody else's. An administrator asking "did anyone get back to Gulf Line"
 * cannot be answered from a token that can only see one inbox, and widening the
 * app to application-level mail permissions would trade everyone's privacy for
 * a timestamp.
 *
 * Sending is the one moment where all of it is known at once: who is signed in,
 * what they are answering, and when that thing arrived. So it is recorded then.
 *
 * WHAT IT DOES NOT SEE
 *
 * A reply sent from Outlook rather than from here. That thread will look
 * unanswered on this log while plainly having been answered in the mailbox.
 * The admin screen says so; the number is what the CRM sent, not a claim about
 * what the desk did.
 * ---------------------------------------------------------------------------
 */

export interface ReplyLogRow {
  id: string;
  conversation_id: string;
  subject: string;
  inbound_from: string;
  inbound_at: string | null;
  replied_at: string;
  partner_id: string | null;
  partner: string;
  replied_by_name: string;
  /** Null when the inbound time was unknown — not zero, which would read as instant. */
  hours_to_reply: number | null;
}

/**
 * Records that a reply went out.
 *
 * Deliberately swallows its own failure. This is a log, and a log that can stop
 * somebody answering an agent is worse than a log with a gap in it — the reply
 * has already been sent by the time this runs, so throwing here would report a
 * successful send as a failure and invite them to send it twice.
 */
export async function recordReply(input: {
  repliedTo: MailMessage;
  partnerId?: string | null;
}): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;

    const m = input.repliedTo;
    await supabase.from("mail_replies").insert({
      conversation_id: m.conversationId || m.id,
      in_reply_to_id: m.id,
      subject: m.subject ?? "",
      inbound_from: m.from?.emailAddress?.address ?? "",
      inbound_at: m.receivedDateTime ?? null,
      partner_id: input.partnerId ?? null,
      replied_by: uid,
    });
  } catch {
    // See above: never let bookkeeping surface as a send failure.
  }
}

/**
 * The log, newest first.
 *
 * RLS decides what comes back: an administrator sees the desk, everybody else
 * sees their own replies. The caller does not filter by person, because a
 * filter in the client would be a suggestion rather than a rule.
 */
export async function listReplies(limit = 50): Promise<ReplyLogRow[]> {
  const { data, error } = await supabase
    .from("partner_reply_log")
    .select("*")
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ReplyLogRow[];
}

/** "3h 40m", "2 days", or "—" when the inbound time was never known. */
export function describeDelay(hours: number | null): string {
  if (hours === null || hours === undefined) return "—";
  if (hours < 0) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) {
    const h = Math.floor(hours);
    const mins = Math.round((hours - h) * 60);
    return mins ? `${h}h ${mins}m` : `${h}h`;
  }
  const days = hours / 24;
  return days < 2 ? "1 day" : `${Math.round(days)} days`;
}

/**
 * How a delay should read.
 *
 * Same day is unremarkable; past a working day it is worth noticing; past three
 * it is the thing the screen exists to surface. The thresholds are a judgement
 * about freight, not a standard — an agent waiting three days for a rate has
 * usually gone somewhere else.
 */
export function delayTone(hours: number | null): "muted" | undefined | "warning" | "danger" {
  if (hours === null || hours === undefined) return "muted";
  if (hours >= 72) return "danger";
  if (hours >= 24) return "warning";
  return undefined;
}
