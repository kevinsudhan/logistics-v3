import {
  breakdown,
  buildEntries,
  closingState,
  consoleShares,
  jobRows,
  periodOf,
  periodRows,
  periodsBetween,
  pnlWorkbook,
  summarise,
  totalsOf,
  type PnlDoc,
  type PnlJob,
} from "../../src/lib/jobPnl";
import { buildWorkbook } from "../../src/lib/xlsx";

/**
 * Job P&L: what counts as revenue and cost, how a console's bill is shared,
 * when a job can close, and which period a figure lands in.
 *
 * These are the numbers a desk is judged on. The rules checked are the ones
 * that would quietly flatter or sink a month: GST kept out, credit notes
 * taken off, drafts kept out of revenue, a console's freight not charged
 * twice, and India's financial year for quarters and years.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const job = (p: Partial<PnlJob>): PnlJob => ({
  id: "J1",
  enquiryRef: "ALG09001-26",
  customer: "Kevin Imports",
  mode: "sea_lcl",
  direction: "export",
  origin: "Chennai",
  destination: "Jebel Ali",
  jobDate: "2026-09-10",
  stage: "delivered",
  signedOffAt: null,
  handledBy: "Aarathy",
  consoleId: null,
  consoleNo: null,
  volumeCbm: null,
  weightKg: null,
  quotedRevenue: null,
  quotedCost: null,
  receivable: 0,
  payable: 0,
  draftInvoices: 0,
  disputedBills: 0,
  ...p,
});
const doc = (p: Partial<PnlDoc>): PnlDoc => ({
  id: Math.random().toString(36).slice(2),
  side: "revenue",
  kind: "tax_invoice",
  number: "INV/001",
  date: "2026-09-12",
  status: "issued",
  shipmentId: "J1",
  consoleId: null,
  party: "Kevin Imports",
  fx: 1,
  taxableInr: 0,
  lines: [],
  ...p,
});
const line = (description: string, amount: number, reimbursement = false) => ({ description, amount, reimbursement });

console.log("\nwhat counts");
const j1 = job({});
const docs = [
  doc({ lines: [line("Ocean freight", 50000), line("THC", 8000), line("Duty paid on your behalf", 12000, true)] }),
  doc({ kind: "credit_note", number: "CN/001", lines: [line("Rate correction", 3000)] }),
  doc({ status: "draft", number: null, lines: [line("Not yet issued", 99999)] }),
  doc({ status: "cancelled", lines: [line("Cancelled", 77777)] }),
  doc({ side: "cost", kind: "carrier_invoice", number: "MSC-88", party: "MSC", fx: 83.5, lines: [line("Ocean freight", 400)] }),
  doc({ side: "cost", kind: "vendor_invoice", number: "TRN-1", party: "Sai Transports", status: "draft", lines: [line("Pickup", 4500)] }),
  doc({ side: "cost", kind: "agent_credit_note", number: "ACN-2", party: "Gulf Agent", lines: [line("Rebate", 1000)] }),
  doc({ side: "cost", kind: "vendor_invoice", status: "cancelled", lines: [line("Void", 5555)] }),
];
const entries = buildEntries([j1], docs);
const t = totalsOf(entries);
is("revenue: issued, less the credit note, drafts and cancelled left out", t.revenue, 50000 + 8000 + 12000 - 3000);
is("cost: foreign bill converted, draft counted, agent credit note taken off", t.cost, 400 * 83.5 + 4500 - 1000);
is("gross profit", t.gp, 67000 - 36900);
is("margin", Math.round((t.margin ?? 0) * 1000) / 10, 44.9);
is("reimbursements shown apart", t.reimbursements, 12000);
is("the draft bill is provisional", t.provisionalCost, 4500);
is("no lines: the document's own value", totalsOf(buildEntries([j1], [doc({ taxableInr: 2500 })])).revenue, 2500);
is("no revenue: no margin rather than a division by nothing", totalsOf(buildEntries([j1], [docs[4]])).margin, null);
is("a document for a job not in view is not counted", buildEntries([j1], [doc({ shipmentId: "OTHER", lines: [line("x", 1)] })]).length, 0);

console.log("\na console's bill, shared");
const a = job({ id: "A", consoleId: "C1", volumeCbm: 3 });
const b = job({ id: "B", consoleId: "C1", volumeCbm: 1 });
is("by volume", consoleShares([a, b]).get("C1"), [{ jobId: "A", share: 0.75 }, { jobId: "B", share: 0.25 }]);
is("one without volume: by weight", consoleShares([{ ...a, weightKg: 100 }, { ...b, volumeCbm: null, weightKg: 300 }]).get("C1")?.map((s) => s.share), [0.25, 0.75]);
is("neither: evenly", consoleShares([{ ...a, volumeCbm: null }, { ...b, volumeCbm: null }]).get("C1")?.map((s) => s.share), [0.5, 0.5]);
const mbl = doc({ side: "cost", kind: "carrier_invoice", shipmentId: null, consoleId: "C1", party: "ONE", lines: [line("Master freight", 20000)] });
const shared = buildEntries([a, b], [mbl]);
is("each job carries its share, marked", shared.map((e) => [e.jobId, e.amount, e.share]), [["A", 15000, 0.75], ["B", 5000, 0.25]]);
is("and the whole is charged once", shared.reduce((n, e) => n + e.amount, 0), 20000);

console.log("\nclosing");
is("ready: delivered, invoiced, costed, nothing pending", closingState(j1, buildEntries([j1], [docs[0], docs[4]])), { state: "ready", reasons: [] });
is("what stands in the way", closingState({ ...j1, stage: "sailed", draftInvoices: 2 }, entries).reasons, ["Not delivered yet", "2 draft invoices", "1 bill awaiting the vendor's invoice"]);
is("nothing recorded", closingState(j1, []).reasons, ["No invoice issued", "No costs recorded"]);
is("signed off is closed", closingState({ ...j1, signedOffAt: "2026-09-20T10:00:00Z" }, []).state, "closed");
is("cancelled", closingState({ ...j1, stage: "cancelled" }, []).state, "cancelled");

console.log("\nperiods");
is("a week starts on Monday", periodOf("2026-09-24", "week"), { key: "2026-09-21", label: "21–27 Sep 2026", start: "2026-09-21", end: "2026-09-27" });
is("a week across two months", periodOf("2026-10-01", "week").label, "28 Sep – 4 Oct 2026");
is("a month", periodOf("2026-02-14", "month"), { key: "2026-02", label: "Feb 2026", start: "2026-02-01", end: "2026-02-28" });
is("Q2 of the financial year is Jul–Sep", periodOf("2026-09-24", "quarter"), { key: "2026-Q2", label: "Q2 FY 2026-27 (Jul–Sep)", start: "2026-07-01", end: "2026-09-30" });
is("January is Q4 of the year that began the April before", periodOf("2027-01-15", "quarter").key, "2026-Q4");
is("Q4's last day", periodOf("2027-03-02", "quarter").end, "2027-03-31");
is("the year is the financial year", periodOf("2026-03-31", "year"), { key: "FY2025", label: "FY 2025-26", start: "2025-04-01", end: "2026-03-31" });
is("every month between, none skipped", periodsBetween("2026-11-20", "2027-02-03", "month").map((p) => p.label), ["Nov 2026", "Dec 2026", "Jan 2027", "Feb 2027"]);

console.log("\nby job or by document");
const j2 = job({ id: "J2", jobDate: "2026-10-05", customer: "Aakarsh Air & Sea", mode: "air", handledBy: null });
const all = buildEntries([j1, j2], [
  doc({ date: "2026-10-02", lines: [line("Freight", 10000)] }),
  doc({ side: "cost", kind: "vendor_invoice", date: "2026-09-15", party: "MSC", lines: [line("Freight", 6000)] }),
  doc({ shipmentId: "J2", date: "2026-10-06", lines: [line("Air freight", 30000)] }),
  doc({ shipmentId: "J2", side: "cost", kind: "carrier_invoice", date: "2026-10-06", party: "Emirates", lines: [line("Air freight", 26000)] }),
]);
const sept = { from: "2026-09-01", to: "2026-09-30" };
const byJob = jobRows([j1, j2], all, { basis: "job", ...sept });
is("by job: September holds J1, whole", byJob.map((r) => [r.job.id, r.revenue, r.cost]), [["J1", 10000, 6000]]);
const byDoc = jobRows([j1, j2], all, { basis: "document", ...sept });
is("by document: only September's documents", byDoc.map((r) => [r.job.id, r.revenue, r.cost]), [["J1", 0, 6000]]);
const months = periodRows(jobRows([j1, j2], all, { basis: "document", from: null, to: null }), { basis: "document", granularity: "month", from: null, to: null });
is("by document, month by month", months.map((m) => [m.period.label, m.revenue, m.cost, m.jobs]), [["Sep 2026", 0, 6000, 1], ["Oct 2026", 40000, 26000, 2]]);
const jobMonths = periodRows(jobRows([j1, j2], all, { basis: "job", from: "2026-08-01", to: "2026-10-31" }), { basis: "job", granularity: "month", from: "2026-08-01", to: "2026-10-31" });
is("an empty month is a row of zeros", jobMonths.map((m) => [m.period.label, m.gp, m.jobs]), [["Aug 2026", 0, 0], ["Sep 2026", 4000, 1], ["Oct 2026", 4000, 1]]);

console.log("\nquoted against actual, and the breakdowns");
const quoted = jobRows([{ ...j1, quotedRevenue: 12000, quotedCost: 7000 }], all, { basis: "job", from: null, to: null })[0];
is("quoted profit and the variance", [quoted.quotedGp, quoted.variance], [5000, -1000]);
const rows = jobRows([j1, j2], all, { basis: "job", from: null, to: null });
is("by customer, most profit first, a tie to the bigger revenue", breakdown(rows, "customer").map((b) => [b.label, b.gp]), [["Aakarsh Air & Sea", 4000], ["Kevin Imports", 4000]]);
is("by mode", breakdown(rows, "mode").map((b) => b.label).sort(), ["Air", "Sea LCL"]);
is("nobody assigned", breakdown(rows, "handler").map((b) => b.label).sort(), ["Aarathy", "Unassigned"]);
is("cost by vendor", breakdown(rows, "vendor").map((b) => [b.label, b.cost]), [["Emirates", 26000], ["MSC", 6000]]);
is("revenue by charge", breakdown(rows, "charge").map((b) => [b.label, b.revenue]), [["Air freight", 30000], ["Freight", 10000]]);
const s = summarise(rows);
is("the summary", [s.revenue, s.cost, s.gp, s.jobs, s.avgGp], [40000, 32000, 8000, 2, 4000]);

console.log("\nthe workbook");
const sheets = pnlWorkbook(rows, { company: "Aashish Logistics Global Pvt Ltd", periodText: "All time", basis: "job", from: null, to: null, generatedAt: new Date(2026, 8, 24, 10, 0), generatedBy: "Aarathy" });
is("summary, jobs, four period sheets, six breakdowns, lines", sheets.map((x) => x.name), ["Summary", "Jobs", "Weekly", "Monthly", "Quarterly", "Yearly", "By customer", "By mode", "By direction", "By handler", "By charge", "By vendor", "Lines"]);
is("every row as wide as its columns", sheets.every((x) => x.rows.every((r) => r.length === x.columns.length)), true);
const xml = new TextDecoder().decode(buildWorkbook(sheets));
is("thirteen sheets in the file", (xml.match(/<sheet name=/g) ?? []).length, 13);
is("an ampersand in a customer is escaped", xml.includes("Aakarsh Air &amp; Sea"), true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
