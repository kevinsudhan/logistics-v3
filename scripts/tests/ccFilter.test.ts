import { addressedAs, copiers, copyNote, inView, partiesOf, type ViewChoice } from "../../src/lib/ccFilter";
import type { MailMessage } from "../../src/services/mockMail";

/**
 * Mail: what was written to the mailbox, and whose mail its copies are (13 Oct 2026).
 *
 * aashish@ has a copy of everything parasuraman@ and info@ send and receive,
 * by an Exchange rule that does not name him on the mail.
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
const mail = (id: string, from: string, to: string[], cc: string[] = []) =>
  ({ id, from: who(from), toRecipients: to.map(who), ccRecipients: cc.map(who) }) as unknown as MailMessage;

const toMe = mail("1", PRIYA, [ME]); // a customer writes to Aashish
const parasuCcsMe = mail("2", PARASU, [PRIYA], ["AASHISH@aashishlogistics.com"]); // Parasuraman copies him in, any case
const intoInfo = mail("3", PRIYA, [INFO]); // the rule's copy: a customer's enquiry to info@
const parasuOut = mail("4", PARASU, [ARUN]); // the rule's copy: Parasuraman's mail to a carrier
const intoParasu = mail("5", ARUN, [PARASU], [INFO]); // the rule's copy: a carrier to Parasuraman, info@ copied
const mine = mail("6", ME, [PRIYA], [PARASU]); // Aashish's own
const all = [toMe, parasuCcsMe, intoInfo, parasuOut, intoParasu, mine];

console.log("where the mailbox is on a message");
is("To, Cc (any case), named nowhere, and its own", all.map((m) => addressedAs(m, ME)), ["to", "cc", "copy", "copy", "copy", "sent"]);

console.log("\nwhose mail a copy is");
is("a customer's to info@: theirs, sent; info@'s, received", partiesOf(intoInfo, ME).map((p) => [p.address, p.role, p.ours]), [
  [PRIYA, "sent", false],
  [INFO, "received", true],
]);
is("Parasuraman's to a carrier: his, sent; the outside recipient left out", partiesOf(parasuOut, ME).map((p) => [p.address, p.role]), [[PARASU, "sent"]]);
is("a carrier to Parasuraman, info@ copied: both of ours, received", partiesOf(intoParasu, ME).map((p) => [p.address, p.role]), [
  [ARUN, "sent"],
  [PARASU, "received"],
  [INFO, "received"],
]);

console.log("\nthe views");
const ids = (c: Partial<ViewChoice>) => all.filter((m) => inView(m, ME, { view: "all", person: null, direction: "any", ...c })).map((m) => m.id);
is("everything", ids({}), ["1", "2", "3", "4", "5", "6"]);
is("to me: only what was written to him", ids({ view: "direct" }), ["1"]);
is("CC & BCC: copied in, and the rule's copies; not his own", ids({ view: "copied" }), ["2", "3", "4", "5"]);
is("Parasuraman's mail, in and out, Cc'd or copied by rule", ids({ view: "copied", person: PARASU }), ["2", "4", "5"]);
is("Parasuraman's, sent by him", ids({ view: "copied", person: PARASU, direction: "sent" }), ["2", "4"]);
is("Parasuraman's, received by him", ids({ view: "copied", person: PARASU, direction: "received" }), ["5"]);
is("info@'s", ids({ view: "copied", person: INFO }), ["3", "5"]);
is("chosen in another case", ids({ view: "copied", person: "Info@AashishLogistics.com" }), ["3", "5"]);
is("an outside sender's", ids({ view: "copied", person: PRIYA }), ["3"]);

console.log("\nthe choices, ours first");
is("by mailbox, with what each sent and received", copiers(all, ME).map((c) => [c.name, c.ours, c.sent, c.received]), [
  ["Parasuraman", true, 2, 1],
  ["Info Desk", true, 0, 2],
  ["Arun", false, 1, 0],
  ["Priya", false, 1, 0],
]);

console.log("\nwhy a row is there");
is("CC, whose copy, a blind copy; nothing for mail to him or his own", [...all, mail("7", ARUN, ["group@else.com"])].map((m) => copyNote(m, ME)?.label ?? null), [
  null, "CC", "Info Desk's", "Parasuraman's", "Parasuraman's", null, "BCC",
]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
