import { igmFromMails, igmFromText, mailDate, mailText } from "../../src/lib/igmFromMail";

/** The IGM's particulars read out of mails, as lines and agents write them. */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

console.log("dates, as mails write them");
is("28-SEP-26, 28/09/2026, 28.09.2026, 2026-09-28, 28 Sep 2026", ["28-SEP-26", "28/09/2026", "28.09.2026", "2026-09-28", "28 Sep 2026"].map(mailDate), Array(5).fill("2026-09-28"));
is("not a date", [mailDate("1214225"), mailDate("")], ["", ""]);

console.log("\nthe line's IGM advice");
const advice = `Dear Sir,
Please find the IGM details for your consol below.
Vessel: REN JIAN 23   Voyage: 2638W
IMO No: 9389411   Call Sign: BQQI
VCN : INMAA1262035
IGM No/Dt: 1214225 / 28-SEP-26
Line No. 644   Sub Line No: 25
MBL: JJCSPCNANC602902`;
is("every particular, each from its label", igmFromText(advice), {
  igmNo: "1214225", igmDate: "2026-09-28", subLineNo: "25", lineNo: "644", vcn: "INMAA1262035", imo: "9389411", callSign: "BQQI",
});
is("IGM NO 1214865 DT 01.10.2026", igmFromText("IGM NO 1214865 DT 01.10.2026"), { igmNo: "1214865", igmDate: "2026-10-01" });
is("IGM No. 1214865 dated 01/10/2026; Item No: 644", igmFromText("IGM No. 1214865 dated 01/10/2026; Item No: 644"), { igmNo: "1214865", igmDate: "2026-10-01", lineNo: "644" });
is("the date on its own label", igmFromText("IGM NO : 1214865\nIGM DATE : 01-OCT-2026"), { igmNo: "1214865", igmDate: "2026-10-01" });
is("a sub-line is not taken for the line", igmFromText("Sub Item No: 10"), { subLineNo: "10" });
is("a CSN confirmation: CSN, PCIN, CFS code", igmFromText("CSN No: 1508881 PCIN: 26PCSE00101339774340 CFS Code: INMAA1ECC1"), { csnNo: "1508881", pcin: "26PCSE00101339774340", cfsCode: "INMAA1ECC1" });
is("nothing to find: nothing found", igmFromText("Please find the invoice attached."), {});
is("a phone number is not an IGM", igmFromText("Call me on 9841012345 regarding the IGM."), {});

console.log("\nmail bodies");
is("HTML to text, a table's cells kept apart", mailText("<table><tr><td>IGM No</td><td>1214225</td></tr><tr><td>Line No</td><td>644</td></tr></table>", true), "IGM No 1214225\nLine No 644");
is("…and read", igmFromText(mailText("<p>IGM&nbsp;No:&nbsp;1214225</p><p>Line No: 644</p>", true)), { igmNo: "1214225", lineNo: "644" });

console.log("\nseveral mails: the newest first, each named");
const found = igmFromMails([
  { text: "IGM No: 1111111", subject: "old advice", from: "line@x.com", at: "2026-10-01T10:00:00Z" },
  { text: "IGM No: 1214225 Line No: 644", subject: "IGM details", from: "agent@x.com", at: "2026-10-12T10:00:00Z" },
  { text: "IMO 9389411", subject: "vessel", from: "line@x.com", at: "2026-10-02T10:00:00Z" },
]);
is("the newer IGM number, with its mail", [found.igmNo?.value, found.igmNo?.subject, found.lineNo?.value, found.imo?.value, found.imo?.subject], ["1214225", "IGM details", "644", "9389411", "vessel"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
