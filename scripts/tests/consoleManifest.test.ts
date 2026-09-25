import { emptyHbl } from "../../src/lib/hbl";
import {
  isProvisional,
  manifestHtml,
  manifestIssues,
  manifestLines,
  manifestSheet,
  manifestSubject,
  manifestTotals,
  type ManifestBill,
  type ManifestConsole,
  type ManifestJob,
} from "../../src/lib/consoleManifest";

/**
 * The console's cargo manifest for the destination agent (090): a line per
 * house B/L from the B/L as saved, the job where none is, the totals, and
 * what makes it provisional.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const con: ManifestConsole = {
  console_no: "CON/26-27/0004",
  direction: "export",
  mbl_number: "MEDUCH123456",
  mbl_date: "2026-09-27",
  carrier: "MSC",
  vessel: "MSC ALINA",
  voyage: "FE612W",
  mother_vessel: "",
  pol: "CHENNAI",
  pod: "JEBEL ALI",
  place_of_delivery: "JEBEL ALI",
  etd: "2026-09-28",
  eta: "2026-10-09",
};

const job = (id: string, over: Partial<ManifestJob> = {}): ManifestJob => ({
  id,
  enquiry_ref: `ALG0901${id.slice(-1)}-26`,
  bl_number: null,
  forwarders_bl_no: null,
  shipper_name: "Kavitha Textiles",
  consignee_name: "Gulf Linen LLC",
  consignee_iec: null,
  consignee_gstin: null,
  notify_name: null,
  package_count: 10,
  piece_count: null,
  package_type: "cartons",
  cargo: "Cotton bed linen",
  gross_weight_kg: 500,
  volume_cbm: 2.5,
  marks_and_numbers: null,
  freight_terms: "prepaid",
  ...over,
});

const bill = (shipment: string, over: Partial<ManifestBill> = {}): ManifestBill => {
  const data = {
    ...emptyHbl(),
    shipper_name: "KAVITHA TEXTILES",
    consignee_name: "GULF LINEN LLC",
    packages: "120",
    package_type: "CARTONS",
    description: "COTTON BED LINEN",
    gross_weight_kg: "2400",
    measurement_cbm: "14.2",
    freight_terms: "collect" as const,
    containers: [{ container_no: "MSCU1234567", seal_no: "SL998", size_type: "40HC", packages: "", package_type: "", gross_kg: "", cbm: "" }],
  };
  return { shipment_id: shipment, hbl_no: `HBL/26-27/000${shipment.slice(-1)}`, data, release_mode: "original", originals: 3, final: true, ...over };
};

const jobs = [job("S1"), job("S2", { consignee_name: "Al Noor Trading", consignee_iec: "0409012564", gross_weight_kg: 300 }), job("S3", { gross_weight_kg: null, freight_terms: "collect" })];
const bills = [bill("S1"), bill("S2", { final: false, release_mode: "telex" })];
const lines = manifestLines(jobs, bills);

console.log("\na line per house bill");
is("one per job, in order", lines.map((l) => [l.n, l.shipmentId, l.source]), [[1, "S1", "issued"], [2, "S2", "draft"], [3, "S3", "job"]]);
is("from the B/L as saved", [lines[0].hblNo, lines[0].packages, lines[0].grossKg, lines[0].freight], ["HBL/26-27/0001", 120, 2400, "COLLECT"]);
is("how it is released", [lines[0].release, lines[1].release], ["3 ORIGINALS", "TELEX RELEASE"]);
is("its box and seal", lines[0].containers, ["MSCU1234567 / SEAL SL998"]);
is("the job's own fields where no B/L is saved", [lines[2].hblNo, lines[2].shipper, lines[2].packages, lines[2].packageType], ["", "KAVITHA TEXTILES", 10, "CARTONS"]);
is("the job's IEC under the consignee", manifestLines([jobs[1]], [])[0].consignee, "AL NOOR TRADING\nIEC CODE: 0409012564");

console.log("\nthe totals");
const t = manifestTotals(lines);
is("bills, packages, weight, volume", [t.bills, t.packages, t.grossKg, t.cbm], [3, 250, 4800, 30.9]);
is("each box once", t.containers, ["MSCU1234567"]);
is("how many are collect", t.collect, 3);

console.log("\nprovisional, and why");
const issues = manifestIssues(con, lines);
is("a draft B/L, a job with none, a missing weight", issues, [
  "1 house B/L not issued yet (HBL/26-27/0002)",
  "1 job with no B/L saved (ALG09013-26)",
  "No gross weight on ALG09013-26",
]);
is("so provisional", isProvisional(con, lines), true);
is("no master B/L number is said", manifestIssues({ ...con, mbl_number: null }, manifestLines([jobs[0]], [bills[0]])), ["No master B/L number"]);
is("every B/L issued and a master: final", isProvisional(con, manifestLines([jobs[0]], [bills[0]])), false);
is("an empty console says so", manifestIssues(con, []), ["No house bills on the console"]);

console.log("\nthe mail and the sheet");
is("the subject", manifestSubject(con, true), "[CON/26-27/0004] PROVISIONAL CARGO MANIFEST — MBL MEDUCH123456 — MSC ALINA FE612W — CHENNAI-JEBEL ALI");
is("a final one does not say provisional", manifestSubject(con, false).includes("PROVISIONAL"), false);
const html = manifestHtml(con, lines, "GFP Logistics", true, ["a.pdf", "a.xlsx"]);
is("addressed to the agent", html.startsWith("<p>Dear GFP Logistics,</p>"), true);
is("every house bill listed", ["HBL/26-27/0001", "HBL/26-27/0002", "ALG09013-26"].every((x) => html.includes(x)), true);
is("freight collect said", html.includes("3 house bills are freight collect"), true);
const sheet = manifestSheet(con, lines, true);
is("a row per bill and a total", sheet.rows.length, 4);
is("the total row", sheet.rows[3].slice(0, 2).concat(sheet.rows[3][6], sheet.rows[3][9]), [null, "3 house bills", 250, 4800]);
is("titled provisional", sheet.report?.title, "PROVISIONAL CARGO MANIFEST — CON/26-27/0004");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
