import { baseSubject, groupIntoThreads, involves } from "../../src/lib/threads";
import type { MailMessage } from "../../src/services/mockMail";

/**
 * Loose messages, grouped into conversations.
 *
 * The partner screen searches the whole mailbox for an address and gets back a
 * flat list spanning Inbox and Sent. What the desk reads is threads, so the
 * grouping is the screen — and it is the part that can be wrong quietly: a
 * thread ordered by its first message looks stale, and a thread titled from its
 * newest looks like "Re: Re: FW:".
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${label}${
      ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`
    }`
  );
  ok ? pass++ : fail++;
};

const who = (address: string, name = "") => ({ emailAddress: { name, address } });

function msg(p: {
  id: string;
  conversationId?: string;
  subject?: string;
  at: string;
  from?: string;
  to?: string[];
  cc?: string[];
  isRead?: boolean;
}): MailMessage {
  return {
    id: p.id,
    conversationId: p.conversationId ?? "",
    mailbox: "desk@aashishlogistics.com",
    folder: "inbox",
    subject: p.subject ?? "Rate for Jebel Ali",
    from: who(p.from ?? "agent@gulfline.ae"),
    toRecipients: (p.to ?? ["desk@aashishlogistics.com"]).map((a) => who(a)),
    ccRecipients: (p.cc ?? []).map((a) => who(a)),
    receivedDateTime: p.at,
    bodyPreview: "",
    body: { contentType: "text", content: "" },
    isRead: p.isRead ?? true,
    isDraft: false,
    hasAttachments: false,
    attachments: [],
    importance: "normal",
  } as MailMessage;
}

console.log("\nthe accumulated prefixes come off the subject");
is("a reply", baseSubject("Re: Rate for Jebel Ali"), "Rate for Jebel Ali");
is("a forwarded reply", baseSubject("FW: Re: Rate for Jebel Ali"), "Rate for Jebel Ali");
is("stacked three deep", baseSubject("Re: Re: FW: Rate for Jebel Ali"), "Rate for Jebel Ali");
is("a German client's", baseSubject("AW: Rate for Jebel Ali"), "Rate for Jebel Ali");
is("Outlook's numbered form", baseSubject("RE[2]: Rate for Jebel Ali"), "Rate for Jebel Ali");
is("no prefix is left alone", baseSubject("Rate for Jebel Ali"), "Rate for Jebel Ali");
// "Retention policy" starts with "Re" and is not a reply. The colon is what
// makes a prefix a prefix.
is("a word that merely starts with Re", baseSubject("Retention policy"), "Retention policy");
is("an empty subject still names itself", baseSubject(""), "(no subject)");

console.log("\na thread is as recent as its last message");
{
  const threads = groupIntoThreads([
    msg({ id: "a1", conversationId: "A", at: "2026-03-01T09:00:00Z" }),
    msg({ id: "a2", conversationId: "A", at: "2026-09-20T09:00:00Z" }),
    msg({ id: "b1", conversationId: "B", at: "2026-04-01T09:00:00Z" }),
  ]);
  is("two threads", threads.length, 2);
  // Ordered by the first message, B would win. It is the answer this morning
  // that makes A the live one.
  is("the one answered most recently is first", threads[0].conversationId, "A");
  is("its timestamp is the newest message's", threads[0].lastAt, "2026-09-20T09:00:00Z");
}

console.log("\nmessages inside a thread read oldest first");
{
  const [t] = groupIntoThreads([
    msg({ id: "z", conversationId: "A", at: "2026-09-20T09:00:00Z", subject: "Re: Rate" }),
    msg({ id: "a", conversationId: "A", at: "2026-09-01T09:00:00Z", subject: "Rate" }),
  ]);
  is("oldest first", t.messages.map((m) => m.id), ["a", "z"]);
  is("the subject comes from the oldest, so no Re:", t.subject, "Rate");
}

console.log("\nunread anywhere marks the thread");
{
  const [t] = groupIntoThreads([
    msg({ id: "a", conversationId: "A", at: "2026-09-01T09:00:00Z", isRead: true }),
    msg({ id: "b", conversationId: "A", at: "2026-09-02T09:00:00Z", isRead: false }),
  ]);
  is("one unread is enough", t.unread, true);
}

console.log("\nmessages with no conversation id are not welded together");
{
  const threads = groupIntoThreads([
    msg({ id: "a", at: "2026-09-01T09:00:00Z" }),
    msg({ id: "b", at: "2026-09-02T09:00:00Z" }),
  ]);
  // Bucketing both under "" would present two unrelated messages as one
  // exchange, which is worse than showing them apart.
  is("two separate threads", threads.length, 2);
}

console.log("\nwhether the partner is actually on the message");
{
  const partner = ["agent@gulfline.ae"];
  is("they sent it", involves(msg({ id: "1", at: "x", from: "agent@gulfline.ae" }), partner), true);
  is(
    "we sent it to them",
    involves(msg({ id: "2", at: "x", from: "desk@aashishlogistics.com", to: ["agent@gulfline.ae"] }), partner),
    true
  );
  is(
    "they are copied",
    involves(msg({ id: "3", at: "x", from: "x@y.com", to: ["z@y.com"], cc: ["agent@gulfline.ae"] }), partner),
    true
  );
  is(
    "case does not matter",
    involves(msg({ id: "4", at: "x", from: "Agent@GulfLine.AE" }), partner),
    true
  );
  // The search matches the body too, so this is the case that keeps a message
  // merely mentioning them out of the correspondence list.
  is(
    "merely mentioned is not involved",
    involves(msg({ id: "5", at: "x", from: "colleague@aashishlogistics.com", to: ["desk@aashishlogistics.com"] }), partner),
    false
  );
  is("a partner with no address matches nothing", involves(msg({ id: "6", at: "x" }), []), false);
  is("a blank address matches nothing", involves(msg({ id: "7", at: "x" }), ["  "]), false);
}

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
