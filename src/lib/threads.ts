import type { MailMessage } from "../services/mockMail";

/**
 * Loose messages, grouped into the conversations they belong to.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT DONE BY GRAPH
 *
 * Graph can group by conversation, but only within one folder. A partner's
 * correspondence spans Inbox and Sent by definition -- it is an exchange -- so
 * the search that finds it comes back flat and the grouping happens here.
 *
 * WHY THE LATEST MESSAGE DECIDES THE ORDER
 *
 * A thread is as recent as its last message. Ordering by the first would put a
 * conversation that started in March and was answered this morning below one
 * that started in April and died. What the desk wants to see is what moved
 * most recently.
 *
 * WHY THE SUBJECT COMES FROM THE OLDEST
 *
 * Because that is the one without the "Re:" in front of it. Taking it from the
 * newest gives a list of threads all called "Re: Re: FW:", which is three words
 * of nothing before the part that identifies the job.
 * ---------------------------------------------------------------------------
 */
export interface Thread {
  conversationId: string;
  /** The subject as first written, without the accumulated Re: and FW:. */
  subject: string;
  /** Oldest first, the order a conversation is read in. */
  messages: MailMessage[];
  /** The most recent message's timestamp, which is what the list sorts on. */
  lastAt: string;
  /** True when anything in the thread is unread. */
  unread: boolean;
}

const at = (m: MailMessage) => Date.parse(m.receivedDateTime) || 0;

/** "Re: FW: Re: Rate for Jebel Ali" -> "Rate for Jebel Ali" */
export function baseSubject(subject: string): string {
  // Repeated because clients stack them: a forwarded reply carries both, and
  // some non-English clients prepend their own ("AW:", "SV:") on top.
  let s = (subject ?? "").trim();
  let previous;
  do {
    previous = s;
    s = s.replace(/^\s*(re|fw|fwd|aw|sv|tr|vs)\s*(\[\d+\])?\s*:\s*/i, "");
  } while (s !== previous);
  return s || "(no subject)";
}

export function groupIntoThreads(messages: MailMessage[]): Thread[] {
  const byConversation = new Map<string, MailMessage[]>();

  for (const m of messages) {
    // A message with no conversationId is its own thread. Bucketing them all
    // under "" would weld unrelated mail into one conversation, which is worse
    // than showing them separately.
    const key = m.conversationId || `single:${m.id}`;
    const bucket = byConversation.get(key);
    if (bucket) bucket.push(m);
    else byConversation.set(key, [m]);
  }

  const threads: Thread[] = [];
  for (const [conversationId, bucket] of byConversation) {
    const ordered = [...bucket].sort((a, b) => at(a) - at(b));
    threads.push({
      conversationId,
      subject: baseSubject(ordered[0].subject),
      messages: ordered,
      lastAt: ordered[ordered.length - 1].receivedDateTime,
      unread: ordered.some((m) => !m.isRead),
    });
  }

  return threads.sort((a, b) => (Date.parse(b.lastAt) || 0) - (Date.parse(a.lastAt) || 0));
}

/**
 * Whether a message actually involves one of these addresses.
 *
 * The search that produced it matches the body too, so a message that merely
 * quotes an address comes back alongside the ones addressed to it. Both are
 * worth showing; only these are worth calling correspondence, and the screen
 * uses this to say which is which rather than to throw the others away.
 */
export function involves(m: MailMessage, addresses: string[]): boolean {
  const wanted = addresses.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return false;

  const people = [
    m.from?.emailAddress?.address,
    ...(m.toRecipients ?? []).map((r) => r.emailAddress?.address),
    ...(m.ccRecipients ?? []).map((r) => r.emailAddress?.address),
  ]
    .filter(Boolean)
    .map((a) => String(a).toLowerCase());

  return people.some((a) => wanted.includes(a));
}
