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
import { renderDocument } from "../../src/lib/documents/render";
import type { jsPDF } from "jspdf";

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
has("the CAN: everything an import desk's CAN carries", keysOf(an), [
  "notifyName", "notifyAddress", "notifyGstin", "consigneeName", "consigneeAddress", "consigneeCountry", "consigneeGstin", "shipperName", "shipperAddress",
  "blNumber", "blDate", "masterBlNumber", "masterBlDate", "bookingNumber", "serviceType", "vessel", "voyage", "origin", "portOfLoading",
  "destination", "etaDate", "finalDestination", "finalEtaDate", "igmNumber", "igmDate", "igmItemNo", "igmSubItemNo", "cfsName", "cfsAddress",
  "carrier", "freightTerms", "freeTimeText", "poNumber", "invoiceRef", "salesRef", "releaseMode",
  "marksNumbers", "cargoDescription", "hsCode", "containerId", "containerType", "sealNumber", "packageCount", "packageType", "grossWeightKg", "volumeCbm",
  "freightAmountInr",
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
const HAND_TYPED = [
  "vessel", "voyage", "portOfLoading", "igmNumber", "igmDate", "igmItemNo", "igmSubItemNo", "cfsName", "cfsAddress", "vgmMethod", "vgmFacility",
  "vgmWeighedOn", "deliveredOn", "receivedBy", "blDate", "masterBlDate", "bookingNumber", "serviceType", "shipperAddress", "consigneeGstin",
  "notifyName", "notifyAddress", "notifyGstin", "finalDestination", "finalEtaDate", "releaseMode", "freightTerms", "marksNumbers", "sealNumber",
  "poNumber", "invoiceRef", "salesRef",
];
is("nothing on a booking fills the hand-typed fields", HAND_TYPED.filter((k) => (booking as unknown as Record<string, unknown>)[k] !== undefined), []);
/** The fields one row reads, as keysOf finds them. */
const readsOf = (row: { value: (d: never) => unknown }) => {
  const read = new Set<string>();
  for (const fill of [undefined, 1]) {
    try {
      row.value(new Proxy({}, { get: (_, k) => (typeof k === "string" && read.add(k), fill) }) as never);
    } catch {
      // as keysOf
    }
  }
  return [...read];
};
const typedOnly = an.sections.flatMap((x) => x.rows).filter((r) => readsOf(r).every((k) => HAND_TYPED.includes(k)));
is("…and the CAN's rows of them are optional, so a job's notice leaves them out", typedOnly.filter((r) => !r.optional).map((r) => r.label), []);
is("…which is most of them", typedOnly.length >= 15, true);

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

console.log("\nthe signature never on a page by itself");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
/** Per page: the text drawn above the footer, the signature's own lines left out. */
async function bodies(pdf: jsPDF): Promise<string[][]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf.output("arraybuffer")), verbosity: 0 }).promise;
  const pages: string[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const items = (await page.getTextContent()).items as Array<{ str: string; transform: number[] }>;
    // The footer rule is 20 mm from the foot of the page: 57 pt.
    pages.push(items.filter((i) => i.str.trim() && i.transform[5] > 60).map((i) => i.str.trim()));
  }
  return pages;
}
const SIGNATURE = ["For AASHISH LOGISTICS GLOBAL", "Authorised signatory"];
for (const id of ["shipping-instructions", "arrival-notice", "commercial-invoice", "booking-confirmation"]) {
  const spec = documentSpec(id)!;
  let alone = 0;
  let checked = 0;
  // The description grows a few words at a time, walking the end of the content down the page and over.
  for (let k = 1; k <= 120; k += 2) {
    const data = documentDataFromManual({ ...everything, cargoDescription: Array(k).fill("COTTON YARN IN BALES").join(" ") });
    const pages = await bodies(renderDocument(spec, data));
    checked++;
    if (pages.some((texts) => texts.length > 0 && texts.every((t) => SIGNATURE.includes(t)))) alone++;
  }
  is(`${spec.shortName}: across ${checked} lengths, the signature is never alone on a page`, alone, 0);
}

console.log("\na CAN with everything a CAN carries, on one page");
const fullCan: ManualValues = {
  reference: "ALG09004-26", blNumber: "HBL/26-27/0042", blDate: "2026-09-28", masterBlNumber: "MAEU254781936", masterBlDate: "2026-09-28",
  bookingNumber: "177516002885", serviceType: "LCL", shipperName: "SAMPLE TEXTILES CO LTD", shipperAddress: "NO. 8 HARBOUR ROAD, PUDONG, SHANGHAI 200120, CHINA",
  consigneeName: "TEST IMPORTS PVT LTD", consigneeAddress: "NO. 12, 2ND STREET, GUINDY INDUSTRIAL ESTATE, CHENNAI 600032", consigneeCountry: "INDIA",
  consigneeGstin: "33AAACT1234A1Z5", notifyName: "SAMPLE CUSTOMS BROKERS", notifyAddress: "NO. 4, NORTH BEACH ROAD, CHENNAI 600001", notifyGstin: "33AABCS9876K1Z2",
  origin: "SHANGHAI", portOfLoading: "SHANGHAI", destination: "CHENNAI", etaDate: "2026-10-20", finalDestination: "CHENNAI", carrier: "MSC AGENCY INDIA",
  vessel: "MSC ANNA", voyage: "FJ642W", igmNumber: "2345678", igmDate: "2026-10-18", igmItemNo: "10", igmSubItemNo: "2",
  cfsName: "CONTINENTAL CFS", cfsAddress: "NO. 43, KADAPAKKAM VILLAGE, VICHUR HIGH ROAD, MANALI NEW TOWN, CHENNAI 600103",
  freeTimeText: "14 days demurrage, 7 days detention", releaseMode: "original", freightTerms: "Collect", poNumber: "PO-5521", invoiceRef: "INV/26-27/0311",
  salesRef: "1775004", marksNumbers: "N/M", cargoDescription: "COTTON FABRIC ROLLS", hsCode: "5208", containerId: "MSKU7834512", containerType: "40HC",
  sealNumber: "SL998877", packageCount: "120", packageType: "ROLLS", grossWeightKg: "18500", volumeCbm: "62.5", freightAmountInr: "95000",
};
const fullPages = await bodies(renderDocument(an, documentDataFromManual(fullCan)));
is("one page, signed on it", [fullPages.length, fullPages[0].includes("Authorised signatory")], [1, true]);
const fullText = fullPages[0].join(" ");
is("the particulars, by what they say", [
  "SAMPLE CUSTOMS BROKERS", "TEST IMPORTS PVT LTD", "SAMPLE TEXTILES CO LTD", "State code 33", "HBL/26-27/0042 / 28-Sep-2026", "MAEU254781936 / 28-Sep-2026",
  "177516002885", "LCL", "MSC ANNA / FJ642W", "2345678 dated 18-Oct-2026", "10, sub-item 2", "CONTINENTAL CFS", "MSC AGENCY INDIA", "Collect",
  "PO-5521", "INV/26-27/0311", "1775004", "N/M", "MSKU7834512 - 40HC", "SL998877", "120 ROLLS", "18,500.000", "62.500", "USD 95,000",
  "freight certificate", "One original house B/L", "PAN ABDCA2229C",
].filter((want) => !fullText.includes(want)), []);
is("not said how it is released: no original assumed", (await bodies(renderDocument(an, documentDataFromManual({ ...fullCan, releaseMode: "" }))))[0].join(" ").includes("or our confirmation of its telex release"), true);
is("in rupees when rupees are chosen", (await bodies(renderDocument(an, documentDataFromManual({ ...fullCan, currency: "INR" }))))[0].join(" ").includes("Rs. 95,000"), true);

console.log("\nthe currency, on every document that prints a sum");
const fieldKeys = (id: string) => (manualDocument(id) as FormDoc).sections.flatMap((s) => (s.fields ?? []).map((f) => f.key));
is("asked where there is money", ["quotation", "booking-confirmation", "commercial-invoice", "freight-invoice"].map((id) => fieldKeys(id).includes("currency")), [true, true, true, true]);
is("not asked where there is none", ["vgm-declaration", "proof-of-delivery"].map((id) => fieldKeys(id).includes("currency")), [false, false]);
is("dollars until rupees are chosen", [emptyState().shipment.currency, documentDataFromManual({}).currency, documentDataFromManual({ currency: "INR" }).currency], ["USD", "USD", "INR"]);

console.log("\nthe freight invoice, charge by charge");
const fi = manualDocument("freight-invoice") as FormDoc;
const chargeTable = fi.sections.find((s) => s.table?.key === "charges")?.table;
is("has a charges table, with the usual sets", chargeTable?.presets?.map((p) => p.label), ["FCL export", "LCL export", "FCL import", "LCL import", "Air export"]);
is("the LCL set", chargeTable?.presets?.find((p) => p.label === "LCL export")?.rows.map((r) => [r.charge, r.basis]), [
  ["Ocean freight", "Container"], ["CFS charges", "W/M"], ["LCL THC", "W/M"], ["Consolidation / stuffing", "W/M"], ["B/L fee", "B/L"], ["Customs clearance", "Shipment"],
]);
const invoice: ManualValues = {
  reference: "ALG09004-26", company: "TEST IMPORTS PVT LTD", origin: "CHENNAI", destination: "JEBEL ALI", currency: "USD",
  charges: [
    { charge: "Ocean freight", basis: "W/M", quantity: "4.5", rate: "60", gst: "", sac: "" },
    { charge: "CFS charges", basis: "", quantity: "4.5", rate: "12", gst: "18", sac: "" },
    { charge: "B/L fee", basis: "", quantity: "", rate: "", gst: "18", sac: "" },
    { charge: "", basis: "", quantity: "", rate: "", gst: "", sac: "" },
  ],
};
const lines = documentDataFromManual(invoice).charges!;
is("blank lines left out; SAC and basis from the list; no quantity is one", lines.map((l) => [l.charge, l.sac, l.basis, l.quantity]), [
  ["Ocean freight", "996521", "W/M", 4.5], ["CFS charges", "996719", "W/M", 4.5], ["B/L fee", "996799", "B/L", 1],
]);
is("a line with no rate keeps it a draft", missingOf(fi, { ...emptyState(), shipment: invoice }), ["Rate for B/L fee"]);
const priced = { ...invoice, charges: (invoice.charges as Array<Record<string, string>>).map((r) => (r.charge === "B/L fee" ? { ...r, rate: "50" } : r)) };
is("every line priced: nothing outstanding", missingOf(fi, { ...emptyState(), shipment: priced }), []);
const fiText = (await bodies(fi.render(priced))).flat().join(" ");
is("the lines and totals on the invoice", ["CHARGES", "AMOUNT (USD)", "GST (USD)", "996719", "270.00", "54.00", "9.72", "Taxable value", "374.00", "18.72", "392.72"].filter((w) => !fiText.includes(w)), []);
is("not the freight twice", fiText.includes("Ocean freight USD"), false);
is("without lines, the one freight figure, as before", missingOf(fi, { ...emptyState(), shipment: { origin: "CHENNAI", destination: "JEBEL ALI" } }), ["Agreed freight rate"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
