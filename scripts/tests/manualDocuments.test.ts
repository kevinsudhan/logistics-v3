import {
  documentDataFromManual,
  emptyState,
  keysOf,
  manualDocument,
  MANUAL_DOCUMENTS,
  MANUAL_SOURCE_NOTE,
  matches,
  missingOf,
  pdfOf,
  sectionsFor,
} from "../../src/lib/documents/manual";
import { manifestInput, masterSiInput, outturnInput, stuffingInput, cfsNominationInput } from "../../src/lib/documents/manualConsole";
import { parseNumber, unreadableNumbers, type FormDoc, type ManualValues } from "../../src/lib/documents/manualForm";
import { DOCUMENTS, documentSpec } from "../../src/lib/documents/registry";
import { documentDataFromBooking, readiness } from "../../src/lib/documents/data";

/** The Manual documents page: typing a document in by hand (12 Oct 2026). */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const has = (label: string, list: readonly string[], want: string[]) => is(label, want.filter((w) => !list.includes(w)), []);

console.log("the fields a document prints, read from the document");
const an = documentSpec("arrival-notice")!;
has("the CAN: its B/L, ETA, consignee and the arrival particulars", keysOf(an), [
  "blNumber", "masterBlNumber", "consigneeName", "consigneeAddress", "destination", "etaDate",
  "vessel", "voyage", "portOfLoading", "igmNumber", "igmDate", "cfsName", "freeTimeText",
  "containerId", "containerType", "cargoDescription", "packageCount", "packageType", "grossWeightKg", "freightAmountInr",
]);
const quo = documentSpec("quotation")!;
has("both sides of a ?? and an && are found", keysOf(quo), ["company", "customerName", "origin", "destination"]);
is("a document without the parties block does not ask for them", keysOf(quo).includes("consigneeAddress"), false);
has("the VGM's weighing, typed by a person", keysOf(documentSpec("vgm-declaration")!), ["vgmMethod", "vgmFacility", "vgmWeighedOn"]);
has("the POD's receipt, typed by a person", keysOf(documentSpec("proof-of-delivery")!), ["deliveredOn", "receivedBy"]);
for (const spec of DOCUMENTS) {
  const fields = sectionsFor(spec).flatMap((s) => s.fields ?? []);
  const required = fields.filter((f) => f.required).map((f) => f.key).sort();
  is(`${spec.shortName}: every field it requires is on its form, marked`, required, [...spec.requires].sort());
}

console.log("\nwhat was typed, as a document reads it");
const typed: ManualValues = {
  reference: " ALG09004-26 ",
  grossWeightKg: "1,25,000",
  netWeightKg: "12abc",
  stackable: "no",
  letterOfCredit: "yes",
  uprightOnly: "",
  etaDate: "2026-10-12",
  consigneeName: "  ",
};
const d = documentDataFromManual(typed);
is("an Indian thousands separator reads", d.grossWeightKg, 125000);
is("not a number is not its leading digits", d.netWeightKg, undefined);
is("no and yes, and not said", [d.stackable, d.letterOfCredit, d.uprightOnly], [false, true, undefined]);
is("a date prints as the letterhead dates", d.etaDate, "12-Oct-2026");
is("blank is not a value", d.consigneeName, undefined);
is("numbered by the reference without a B/L", [d.reference, d.documentNumber], ["ALG09004-26", "ALG09004-26"]);
is("numbered by the B/L once there is one", documentDataFromManual({ ...typed, blNumber: "HBL/26-27/0009" }).documentNumber, "HBL/26-27/0009");
is("nothing typed: TBD, not a number made up", [documentDataFromManual({}).reference, documentDataFromManual({}).documentNumber], ["TBD", "TBD"]);
is("the footer says it was typed by hand", d.sourceNote, MANUAL_SOURCE_NOTE);
is("the number that will not read is named", unreadableNumbers((manualDocument("commercial-invoice") as FormDoc).sections, typed), ["Net weight (kg)"]);
is("parseNumber", [parseNumber("1,250.5"), parseNumber(" 7 "), parseNumber("-"), parseNumber("")], [1250.5, 7, undefined, undefined]);

console.log("\nthe same honesty: a draft until it has what it needs");
const s = emptyState();
const can = manualDocument("arrival-notice")!;
is("an empty CAN names what it is waiting for", missingOf(can, s), ["Bill of lading number", readiness(documentDataFromManual({}), ["consigneeName"]).missingLabels[0], "Destination", "ETA date"]);
s.shipment = { blNumber: "HBL/26-27/0009", consigneeName: "GULF TRADERS LLC", destination: "JEBEL ALI", etaDate: "2026-10-20" };
is("…and nothing once it has it", missingOf(can, s), []);
const everything: ManualValues = {
  reference: "ALG09004-26", blNumber: "HBL/26-27/0009", shipperName: "RAVI EXPORTS", shipperGstinIec: "33AAACR1234A1Z5",
  consigneeName: "GULF TRADERS", consigneeAddress: "PO BOX 1, DUBAI", consigneeCountry: "UAE", origin: "CHENNAI", destination: "JEBEL ALI",
  sailingDate: "2026-10-14", etaDate: "2026-10-28", containerType: "40HC", containerId: "PCIU1234567", cargoDescription: "COTTON YARN",
  hsCode: "5205", packageCount: "120", packageType: "BALES", netWeightKg: "18000", grossWeightKg: "18500", invoiceValueInr: "2500000",
  freightAmountInr: "95000", incoterm: "FOB", paymentTerms: "30 DAYS",
};
s.shipment = everything;
is("every shipment document ready once everything is typed", MANUAL_DOCUMENTS.filter((x) => x.store === "shipment" && missingOf(x, s).length).map((x) => x.id), []);

console.log("\na job's own documents print as they did");
const booking = documentDataFromBooking(
  { id: "x", enquiry_ref: "ALG09004-26", origin: "Chennai", destination: "Jebel Ali", cargo: "Yarn", piece_count: 1, volume_cbm: 1, gross_weight_kg: 1, agreed_inr: 1, sailing_date: null, carrier: null, booking_number: null, container_number: null, bl_number: "HBL1", vessel: "MSC ANNA", etd: null, eta: "2026-10-28" },
  null
);
is("nothing on a booking fills the hand-typed fields", ["vessel", "voyage", "portOfLoading", "igmNumber", "igmDate", "cfsName", "vgmMethod", "vgmFacility", "vgmWeighedOn", "deliveredOn", "receivedBy"].map((k) => (booking as unknown as Record<string, unknown>)[k]), Array(11).fill(undefined));
const anRows = an.sections.flatMap((x) => x.rows).filter((r) => ["Vessel / voyage", "Port of loading", "IGM", "Delivery from (CFS)"].includes(r.label));
is("…and the CAN's new rows are left out when empty", anRows.map((r) => [r.optional, r.value(booking)]), Array(4).fill([true, undefined]));

console.log("\nthe console's documents");
const con: ManualValues = {
  console_no: "CON/26-27/0012", mbl_number: "MAEU123", vessel: "MSC ANNA", pol: "CHENNAI", pod: "JEBEL ALI",
  boxes: [
    { container_no: "PCIU1234567", size_type: "40HC", seal_no: "S1", packages: "10", gross_kg: "1000", cbm: "5" },
    { container_no: "TGHU7654321", size_type: "20GP", seal_no: "", packages: "4", gross_kg: "400.5", cbm: "2" },
    { container_no: "", size_type: "", seal_no: "", packages: "", gross_kg: "", cbm: "" },
  ],
  stuffing_lines: [
    { container_no: "pciu 1234567", hbl_no: "H1", packages: "6", kg: "600", cbm: "3", declared: "6", received: "5", condition: "good" },
    { container_no: "PCIU1234567", hbl_no: "H2", packages: "4", kg: "400", cbm: "2" },
    { container_no: "XXXU0000001", hbl_no: "H3", packages: "1", kg: "1", cbm: "0.1" },
    { container_no: "", hbl_no: "H4", packages: "2", kg: "20", cbm: "0.2" },
  ],
  manifest_lines: [
    { hbl_no: "H1", status: "issued", containers: "PCIU1234567 / 40HC, TGHU7654321 / 20GP", packages: "6", gross_kg: "600", freight: "COLLECT" },
    { hbl_no: "H2", status: "draft", packages: "x" },
  ],
  outturn_lines: [{ hbl_no: "H1", manifested: "6", landed: "5", condition: "short" }],
};
const st = stuffingInput(con);
is("boxes in the order typed, a stray one kept, the unboxed last", st.boxes.map((b) => [b.containerNo, b.houses.map((h) => h.hblNo)]), [
  ["PCIU1234567", ["H1", "H2"]],
  ["TGHU7654321", []],
  ["XXXU0000001", ["H3"]],
  ["", ["H4"]],
]);
is("a box's totals are its houses', or what was typed against an empty one", st.boxes.slice(0, 2).map((b) => [b.packages, b.kg, b.cbm]), [[10, 1000, 5], [4, 400.5, 2]]);
is("the tally comes through", [st.boxes[0].houses[0].declaredPkgs, st.boxes[0].houses[0].receivedPkgs, st.boxes[0].houses[1].receivedPkgs], [6, 5, null]);
const mf = manifestInput(con);
is("a draft house makes the manifest provisional", mf.provisional, true);
is("containers split, a figure that will not read is none", [mf.lines[0].containers, mf.lines[1].packages, mf.lines[0].freight], [["PCIU1234567 / 40HC", "TGHU7654321 / 20GP"], null, "COLLECT"]);
const si = masterSiInput(con);
is("the SI's totals are the boxes' when none was typed", [si.si.packages, si.si.gross_weight_kg, si.si.measurement_cbm], ["14", "1400.5", "7"]);
is("…and what was typed when it was", masterSiInput({ ...con, packages: "15 " }).si.packages, "15");
is("an empty box line is not a box", [si.si.containers.length, cfsNominationInput(con).boxes.length], [2, 2]);
is("the outturn lists the boxes as a console does", outturnInput(con).console.containers, ["PCIU1234567 40HC", "TGHU7654321 20GP"]);
is("the CFS letter is signed for the company unless told otherwise", [cfsNominationInput(con).ourName, cfsNominationInput({ ...con, our_name: "X LTD" }).ourName], ["Aashish Logistics Global Pvt Ltd", "X LTD"]);

console.log("\nevery document prints, empty and filled");
const filled = emptyState();
filled.shipment = everything;
filled.console = con;
filled.hbl.data.shipper_name = "RAVI EXPORTS";
filled.hbl.print = "original";
filled.hawb.data.shipper_name = "RAVI EXPORTS";
for (const doc of MANUAL_DOCUMENTS) {
  for (const [label, state] of [["empty", emptyState()], ["filled", filled]] as const) {
    let ok = false;
    try {
      const { pdf, name } = pdfOf(doc, state);
      ok = (pdf.output("arraybuffer") as ArrayBuffer).byteLength > 1000 && name.endsWith(".pdf") && !/[\\/:*?"<>|]/.test(name);
    } catch (e) {
      console.log(`         ${doc.id} ${label}: ${(e as Error).message}`);
    }
    is(`${doc.shortName} (${label})`, ok, true);
  }
}
is("an original HBL names what it still needs", missingOf(manualDocument("house-bl")!, filled).slice(0, 2), ["the B/L number", "the consignee"]);
is("a draft HBL needs nothing to be printed for checking", missingOf(manualDocument("house-bl")!, emptyState()), []);

console.log("\nfinding one");
is("by what the desk calls it", MANUAL_DOCUMENTS.filter((x) => matches(x, "can")).map((x) => x.id).includes("arrival-notice"), true);
is("by name, and by what it is for", MANUAL_DOCUMENTS.filter((x) => matches(x, "delivery order")).map((x) => x.id), ["delivery-order", "cfs-nomination"]);
is("nothing typed: all of them", MANUAL_DOCUMENTS.filter((x) => matches(x, "  ")).length, MANUAL_DOCUMENTS.length);
is("ids are unique", new Set(MANUAL_DOCUMENTS.map((x) => x.id)).size, MANUAL_DOCUMENTS.length);
is("all twelve, the two house bills and the five console documents", MANUAL_DOCUMENTS.length, 19);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
