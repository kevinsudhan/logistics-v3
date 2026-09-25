import { supabase } from "../lib/supabase";
import { mailKind, refInSubject, type Addressee, type MailKind } from "../lib/mailLog";
import { hasGraphToken, sentSince, whoami } from "./graphMail";
import { all } from "./paging";

/**
 * The desk's sent mail, for Team oversight (086).
 *
 * ---------------------------------------------------------------------------
 * HOW IT FILLS
 *
 * The Microsoft connection belongs to each person's own browser session, so
 * the copying happens there: while somebody has the CRM open with Outlook
 * connected, `syncSentMail` reads their Sent Items from where the last copy
 * got to and records what is new — mail sent from Outlook as well as from the
 * CRM. It runs when the app opens, every few minutes while it stays open, when
 * the tab comes back into view, and just after the CRM sends something
 * (`syncSentSoon`). The first copy of a mailbox goes back fourteen days.
 *
 * Failing is quiet. A sync that cannot reach Outlook leaves the log as it was
 * and tries again next time; the person using the CRM is never interrupted
 * because oversight could not be kept up to date.
 * ---------------------------------------------------------------------------
 */

export interface MailLogRow {
  id: string;
  mailbox: string;
  internet_message_id: string;
  conversation_id: string | null;
  sent_at: string;
  subject: string;
  preview: string;
  to_addrs: Addressee[];
  cc_addrs: Addressee[];
  has_attachments: boolean;
  enquiry_ref: string | null;
  kind: MailKind;
  synced_by: string | null;
  synced_at: string;
}

const FIRST_COPY_DAYS = 14;
let mailbox: string | null = null;
let running: Promise<number> | null = null;

/** Copy this session's Sent Items into the log. Returns how many were recorded. */
export async function syncSentMail(): Promise<number> {
  if (!hasGraphToken()) return 0;
  if (running) return running;
  running = (async () => {
    try {
      mailbox = mailbox ?? (await whoami())?.toLowerCase() ?? null;
      if (!mailbox) return 0;
      const { data: last } = await supabase.rpc("mail_log_since", { p_mailbox: mailbox });
      // A few minutes back from the last one seen, in case two sends shared a
      // second or Outlook filed one late; the upsert makes the overlap harmless.
      const since = last
        ? new Date(new Date(last as string).getTime() - 5 * 60_000)
        : new Date(Date.now() - FIRST_COPY_DAYS * 86_400_000);
      const items = await sentSince(since.toISOString());
      if (!items.length) {
        // Nothing new, but checked: say so, so the mailbox does not look stale.
        await supabase.rpc("record_sent_mail", { p_mailbox: mailbox, p_rows: [] });
        return 0;
      }
      let n = 0;
      // Batches of a hundred, so one request never carries a month of mail.
      for (let i = 0; i < items.length; i += 100) {
        const rows = items.slice(i, i + 100).map((m) => ({
          ...m,
          enquiry_ref: refInSubject(m.subject),
          kind: mailKind(m.subject),
        }));
        const { data, error } = await supabase.rpc("record_sent_mail", { p_mailbox: mailbox, p_rows: rows });
        if (error) throw new Error(error.message);
        n += Number(data ?? 0);
      }
      return n;
    } catch {
      return 0;
    } finally {
      running = null;
    }
  })();
  return running;
}

let soon: number | undefined;
/** After a send: Outlook files the sent copy a moment later, so wait, then copy. */
export function syncSentSoon(): void {
  window.clearTimeout(soon);
  soon = window.setTimeout(() => void syncSentMail(), 8_000);
}

/** The whole log for a period, newest first. Admins see everybody's; others their own (RLS). */
export async function listMailLog(fromIso: string, toIso?: string | null): Promise<MailLogRow[]> {
  const rows = await all((from, to) => {
    let q = supabase.from("mail_log").select("*").gte("sent_at", fromIso);
    if (toIso) q = q.lt("sent_at", toIso);
    return q.order("sent_at", { ascending: false }).order("id").range(from, to);
  });
  return rows as unknown as MailLogRow[];
}

/** When each mailbox was last checked, and by whom — so a quiet mailbox is not mistaken for an idle person. */
export async function mailboxesSeen(): Promise<Array<{ mailbox: string; synced_at: string; synced_by: string | null }>> {
  const { data, error } = await supabase.from("mail_log_mailboxes").select("mailbox, last_synced_at, synced_by").order("mailbox");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ mailbox: string; last_synced_at: string; synced_by: string | null }>).map((r) => ({
    mailbox: r.mailbox,
    synced_at: r.last_synced_at,
    synced_by: r.synced_by,
  }));
}
