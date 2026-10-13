import { addressedAs, ccSenders, inCcView } from "../../src/lib/ccFilter";
import type { MailMessage } from "../../src/services/mockMail";

/** Mail: copied on (Cc or Bcc), or sent to directly, and who did the copying (13 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const ME = "ops@example.com";
const who = (address: string, name = address) => ({ emailAddress: { name, address } });
const mail = (id: string, from: string, to: string[], cc: string[] = [], name?: string) =>
  ({ id, from: who(from, name), toRecipients: to.map((a) => who(a)), ccRecipients: cc.map((a) => who(a)) }) as unknown as MailMessage;

const direct = mail("1", "priya@customer.com", [ME], [], "Priya");
const ccd = mail("2", "priya@customer.com", ["sales@example.com"], ["OPS@Example.com"], "Priya");
const blind = mail("3", "arun@carrier.com", ["someone@else.com"], [], "Arun");
const ccdByArun = mail("4", "arun@carrier.com", ["x@y.com"], [ME], "Arun");
const mine = mail("5", ME, ["priya@customer.com"], ["boss@example.com"]);
const all = [direct, ccd, blind, ccdByArun, mine];

console.log("where the mailbox is on a message");
is("on To, Cc (any case), neither, and its own", all.map((m) => addressedAs(m, ME)), ["to", "cc", "bcc", "cc", "sent"]);

console.log("\nthe views");
const ids = (view: "all" | "copied" | "direct", from: string | null = null) => all.filter((m) => inCcView(m, ME, view, from)).map((m) => m.id);
is("everything", ids("all"), ["1", "2", "3", "4", "5"]);
is("copied: Cc and Bcc, not its own mail", ids("copied"), ["2", "3", "4"]);
is("not copied: on the To line", ids("direct"), ["1"]);
is("copied by one person, Cc and Bcc both", ids("copied", "ARUN@carrier.com"), ["3", "4"]);
is("copied by someone else", ids("copied", "priya@customer.com"), ["2"]);

console.log("\nwho copied the mailbox");
is("most often first, once each, by name", ccSenders(all, ME), [
  { address: "arun@carrier.com", name: "Arun", count: 2 },
  { address: "priya@customer.com", name: "Priya", count: 1 },
]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
