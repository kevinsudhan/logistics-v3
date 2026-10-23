import {
  addressedAs,
  bucketOf,
  colleagues,
  copiers,
  copyNote,
  forwardSuspects,
  inView,
  partiesOf,
  readViewChoice,
  type Lens,
  type ViewChoice,
} from "../../src/lib/ccFilter";
import type { MailMessage } from "../../src/services/mockMail";

/**
 * Mail: the four views — My emails (from outside, to me), Primary (from a
 * colleague, to me), CC'd, the admin's Auto-forwarded — and whose mail is in
 * the last two (13 Oct 2026; My emails 23 Oct).
 *
 * aashish@ is sent everything parasuraman@ and info@ send and receive, by
 * Exchange rules, whether or not they name him.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const ME = "aashish@aashishlogistics.com";
const PARASU = "parasuraman@aashishlogistics.com";
const INFO = "info@aashishlogistics.com";
const PRIYA = "priya@customer.com";
const ARUN = "arun@carrier.com";
const NAMES: Record<string, string> = { [ME]: "Aashish", [PARASU]: "Parasuraman", [INFO]: "Info Desk", [PRIYA]: "Priya", [ARUN]: "Arun" };
const who = (address: string) => ({ emailAddress: { name: NAMES[address] ?? address, address } });
const mail = (id: string, from: string, to: string[], cc: string[] = [], subject = "Rates") =>
  ({ id, subject, from: who(from), toRecipients: to.map(who), ccRecipients: cc.map(who) }) as unknown as MailMessage;

const toMe = mail("1", PRIYA, [ME]); // a customer writes to Aashish
const parasuToMe = mail("2", PARASU, [ME], [], "Need your approval"); // Parasuraman writes to him himself
const parasuCcsMe = mail("3", PARASU, [PRIYA], ["AASHISH@aashishlogistics.com"]); // Parasuraman CCs him, any case
const priyaCcsMe = mail("4", PRIYA, [PARASU], [ME]); // a customer CCs him
const infoForward = mail("5", INFO, [ME], [], "FW: Enquiry"); // info@'s inbox rule forwards a customer's mail
const parasuForward = mail("6", PARASU, [ME], [], "FW: Booking"); // Parasuraman's rule forwards a carrier's mail
const parasuOut = mail("7", PARASU, [ARUN]); // a transport rule's copy of his mail out
const intoParasu = mail("8", ARUN, [PARASU], [INFO]); // a transport rule's copy of mail to him
const blind = mail("9", ARUN, ["group@else.com"]); // a Bcc
const mine = mail("10", ME, [PRIYA], [PARASU]); // his own
const all = [toMe, parasuToMe, parasuCcsMe, priyaCcsMe, infoForward, parasuForward, parasuOut, intoParasu, blind, mine];

// What the header check found: two rule forwards; Parasuraman's own mail to him is not one.
const lens: Lens = { mailbox: ME, forwards: new Map([["2", null], ["5", INFO], ["6", PARASU]]) };

console.log("which of the four");
is("My emails, Primary, CC'd, Auto-forwarded, and his own in none", all.map((m) => bucketOf(m, lens)), [
  "mine", "primary", "cc", "cc", "forwarded", "forwarded", "forwarded", "forwarded", "forwarded", null,
]);
is("a customer writes to him and copies a colleague: still his", bucketOf(mail("20", PRIYA, [ME], [PARASU]), lens), "mine");
is("a customer writes to him and others: still his", bucketOf(mail("21", ARUN, [PARASU, ME]), lens), "mine");
is("a customer copies him: CC'd, not his", bucketOf(mail("22", ARUN, [PRIYA], [ME]), lens), "cc");
is("one of the staff on another domain: from within the company", [
  bucketOf(mail("23", "kumar@gmail.com", [ME]), lens), bucketOf(mail("23", "kumar@gmail.com", [ME]), { ...lens, people: new Set(["kumar@gmail.com"]) }),
], ["mine", "primary"]);
is("a colleague writes to him in any case: Primary", bucketOf(mail("24", "Aarathy@AashishLogistics.com", [ME]), lens), "primary");
is("how: To, Cc, a rule's forward, a copy", all.map((m) => addressedAs(m, lens)), ["to", "to", "cc", "cc", "forward", "forward", "copy", "copy", "copy", "sent"]);

console.log("\nasking which are forwards");
const unknown: Lens = { mailbox: ME };
is("only mail To him from one of ours, or FW:", forwardSuspects([...all, mail("11", PRIYA, [ME], [], "Fwd: Docs")], unknown).map((m) => m.id), ["2", "5", "6", "11"]);
is("not asked twice", forwardSuspects(all, lens).map((m) => m.id), []);
is("being asked: in no view yet", [bucketOf(infoForward, { mailbox: ME, checking: new Set(["5"]) }), inView(infoForward, { mailbox: ME, checking: new Set(["5"]) }, { view: "primary", person: null, direction: "any" })], [null, false]);
is("never answered: his own mail, not hidden", bucketOf(infoForward, unknown), "primary");

console.log("\nthe views, and who");
const ids = (c: Partial<ViewChoice>) => all.filter((m) => inView(m, lens, { view: "all", person: null, direction: "any", ...c })).map((m) => m.id);
is("everything", ids({}), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
is("My emails: from outside, to him", ids({ view: "mine" }), ["1"]);
is("Primary: from a colleague, to him", ids({ view: "primary" }), ["2"]);
is("CC'd", ids({ view: "cc" }), ["3", "4"]);
is("CC'd by Parasuraman", ids({ view: "cc", person: PARASU }), ["3"]);
is("CC'd by a customer", ids({ view: "cc", person: "PRIYA@customer.com" }), ["4"]);
is("Auto-forwarded", ids({ view: "forwarded" }), ["5", "6", "7", "8", "9"]);
is("Parasuraman's, forwarded and copied, in and out", ids({ view: "forwarded", person: PARASU }), ["6", "7", "8"]);
is("Parasuraman's, received by him", ids({ view: "forwarded", person: PARASU, direction: "received" }), ["6", "8"]);
is("Parasuraman's, sent by him", ids({ view: "forwarded", person: PARASU, direction: "sent" }), ["7"]);
is("info@'s", ids({ view: "forwarded", person: INFO }), ["5", "8"]);

console.log("\nwhose mail");
is("a forward is the forwarding mailbox's, received", partiesOf(infoForward, lens).map((p) => [p.name, p.role]), [["Info Desk", "received"]]);
is("a copy: its sender, and ours it went to", partiesOf(intoParasu, lens).map((p) => [p.address, p.role]), [[ARUN, "sent"], [PARASU, "received"], [INFO, "received"]]);
is("the CC'd picker: who copied him", copiers(all, lens, "cc").map((c) => [c.name, c.ours, c.sent]), [["Parasuraman", true, 1], ["Priya", false, 1]]);
is("the forwarded picker: ours first, with in and out", copiers(all, lens, "forwarded").map((c) => [c.name, c.ours, c.sent, c.received]), [
  ["Parasuraman", true, 1, 2],
  ["Info Desk", true, 0, 2],
  ["Arun", false, 2, 0],
]);

console.log("\nthe picker: ALG's people only");
const STAFF = [
  { email: ME, full_name: "Aashish" },
  { email: PARASU, full_name: "Parasuraman" },
  { email: "Aarathy@aashishlogistics.com", full_name: "Aarathy" },
];
const imports = mail("12", "imports@aashishlogistics.com", [PRIYA], [ME]);
is("staff and our addresses in the mail, by how much; outside senders and himself left out", colleagues(copiers([...all, imports], lens, "cc"), STAFF, ME).map((c) => [c.name, c.sent]), [
  ["imports@aashishlogistics.com", 1],
  ["Parasuraman", 1],
  ["Aarathy", 0],
]);
is("forwarded: info@ is in it though not a login", colleagues(copiers(all, lens, "forwarded"), STAFF, ME).map((c) => [c.name, c.sent + c.received]), [
  ["Parasuraman", 3],
  ["Info Desk", 2],
  ["Aarathy", 0],
]);

console.log("\nwhy a row is there");
is("CC, whose forward or copy, BCC; nothing for his own", all.map((m) => copyNote(m, lens)?.label ?? null), [
  null, null, "CC", "CC", "Info Desk's", "Parasuraman's", "Parasuraman's", "Parasuraman's", "BCC", null,
]);

console.log("\na view kept from before there were three");
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
store.set(`mail:view:${ME}`, JSON.stringify({ view: "direct", person: null, direction: "any" }));
is("To me is Primary", readViewChoice(ME).view, "primary");
store.set(`mail:view:${ME}`, JSON.stringify({ view: "mine", person: PARASU, direction: "sent" }));
is("My emails kept, with no person", readViewChoice(ME), { view: "mine", person: null, direction: "sent" });
store.set(`mail:view:${ME}`, JSON.stringify({ view: "copied", person: PARASU, direction: "sent" }));
is("CC & BCC of one person is their forwarded mail", readViewChoice(ME), { view: "forwarded", person: PARASU, direction: "sent" });

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
