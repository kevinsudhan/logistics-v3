import { defaultCharges, normaliseHbl, partyLines } from "../../src/lib/hbl";
import {
  billFromReading,
  checkAgainstJob,
  correctionsText,
  csnDue,
  jobBlanksFromBill,
  releaseChecklist,
  sameName,
  samePlace,
  type BillReading,
  type JobBlanks,
} from "../../src/lib/receivedHbl";

/**
 * A house B/L somebody else issued, received on our job (088), and the boxes
 * our own B/L gained with it — against World Jaguar's QDWJ26093202, the
 * sample the user sent, as Gemini read it on 25 Sep 2026.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// The reading, as classify-enquiry's "hbl" mode returned it.
const reading: BillReading = {
  is_bill_of_lading: true,
  issuer: "World Jaguar Logistics Inc.",
  bl_no: "QDWJ26093202",
  other_reference: "QDMAA260901055",
  draft_or_copy: true,
  shipper_name: "QINGDAO HI-DURATIGHT CO., LTD.",
  shipper_address: "THE NORTH OF QUFANG,PINGDU ECONOMIC AND\nTECHNOLOGICAL DEVELOPMENT\nZONE,QINGDAO,CHINA",
  consignee_name: "APARAJIT INSTRUMENTS",
  consignee_address: "14/8,GOVINDAPPA NAICKER 2ND CROSS STREET,\nALAPAKKAM,CHENNAI-600116.TAMIL NADU,INDIA",
  consignee_contact: "G.GANESAN +91-44 23860900 (0)",
  consignee_iec: "0409012564",
  consignee_gstin: "33AALFA7975R1ZJ",
  notify_name: "APARAJIT INSTRUMENTS",
  notify_address: "14/8,GOVINDAPPA NAICKER 2ND CROSS STREET,\nALAPAKKAM,CHENNAI-600116.TAMIL NADU,INDIA",
  notify_iec: "0409012564",
  notify_gstin: "33AALFA7975R1ZJ",
  delivery_agent: "AASHISH LOGISTICS GLOBAL PVT LTD\nTHE CALAMINE CANARY BUILDING\nANNA NAGAR, CHENNAI- 600040",
  place_of_receipt: null,
  vessel: "TS SINGAPORE",
  voyage: "2607W",
  port_of_loading: "QINGDAO",
  port_of_discharge: "CHENNAI",
  place_of_delivery: "CHENNAI",
  service_type: "CFS-CFS",
  containers: null,
  marks_numbers: "N/M",
  packages: "1",
  package_type: "CASE",
  description: "SAID TO CONTAIN\nGRAPHITE DISC",
  hs_code: null,
  gross_weight_kg: "330KGS",
  measurement_cbm: "0.4CBM",
  freight_terms: "COLLECT",
  freight_payable_at: "CHENNAI",
  place_of_issue: "QINGDAO",
  date_of_issue: "2026-09-28",
  on_board_date: null,
  originals: null,
};

console.log("\nreading their PDF into boxes");
const read = billFromReading(reading);
const bill = read.data;
is("their number, reference and issuer", [read.blNo, read.otherRef, read.issuer], ["QDWJ26093202", "QDMAA260901055", "WORLD JAGUAR LOGISTICS INC."]);
is("marked as a copy", read.draft, true);
is("the figures without their units", [bill.packages, bill.package_type, bill.gross_weight_kg, bill.measurement_cbm], ["1", "CASE", "330", "0.4"]);
is("'said to contain' lifted off the goods into its tick", [bill.said_to_contain, bill.description], [true, "GRAPHITE DISC"]);
is("freight collect, and the table says so", [bill.freight_terms, bill.charges], ["collect", defaultCharges("collect")]);
is("IEC and GSTIN in their own boxes", [bill.consignee_iec, bill.consignee_gstin], ["0409012564", "33AALFA7975R1ZJ"]);
is("a date read as a date", bill.date_of_issue, "2026-09-28");
is("no originals stated: none guessed", read.originals, null);
is("a B/L number keeps its slashes", billFromReading({ bl_no: "HBL/26-27/0001 " }).blNo, "HBL/26-27/0001");
is("a date that is not one is left blank", billFromReading({ date_of_issue: "SEP 28" }).data.date_of_issue, "");

console.log("\nthe same party, the same port");
is("Pvt Ltd and punctuation do not matter", sameName("Aashish Logistics Global Pvt Ltd", "AASHISH LOGISTICS GLOBAL PVT. LTD."), true);
is("one name inside the other", sameName("QINGDAO HI-DURATIGHT CO., LTD.", "Qingdao Hi-Duratight"), true);
is("a different company", sameName("APARAJIT INSTRUMENTS", "APARNA INSTRUMENTS"), false);
is("a blank is never the same", sameName("", ""), false);
is("a port with its country", samePlace("QINGDAO", "Qingdao, China"), true);
is("a port with its code", samePlace("CHENNAI", "INMAA Chennai"), true);
is("two ports", samePlace("QINGDAO", "SHANGHAI"), false);

console.log("\nchecking their draft against our job");
const job: JobBlanks = {
  shipper_name: "Qingdao Hi-Duratight Co Ltd",
  shipper_address: null,
  consignee_name: "Aparajit Instruments",
  consignee_address: "14/8 Govindappa Naicker 2nd Cross St, Alapakkam, Chennai 600116",
  consignee_iec: "0409012564",
  consignee_gstin: "33AALFA7975R1ZK",
  notify_name: null,
  notify_address: null,
  port_of_loading: "Qingdao, China",
  origin: "Qingdao",
  port_of_discharge: null,
  destination: "Chennai",
  vessel: null,
  voyage: null,
  package_count: 1,
  piece_count: null,
  package_type: null,
  gross_weight_kg: 331,
  volume_cbm: 0.45,
  freight_terms: "collect",
  hs_code: "68151000",
  marks_and_numbers: null,
  cargo: "Graphite discs",
};
const rows = checkAgainstJob(bill, job, "Aashish Logistics Global Pvt Ltd");
const state = (k: string) => rows.find((r) => r.key === k)?.state;
is("the shipper, however it is written", state("shipper_name"), "same");
is("a GSTIN one character out", state("consignee_gstin"), "differs");
is("the IEC", state("consignee_iec"), "same");
is("notify, with the job naming none: the consignee", state("notify_name"), "same");
is("a weight a kilo out is a rounding", state("gross_weight_kg"), "same");
is("0.4 against 0.45 CBM is not", state("measurement_cbm"), "differs");
is("discharge port from the job's destination", state("port_of_discharge"), "same");
is("the vessel the job does not know yet", state("vessel"), "not_on_job");
is("our HS code, missing on theirs", state("hs_code"), "missing_on_bill");
is("they send the consignee to us", state("delivery_agent"), "same");
is("a box neither side has is not a row", rows.some((r) => r.key === "place_of_receipt"), false);

console.log("\nthe corrections to send");
is(
  "one line per box wrong or missing",
  correctionsText(rows, "QDWJ26093202").split("\n"),
  [
    "Please amend the draft B/L QDWJ26093202 as follows:",
    '- Consignee GSTIN: shows "33AALFA7975R1ZJ", should read "33AALFA7975R1ZK"',
    '- Measurement (CBM): shows "0.4", should read "0.45"',
    '- HS code: missing, should read "68151000"',
  ]
);
is("nothing to send when it matches", correctionsText(rows.filter((r) => r.state === "same"), "X"), "");

console.log("\nfilling the job's blanks");
const { patch, filled } = jobBlanksFromBill(bill, job);
is("only what the job leaves blank", Object.keys(patch).sort(), ["marks_and_numbers", "package_type", "port_of_discharge", "shipper_address", "vessel", "voyage"]);
is("never what the job already says", ["consignee_gstin", "volume_cbm", "cargo"].some((k) => k in patch), false);
is("said in words", filled.includes("vessel"), true);
is("'same as consignee' is not a notify party to copy", "notify_name" in jobBlanksFromBill({ ...bill, notify_name: "SAME AS CONSIGNEE" }, job).patch, false);

console.log("\nreleasing the cargo");
const r0 = { stage: "confirmed" as const, release_mode: "original" as const, issuer_name: "WORLD JAGUAR LOGISTICS INC.", freight_terms: "collect" as const, originals_surrendered_on: null, telex_received_on: null, charges_cleared_on: null };
is("original release: the final bill, a surrendered original and the money", releaseChecklist(r0).items.map((i) => i.key), ["final", "originals_surrendered_on", "charges_cleared_on"]);
is("freight collect is said", releaseChecklist(r0).items[2].label, "Freight (collect) and local charges paid");
is("not ready", releaseChecklist(r0).ready, false);
is("telex: the telex, from whom", releaseChecklist({ ...r0, release_mode: "telex" }).items[1].label, "Telex release received from WORLD JAGUAR LOGISTICS INC.");
is("express: nothing to surrender", releaseChecklist({ ...r0, release_mode: "express" }).items.map((i) => i.key), ["final", "charges_cleared_on"]);
is("all done: ready", releaseChecklist({ ...r0, stage: "final", originals_surrendered_on: "2026-10-02", charges_cleared_on: "2026-10-02" }).ready, true);

console.log("\nthe CSN deadline");
const now = new Date("2026-09-25T06:30:00Z"); // 12:00 IST
is("72 hours before an ETA with no time: IST midnight", csnDue("2026-10-01", null, null, now).due?.toISOString(), "2026-09-27T18:30:00.000Z");
is("comfortably ahead", csnDue("2026-10-01", null, null, now).state, "ok");
is("inside a day", csnDue("2026-09-29", "06:00", null, now).state, "soon");
is("past it", csnDue("2026-09-27", null, null, now).state, "overdue");
is("filed is filed, however late", csnDue("2026-09-27", null, "2026-09-24", now).state, "filed");
is("no ETA, nothing to count to", csnDue(null, null, null, now).state, "no_eta");

console.log("\nour own B/L's new boxes");
is("IEC and GSTIN under the address", partyLines("CHENNAI", "G.GANESAN", "0409012564", "33AALFA7975R1ZJ").split("\n"), ["CHENNAI", "G.GANESAN", "IEC CODE: 0409012564   GSTIN: 33AALFA7975R1ZJ"]);
is("nothing added when there is nothing", partyLines("CHENNAI", "", "", ""), "CHENNAI");
is("a B/L saved before the freight table gets the line its terms imply", normaliseHbl({ freight_terms: "collect" }).charges, [{ charge: "OCEAN FREIGHT", revenue_tons: "", rate: "", prepaid: "", collect: "AS ARRANGED" }]);
is("and says 'said to contain' as before", normaliseHbl({}).said_to_contain, true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
