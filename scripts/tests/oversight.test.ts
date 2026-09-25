import { buildActivity, periodRange, personOfMail, statsFor, within, type EventLike, type MailLike, type StepLike } from "../../src/lib/oversight";

/**
 * Team oversight (086): the periods, whose mail is whose, the one feed, and
 * what each person did in it.
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

// Thursday 25 Sep 2026, 11:30 on the desk's clock.
const now = new Date(2026, 8, 25, 11, 30);
const day = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;

console.log("\nperiods");
is("today runs from midnight to now", [day(periodRange("today", now).from), periodRange("today", now).to], ["2026-9-25 0:0", null]);
is("yesterday is the whole of yesterday", [day(periodRange("yesterday", now).from), day(periodRange("yesterday", now).to!)], ["2026-9-24 0:0", "2026-9-25 0:0"]);
is("seven days includes today", day(periodRange("7d", now).from), "2026-9-19 0:0");
is("this month from the first", day(periodRange("month", now).from), "2026-9-1 0:0");
is("a moment inside", within(new Date(2026, 8, 25, 9).toISOString(), periodRange("today", now)), true);
is("a moment before", within(new Date(2026, 8, 24, 23, 59).toISOString(), periodRange("today", now)), false);
is("yesterday stops at midnight", within(new Date(2026, 8, 25, 0, 0).toISOString(), periodRange("yesterday", now)), false);

const people = [
  { id: "u-parasu", email: "parasu@aashishlogistics.com", full_name: "Parasu" },
  { id: "u-meera", email: "meera@aashishlogistics.com", full_name: "Meera" },
];

console.log("\nwhose mail");
is("the person whose login is the mailbox", personOfMail({ mailbox: "Parasu@AashishLogistics.com", synced_by: "u-meera" }, people), "u-parasu");
is("a shared mailbox: whoever read it in the CRM", personOfMail({ mailbox: "info@aashishlogistics.com", synced_by: "u-meera" }, people), "u-meera");
is("nobody known", personOfMail({ mailbox: "info@aashishlogistics.com", synced_by: null }, people), null);

const at = (h: number, m = 0) => new Date(2026, 8, 25, h, m).toISOString();
const mail = (id: string, box: string, h: number, kind: MailLike["kind"], to: string[], ref: string | null = null): MailLike => ({
  id,
  mailbox: box,
  sent_at: at(h),
  subject: `Subject ${id}`,
  preview: "",
  to_addrs: to.map((a) => ({ name: "", address: a })),
  cc_addrs: [],
  has_attachments: false,
  enquiry_ref: ref,
  kind,
  synced_by: null,
});
const mails = [
  mail("1", "parasu@aashishlogistics.com", 9, "pre_alert", ["ops@gfp.ae"], "ALG09004-26"),
  mail("2", "parasu@aashishlogistics.com", 10, "reply", ["ops@gfp.ae", "docs@gfp.ae"]),
  mail("3", "parasu@aashishlogistics.com", 11, "rfq", ["rates@pcs.sg"]),
  { ...mail("4", "info@aashishlogistics.com", 8, "other", ["buyer@gulflinen.ae"]), synced_by: "u-meera" },
  // Yesterday: outside today's feed.
  { ...mail("5", "parasu@aashishlogistics.com", 9, "quotation", ["x@y.com"]), sent_at: new Date(2026, 8, 24, 16).toISOString() },
];
const events: EventLike[] = [
  { id: "e1", enquiry_ref: "ALG09005-26", kind: "assigned", summary: "Taken on by Meera", actor: "u-meera", at: at(9, 15) },
  { id: "e2", enquiry_ref: "ALG09005-26", kind: "quote_sent", summary: "Quoted ₹48,500", actor: "u-meera", at: at(10, 40) },
  { id: "e3", enquiry_ref: "ALG09004-26", kind: "promoted", summary: "Booked", actor: "u-parasu", at: at(8, 30) },
];
const steps: StepLike[] = [
  { id: "s1", shipment_id: "ARX-SHP-0004", label: "SI submitted", done_at: at(10, 5), done_by: "u-parasu" },
  { id: "s2", shipment_id: "ARX-SHP-0004", label: "B/L draft follow-up", done_at: null, done_by: null },
];

const feed = buildActivity({ events, mails, steps, people, shipmentRef: (id) => (id === "ARX-SHP-0004" ? "ALG09004-26" : null), range: periodRange("today", now) });

console.log("\nthe feed");
is("today's mail, events and steps, newest first", feed.map((i) => i.id), ["m:3", "e:e2", "s:s1", "m:2", "e:e1", "m:1", "e:e3", "m:4"]);
is("yesterday's mail is not in today", feed.some((i) => i.id === "m:5"), false);
is("a step not done is not in it", feed.some((i) => i.id === "s:s2"), false);
is("a mail says what it was and to whom", [feed.find((i) => i.id === "m:1")!.label, feed.find((i) => i.id === "m:1")!.text], ["Pre-alert", "Subject 1 → ops@gfp.ae"]);
is("a mail to two, both named", feed.find((i) => i.id === "m:2")!.text, "Subject 2 → ops@gfp.ae, docs@gfp.ae");
is("a step lands on its job", [feed.find((i) => i.id === "s:s1")!.ref, feed.find((i) => i.id === "s:s1")!.who], ["ALG09004-26", "u-parasu"]);
is("an event in words", feed.find((i) => i.id === "e:e2")!.label, "Quoted");
is("the shared mailbox's mail is credited to its reader", feed.find((i) => i.id === "m:4")!.who, "u-meera");

console.log("\nwhat each person did");
is("Parasu", statsFor("u-parasu", feed), {
  mails: 3,
  domains: [["gfp.ae", 2], ["pcs.sg", 1]],
  takenOn: 0,
  quoted: 0,
  booked: 1,
  steps: 1,
  lastAt: at(11),
});
is("Meera", (({ mails, takenOn, quoted, domains }) => ({ mails, takenOn, quoted, domains }))(statsFor("u-meera", feed)), { mails: 1, takenOn: 1, quoted: 1, domains: [["gulflinen.ae", 1]] });
is("somebody who did nothing", statsFor("u-nobody", feed).lastAt, null);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
