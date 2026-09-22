import { getMessage } from "../services/graphMail";
import type { MailMessage } from "../services/backend";

/**
 * The text of a thread, for reading.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: bodyPreview IS NOT THE BODY
 *
 * Graph's `bodyPreview` is a snippet — about 255 characters. Every list and
 * every `$search` returns it and does NOT return `body`, because `LIST_SELECT`
 * does not ask for one.
 *
 * Both readers here used to pass `bodyPreview` to the extractor, so the model
 * was shown the first two lines of each mail and nothing else. On a freight
 * enquiry that is the greeting and the origin, which is why a mail plainly
 * stating the CFS, the cut-offs, the HS code and the weights came back with
 * almost nothing filled in: the model never saw them.
 *
 * The failure was quiet in the worst way. Something was always extracted — the
 * first line usually carries the lane or the mode — so the feature looked like
 * it was working badly rather than like it was reading a truncated string.
 *
 * WHY THE MESSAGES ARE FETCHED ONE AT A TIME
 *
 * Because a full body is a per-message fetch in Graph; there is no way to ask
 * for forty of them at once. That is the cost of reading the mail properly, and
 * it is bounded by the cap below and by the high-water mark in autoFill, which
 * means it happens once per thread rather than on every page load.
 * ---------------------------------------------------------------------------
 */

/**
 * How many messages are read in full.
 *
 * A long thread is mostly quoted copies of itself, and the newest messages
 * carry the answers. Eight is comfortably more than a consol enquiry runs to
 * before it is booked.
 */
const MAX_MESSAGES = 8;

/** Characters of each body kept. Guards against a thread with a PDF pasted into it. */
const MAX_PER_MESSAGE = 6000;

/**
 * Plain text from a mail body.
 *
 * Through the DOM rather than a regex: mail HTML is full of `<style>` blocks,
 * conditional comments and Word markup, and stripping tags with a pattern
 * leaves the CSS behind as though it were prose — which then gets sent to the
 * model as part of the enquiry.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  if (!html.includes("<")) return html.trim();
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const el of Array.from(doc.querySelectorAll("style, script, head"))) el.remove();
    return (doc.body?.textContent ?? "")
      .replace(/ /g, " ")
      // Mail HTML produces long runs of blank lines; they cost tokens and say
      // nothing.
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return html.replace(/<[^>]+>/g, " ").trim();
  }
}

/** The readable text of one message, however it arrived. */
export function textOf(m: MailMessage): string {
  const body = m.body?.content ? htmlToText(m.body.content) : "";
  // The preview is the fallback, not the source. It is better than nothing when
  // a fetch failed, and it is never preferred over a real body.
  const text = body || m.bodyPreview || "";
  return text.slice(0, MAX_PER_MESSAGE);
}

/**
 * The thread as one piece of text, oldest first, bodies fetched in full.
 *
 * Oldest first because a thread is an argument that develops: a reply saying
 * "Chennai, and the 14th" answers two questions asked earlier, and reading it
 * without them produces a guess.
 *
 * Best-effort per message — one that will not load is skipped rather than
 * failing the read, because seven messages of context beats none.
 */
export async function threadText(
  mailbox: string,
  messages: MailMessage[],
  limit = MAX_MESSAGES
): Promise<string> {
  const ordered = [...messages].sort((a, b) =>
    a.receivedDateTime.localeCompare(b.receivedDateTime)
  );
  const wanted = ordered.slice(-limit);

  const parts = await Promise.all(
    wanted.map(async (m) => {
      // Already full: a message opened in the reader carries its body.
      if (m.body?.content) return m;
      try {
        return await getMessage(mailbox, m.id, m.folder);
      } catch {
        return m;
      }
    })
  );

  return parts
    .map((m) => `--- ${m.subject ?? ""}\n${textOf(m)}`)
    .join("\n\n")
    .trim();
}
