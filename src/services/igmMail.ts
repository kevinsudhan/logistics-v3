import { igmFromMails, mailText, type IgmFound } from "../lib/igmFromMail";
import { getMessage, searchMailbox } from "./graphMail";

export type IgmFromMail = Partial<Record<keyof IgmFound, { value: string; subject: string; from: string; at: string }>>;

/**
 * The IGM's particulars from the job's mail (lib/igmFromMail): the mails in
 * the person's own mailbox that name the job's bills or reference, newest
 * first, read whole. The line's IGM advice, its agent's arrival notice and a
 * co-loader's CSN confirmation all quote the B/L numbers, so that is what is
 * searched for. Each particular comes back with the mail it was found in.
 */
export async function igmFromJobMail(mailbox: string, refs: Array<string | null | undefined>, max = 8): Promise<IgmFromMail> {
  const terms = [...new Set(refs.map((r) => (r ?? "").replace(/["\\]/g, "").trim()).filter((r) => r.length >= 5))];
  if (!mailbox || !terms.length) return {};
  const hits = (await searchMailbox(mailbox, terms.map((t) => `"${t}"`).join(" OR ")))
    .sort((a, b) => (a.receivedDateTime < b.receivedDateTime ? 1 : -1))
    .slice(0, max);
  const mails = await Promise.all(
    hits.map(async (m) => {
      const base = { subject: m.subject, from: m.from?.emailAddress?.address ?? "", at: m.receivedDateTime };
      try {
        const full = await getMessage(mailbox, m.id, m.folder);
        return { ...base, text: mailText(full.body.content, full.body.contentType === "html") };
      } catch {
        // The preview, when the whole message will not open: some of it is better than none.
        return { ...base, text: m.bodyPreview ?? "" };
      }
    })
  );
  return igmFromMails(mails);
}
