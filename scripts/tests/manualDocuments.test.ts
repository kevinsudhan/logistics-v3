import {
  blFieldOf,
  blOf,
  documentDataFromManual,
  documentForKey,
  emptyState,
  financialYear,
  normaliseBl,
  keysOf,
  manualDocument,
  MANUAL_DOCUMENTS,
  MANUAL_SOURCE_NOTE,
  matches,
  missingOf,
  pdfOf,
  savedKeyOf,
  savedLabelOf,
  savedValuesOf,
  sectionsFor,
  withSaved,
} from "../../src/lib/documents/manual";
import { CONSOLE_DOCUMENTS, manifestInput, masterSiInput, outturnInput, stuffingInput, cfsNominationInput } from "../../src/lib/documents/manualConsole";
import { parseNumber, shownFields, unreadableNumbers, type FormDoc, type ManualValues } from "../../src/lib/documents/manualForm";
import { DOCUMENTS, documentSpec } from "../../src/lib/documents/registry";
import { chargeTotals, lineTax, rupeesInWords, taxSummary } from "../../src/lib/documents/charges";
import type { DocumentData } from "../../src/lib/documents/types";
import { documentDataFromBooking, readiness } from "../../src/lib/documents/data";
import { renderDocument } from "../../src/lib/documents/render";
import { issuedToday } from "../../src/lib/documents/letterhead";
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
  // A field on the form only some of the time (a rate of exchange) is required then, by the document's own check.
  const required = fields.filter((f) => f.required && !f.when).map((f) => f.key).sort();
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
  freightAmountInr: "95000", incoterm: "FOB", paymentTerms: "30 DAYS", invoice_no: "9", invoice_date: "2026-10-23",
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
is("the usual currency: freight in dollars, the rest in rupees", chargeTable?.presets?.find((p) => p.label === "LCL export")?.rows.map((r) => r.currency), ["USD", "INR", "INR", "INR", "INR", "INR"]);
const invoice: ManualValues = {
  reference: "ALG09004-26", company: "TEST IMPORTS PVT LTD", origin: "CHENNAI", destination: "JEBEL ALI", roe_USD: "83.50", invoice_no: "12", invoice_date: "2026-10-23",
  charges: [
    { charge: "Ocean freight", basis: "W/M", quantity: "4.5", currency: "USD", rate: "60", gst: "", sac: "" },
    { charge: "CFS charges", basis: "", quantity: "4.5", currency: "INR", rate: "650", gst: "18", sac: "" },
    { charge: "Documentation fee", basis: "", quantity: "", currency: "EUR", rate: "50", gst: "18", sac: "" },
    { charge: "B/L fee", basis: "", quantity: "", currency: "", rate: "", gst: "18", sac: "" },
    { charge: "", basis: "", quantity: "", currency: "", rate: "", gst: "", sac: "" },
  ],
};
const lines = documentDataFromManual(invoice).charges!;
is("blank lines left out; SAC and basis from the list; no quantity is one; no currency is rupees", lines.map((l) => [l.charge, l.sac, l.basis, l.quantity, l.currency]), [
  ["Ocean freight", "996521", "W/M", 4.5, "USD"], ["CFS charges", "996719", "W/M", 4.5, "INR"], ["Documentation fee", "996799", "Shipment", 1, "EUR"], ["B/L fee", "996799", "B/L", 1, "INR"],
]);
const roeSection = fi.sections.find((s) => s.title === "Rates of exchange")!;
is("a rate of exchange asked for each foreign currency on the lines, and no other", shownFields(roeSection, invoice).map((f) => f.key), ["roe_USD", "roe_EUR"]);
is("none asked for an invoice all in rupees", shownFields(roeSection, { charges: [{ charge: "THC", currency: "INR", rate: "1" }] }).length, 0);
is("a line with no rate, and a currency with no rate of exchange, keep it a draft", missingOf(fi, { ...emptyState(), shipment: invoice }), ["Rate for B/L fee", "Rate of exchange for EUR"]);
const priced: ManualValues = { ...invoice, roe_EUR: "90", charges: (invoice.charges as Array<Record<string, string>>).map((r) => (r.charge === "B/L fee" ? { ...r, rate: "5000" } : r)) };
is("every line priced and every rate given: nothing outstanding", missingOf(fi, { ...emptyState(), shipment: priced }), []);
const fiText = (await bodies(fi.render(priced))).flat().join(" ");
is("each rate in its currency, converted, the tax on each line and the totals in rupees, the rates printed", [
  "CURR.", "ROE", "CGST", "SGST", "AMT IN INR", "USD", "EUR", "60.00", "650.00", "50.00", "5,000.00", "83.50", "22,545.00", "2,925.00", "4,500.00",
  "263.25", "405.00", "450.00", "Total (INR)", "34,970.00", "1,118.25", "37,206.50", "Rates of exchange", "1 USD = INR 83.50", "1 EUR = INR 90.00",
].filter((w) => !fiText.includes(w)), []);
is("not the freight twice", fiText.includes("Ocean freight USD"), false);
const missingRoe = (await bodies(fi.render({ ...priced, roe_EUR: "" }))).flat().join(" ");
is("without a rate of exchange, its line and the totals are TBD", [missingRoe.includes("1 EUR = INR TBD"), missingRoe.includes("37,206.50"), missingRoe.includes("Rate of exchange for EUR")], [true, false, true]);
const inrOnly = (await bodies(fi.render({ origin: "CHENNAI", destination: "JEBEL ALI", charges: [{ charge: "THC", currency: "INR", rate: "1000" }] }))).flat().join(" ");
is("all in rupees: the ROE column as the e-invoice has it, a dash; no rates of exchange", [inrOnly.includes("ROE"), inrOnly.includes("Rates of exchange"), inrOnly.includes("1,000.00")], [true, false, true]);
console.log("\nthe freight invoice, or its proforma, with three parties");
is("the toggle first on the form, freight until a proforma is chosen", [fi.sections[0].fields?.[0]?.key, fi.sections[0].fields?.[0]?.input, emptyState().shipment.invoice_kind], ["invoice_kind", "segmented", "freight"]);
has("the three parties' fields on the form", fi.sections.flatMap((s) => (s.fields ?? []).map((f) => f.key)), [
  "shipperName", "shipperAddress", "shipperGstinIec", "consigneeName", "consigneeAddress", "consigneeGstin", "notifyName", "notifyAddress", "notifyGstin",
]);
const gstColumn = chargeTable!.columns.find((c) => c.key === "gst")!;
is("GST % typed on the lines of both forms", gstColumn.when, undefined);
const parties: ManualValues = {
  ...priced, blNumber: "HBL/26-27/0042",
  shipperName: "SAMPLE TEXTILES PVT LTD", shipperAddress: "TIRUPPUR 641604", shipperGstinIec: "33AABCS1234F1Z9",
  consigneeName: "GULF TRADING LLC", consigneeAddress: "DEIRA, DUBAI", consigneeGstin: "TRN 100200300",
  notifyName: "SAMPLE FORWARDERS FZE", notifyAddress: "JEBEL ALI FREE ZONE", notifyGstin: "TRN 100400500",
};
const freightItems = (await bodies(fi.render(parties))).flat();
const freightText = freightItems.join(" ");
is("label and value: the party billed, the other parties, each with its address and GSTIN", [
  "Billed to", "GULF TRADING LLC", "DEIRA, DUBAI", "TRN 100200300", "Shipper", "SAMPLE TEXTILES PVT LTD", "TIRUPPUR 641604", "GSTIN / IEC: 33AABCS1234F1Z9",
  "Notify party", "SAMPLE FORWARDERS FZE", "JEBEL ALI FREE ZONE", "GSTIN: TRN 100400500", "TAX INVOICE", "ORIGINAL", "Invoice number", "ALG/26-27/0012", "Reverse charge", "CGST",
].filter((w) => !freightText.includes(w)), []);
is("the party billed in full once; as consignee, by name alone", [freightItems.filter((t) => t === "DEIRA, DUBAI").length, freightItems.filter((t) => t === "GULF TRADING LLC").length], [1, 2]);
is("our PAN, GSTIN and bank account at the foot, with the terms", [
  "PAN: ABDCA2229C", "GSTIN: 33ABDCA2229C1ZD", "Bank details", "AASHISH LOGISTICS GLOBAL PVT LTD", "HDFC BANK LTD, ANNA NAGAR", "50200110838580", "HDFC0000017",
  "Terms:", "Subject to Chennai jurisdiction.", "E. & O.E.", "Authorised signatory",
].filter((w) => !freightText.includes(w)), []);
const proformaValues = { ...parties, invoice_kind: "proforma" };
const proformaText = (await bodies(fi.render(proformaValues))).flat().join(" ");
is("the proforma: its own title and number, the parties, the tax and the bank as the invoice's, not a tax invoice", [
  proformaText.includes("PROFORMA INVOICE"), proformaText.includes("PI-HBL/26-27/0042"), proformaText.includes("Proforma number"), proformaText.includes("Notify party"),
  proformaText.includes("CGST"), proformaText.includes("37,206.50"), proformaText.includes("50200110838580"), proformaText.includes("not a tax invoice"),
  proformaText.includes("Reverse charge"), proformaText.includes("Invoice number"), proformaText.includes("ORIGINAL"),
], [true, true, true, true, true, true, true, true, false, false, false]);
is("named as a proforma", [fi.fileName(proformaValues), fi.documentNo?.(proformaValues)], ["PI-HBL-26-27-0042-proforma-invoice.pdf", "PI-HBL/26-27/0042"]);

console.log("\nlaid out as the line's e-invoice");
const statement: ManualValues = {
  ...proformaValues, freightTerms: "Collect", vessel: "WAN HAI 326", voyage: "W062", carrier: "WAN HAI LINES", masterBlNumber: "030G547522",
  cargoDescription: "INJECTION MOULD", portOfLoading: "SHEKOU", finalDestination: "CHENNAI", containerType: "42P3", containerId: "WHSU8296786",
  packageCount: "1", grossWeightKg: "751.5", volumeCbm: "0.215", salesRef: "DINESH CHN", igmNumber: "1214865", igmDate: "2026-10-01", igmItemNo: "644", igmSubItemNo: "10",
};
const statementText = (await bodies(fi.render(statement))).flat().join(" ");
is("the charges' columns, the shipment four to a line, the tax by SAC, the total in words", [
  "NO", "CHARGE DETAILS", "HSN/SAC", "CURR.", "RATE / UNIT", "UNIT", "CURR. AMT", "ROE", "TAXABLE AMT", "RATE", "CGST", "SGST", "AMT IN INR", "Collect",
  "Vessel", "WAN HAI 326", "Voyage number", "W062", "WAN HAI LINES", "Master number", "030G547522", "House number", "HBL/26-27/0042", "INJECTION MOULD",
  "Port of origin", "SHEKOU", "WHSU8296786 - 42P3", "Weight (kgs)", "751.500", "Volume (CBM)", "0.215", "DINESH CHN", "IGM number", "1214865 / 01-Oct-2026",
  "Item number", "644", "Sub item number", "IGST", "TOTAL AMT", "Amount in words: Indian Rupees Thirty-Seven Thousand Two Hundred and Six and Fifty Paise Only",
].filter((w) => !statementText.includes(w)), []);
const toShipperItems = (await bodies(fi.render({ ...statement, bill_to: "shipper" }))).flat();
const toShipper = toShipperItems.join(" ");
is("billed to the shipper: it in full as Billed to, with the state and PAN read from its GSTIN; the consignee in full", [
  toShipperItems.includes("AABCS1234F"), toShipper.includes("33 (Tamil Nadu)"), toShipper.includes("GSTIN / IEC: 33AABCS1234F1Z9"), toShipper.includes("DEIRA, DUBAI"),
  statementText.includes("GSTIN / IEC: 33AABCS1234F1Z9"), statementText.split(" ").includes("AABCS1234F"),
], [true, true, false, true, true, false]);

console.log("\nthe tax invoice's number: ALG, the financial year, the last part typed");
const numbered = (v: ManualValues) => fi.documentNo?.({ ...parties, invoice_kind: "freight", ...v });
is("the financial year runs April to March", [financialYear("2026-03-31"), financialYear("2026-04-01"), financialYear("2027-01-15"), financialYear("2099-12-31")], ["25-26", "26-27", "26-27", "99-00"]);
is("the last part made four digits; a longer one as typed", [
  numbered({ invoice_no: "4", invoice_date: "2026-10-23" }), numbered({ invoice_no: " 12 ", invoice_date: "2026-10-23" }), numbered({ invoice_no: "12345", invoice_date: "2026-10-23" }),
], ["ALG/26-27/0004", "ALG/26-27/0012", "ALG/26-27/12345"]);
is("the year from the invoice date: a March invoice is the year before's", numbered({ invoice_no: "7", invoice_date: "2027-03-31" }), "ALG/26-27/0007");
is("the year from today while no date is typed", numbered({ invoice_no: "4", invoice_date: "" }), `ALG/${financialYear(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10))}/0004`);
const unnumbered = { ...parties, invoice_kind: "freight", invoice_no: "" };
const unnumberedText = (await bodies(fi.render(unnumbered))).flat().join(" ");
is("not typed: a draft that says so, the number TBD, still kept and named by its job", [
  missingOf(fi, { ...emptyState(), shipment: unnumbered }), unnumberedText.includes("DRAFT"), unnumberedText.includes("ALG/"), fi.documentNo?.(unnumbered),
], [["Invoice number"], true, false, "FI-HBL/26-27/0042"]);
const numberAsked = fi.sections.find((s) => s.title === "Invoice particulars")!;
is("asked for on the tax invoice, not the proforma, which keeps its PI- number", [
  shownFields(numberAsked, { invoice_kind: "freight" }).some((f) => f.key === "invoice_no"),
  shownFields(numberAsked, { invoice_kind: "proforma" }).some((f) => f.key === "invoice_no"),
  missingOf(fi, { ...emptyState(), shipment: { ...unnumbered, invoice_kind: "proforma" } }), fi.documentNo?.({ ...unnumbered, invoice_no: "4", invoice_kind: "proforma" }),
], [true, false, [], "PI-HBL/26-27/0042"]);

console.log("\na tax invoice, with every particular of the e-invoice");
is("called a tax invoice; still found as the freight invoice, kept as it was; numbered in our series", [
  fi.shortName, matches(fi, "freight invoice"), matches(fi, "tax invoice"), fi.fileName({ ...parties, invoice_kind: "freight" }), fi.documentNo?.({ ...parties, invoice_kind: "freight" }), fi.id,
], ["Tax invoice", true, true, "ALG-26-27-0012-tax-invoice.pdf", "ALG/26-27/0012", "freight-invoice"]);
has("every particular typed on the form", fieldKeys("freight-invoice"), [
  "invoice_no", "copy", "invoice_date", "due_date", "job_date", "customer_code", "customer_pan", "irn", "advance_receipt", "shipper_ref", "vehicle_no", "note", "our_tan", "our_lut", "our_msme",
  "vessel", "voyage", "sailingDate", "etaDate", "igmNumber", "igmDate", "igmItemNo", "igmSubItemNo", "salesRef", "masterBlNumber", "blNumber", "containerId", "containerType",
]);
const IRN = "dbe6a5131bd804ccbefed158dc302ddf383fb85a34db1284bc69ddd273656b6e";
const particulars: ManualValues = {
  ...statement, invoice_kind: "freight", copy: "duplicate", invoice_date: "2025-03-14", due_date: "2026-10-29", job_date: "2026-10-16", customer_code: "1103010005",
  customer_pan: "aaacf9999k", irn: IRN, advance_receipt: "AR/26-27/0018", shipper_ref: "QDHD-2609-11", vehicle_no: "TN 04 AB 1234", note: "Deliver to the CFS",
  our_tan: "CHEA12345B", our_lut: "AD3303260436290", our_msme: "UDYAM-TN-02-0012345",
};
const particularItems = (await bodies(fi.render(particulars))).flat();
const particularText = particularItems.join(" ");
is("each prints under the e-invoice's label", [
  "DUPLICATE", "Customer code", "1103010005", "Customer PAN no", "AAACF9999K", "IRN", "Date", "14-Mar-2025", "Payment due date", "29-Oct-2026", "Job date", "16-Oct-2026",
  "Advance receipt no", "AR/26-27/0018", "Shipper ref no", "QDHD-2609-11", "Vehicle no", "TN 04 AB 1234", "Note", "Deliver to the CFS",
  "TAN: CHEA12345B", "LUT: AD3303260436290", "MSME: UDYAM-TN-02-0012345",
].filter((w) => !particularText.includes(w)), []);
is("the IRN whole, over as many lines as it takes", particularText.replace(/\s+/g, "").includes(IRN), true);
is("dated as typed, not the day it is printed", [particularItems.includes("14-Mar-2025"), particularText.includes(issuedToday())], [true, false]);
const untyped = (await bodies(fi.render({ ...statement, invoice_kind: "freight" }))).flat();
is("left off while empty; an untyped copy is the original", [
  ["Customer code", "IRN", "Payment due date", "Job date", "Advance receipt no", "Shipper ref no", "Vehicle no", "Note"].filter((w) => untyped.includes(w)), untyped.includes("ORIGINAL"),
], [[], true]);
const proformaTyped = (await bodies(fi.render({ ...particulars, invoice_kind: "proforma" }))).flat();
is("the proforma: not one of a tax invoice's copies, no IRN, no reverse charge", [
  ["DUPLICATE", "ORIGINAL", "IRN", "Reverse charge"].filter((w) => proformaTyped.includes(w)), proformaTyped.includes("Customer code"),
], [[], true]);

console.log("\nan invoice is one page, however many charges");
/** What is printed on the first page, and the size in points it is printed at. */
async function printed(pdf: jsPDF) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf.output("arraybuffer")), verbosity: 0 }).promise;
  const items = (await (await doc.getPage(1)).getTextContent()).items as Array<{ str: string; transform: number[] }>;
  const strs = items.map((i) => i.str.trim());
  const size = (str: string) => {
    const item = items.find((i) => i.str.trim() === str);
    return item ? Math.round(Math.hypot(item.transform[0], item.transform[1]) * 10) / 10 : undefined;
  };
  /** How far up from the foot of the page, in mm, a string is printed. */
  const fromFoot = (str: string) => {
    const item = items.find((i) => i.str.trim() === str);
    return item ? Math.round((item.transform[5] / 72) * 25.4) : undefined;
  };
  return { pages: doc.numPages, text: strs.join(" "), items: strs, size, fromFoot };
}
const charged = (n: number): ManualValues => ({
  ...statement,
  charges: Array.from({ length: n }, (_, i) => ({ charge: `Charge ${i + 1}${i % 3 ? "" : " with a description long enough to wrap"}`, currency: i % 4 ? "INR" : "USD", rate: String(100 + i), gst: "18", sac: "" })),
});
for (const n of [3, 9, 20, 40, 80]) {
  for (const kind of ["freight", "proforma"]) {
    const p = await printed(fi.render({ ...charged(n), invoice_kind: kind }));
    // Each charge's own line, whole or the first of its wrapped lines: "Charge 2" is not found in "Charge 20".
    const all = Array.from({ length: n }, (_, i) => `Charge ${i + 1}`).every((c) => p.items.some((t) => t === c || t.startsWith(`${c} `)));
    is(`${n} charges, ${kind}: one page, every charge, the total, the bank and the signature on it`, [
      p.pages, all, p.text.includes("Amount in words"), p.text.includes("50200110838580"), p.text.includes("Authorised signatory"),
    ], [1, true, true, true, true]);
  }
}
const few = await printed(fi.render({ ...charged(3), invoice_kind: "freight" }));
const many = await printed(fi.render({ ...charged(40), invoice_kind: "freight" }));
is("no footer under an invoice; the signature at the foot of the page, few charges or many", [
  few.text.includes("System-generated"), few.text.includes("Page 1 of 1"), (few.fromFoot("Authorised signatory") ?? 99) < 32, (many.fromFoot("Authorised signatory") ?? 99) < 32,
], [false, false, true, true]);
is("three charges: everything its size", [few.size("TAX INVOICE"), few.size("Charge 2"), few.size("Billed to"), few.size("Bank details")], [13, 7, 7.2, 7.2]);
is("forty: only the charges' lines smaller; the title, the particulars, the total and the bank their size", [
  many.size("TAX INVOICE"), many.size("Billed to"), many.size("Total (INR)"), many.size("Bank details"), many.size("Terms:"), (many.size("Charge 2") ?? 7) < 7,
], [13, 7.2, 7.4, 7.2, 6.8, true]);

console.log("\nthe tax on each line, and by SAC");
// The line's e-invoice, QDWJ26093202: its figures, to the paisa.
const sampleLines = [
  { charge: "Freight charge", sac: "996521", currency: "USD", quantity: 1, rate: 35, gstPercent: 5 },
  { charge: "LCL charges", sac: "996759", currency: "INR", quantity: 1, rate: 300, gstPercent: 18 },
  { charge: "Delivery order charges", sac: "996759", currency: "INR", quantity: 1, rate: 1000, gstPercent: 18 },
];
const sampleData = { exchangeRates: { USD: 98.34 }, billTo: "consignee", consigneeGstin: "33AAACF1234K1Z5" } as unknown as DocumentData;
is("within the state: central and state tax, half the rate each, on the line", lineTax(sampleLines[0], sampleData), { taxable: 3441.9, cgst: 86.05, sgst: 86.05, igst: 0, total: 3614 });
is("the columns totalled, as on the sample", chargeTotals(sampleLines, sampleData), { taxable: 4741.9, cgst: 203.05, sgst: 203.05, igst: 0, total: 5148 });
is("by SAC and rate, as on the sample", taxSummary(sampleLines, sampleData), [
  { sac: "996521", rate: 5, taxable: 3441.9, cgst: 86.05, sgst: 86.05, igst: 0, total: 3614 },
  { sac: "996759", rate: 18, taxable: 1300, cgst: 117, sgst: 117, igst: 0, total: 1534 },
]);
is("a line without GST: no tax on it", lineTax({ charge: "Not taxed", currency: "INR", rate: 50 }, sampleData), { taxable: 50, cgst: 0, sgst: 0, igst: 0, total: 50 });
is("billed in another state: integrated tax at the whole rate", taxSummary(sampleLines, { ...sampleData, consigneeGstin: "29AAACF1234K1Z5" })?.map((s) => [s.sac, s.cgst, s.sgst, s.igst]), [
  ["996521", 0, 0, 172.1],
  ["996759", 0, 0, 234],
]);
is("no rate of exchange yet: the tax on it, the totals and the summary are not known either", [
  lineTax(sampleLines[0], { ...sampleData, exchangeRates: {} }), chargeTotals(sampleLines, { ...sampleData, exchangeRates: {} }), taxSummary(sampleLines, { ...sampleData, exchangeRates: {} }),
], [undefined, undefined, undefined]);
is("rupees in words, counted the Indian way", [rupeesInWords(3393.76), rupeesInWords(110025), rupeesInWords(12345678.9), rupeesInWords(100), rupeesInWords(0)], [
  "Indian Rupees Three Thousand Three Hundred and Ninety-Three and Seventy-Six Paise Only",
  "Indian Rupees One Lakh Ten Thousand and Twenty-Five Only",
  "Indian Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred and Seventy-Eight and Ninety Paise Only",
  "Indian Rupees One Hundred Only",
  "Indian Rupees Zero Only",
]);

console.log("\nkept by B/L number");
const withInvoice = { ...emptyState(), shipment: parties };
is("a shipment document is kept under its B/L, the invoice's two forms as two papers", [
  blOf(fi, withInvoice), savedKeyOf(fi, withInvoice), savedKeyOf(fi, { ...withInvoice, shipment: proformaValues }), savedLabelOf(fi, { ...withInvoice, shipment: proformaValues }),
], ["HBL/26-27/0042", "freight-invoice", "proforma-invoice", { title: "Proforma invoice", documentNo: "PI-HBL/26-27/0042" }]);
is("a house bill under its number; a console document under its master B/L", [
  blOf(manualDocument("house-bl")!, { ...emptyState(), hbl: { ...emptyState().hbl, hblNo: " HBL/1 " } }),
  blOf(CONSOLE_DOCUMENTS[0], { ...emptyState(), console: { mbl_number: "MAEU123" } }),
  blFieldOf(fi), blFieldOf(CONSOLE_DOCUMENTS[0]),
], ["HBL/1", "MAEU123", "B/L number", "Master B/L number"]);
is("no number, nothing to keep it under", blOf(fi, emptyState()), "");
is("a proforma opens into the freight invoice", documentForKey("proforma-invoice")?.id, "freight-invoice");
const reopened = withSaved(emptyState(), "shipment", savedValuesOf(fi, { ...withInvoice, shipment: proformaValues }));
is("opened again: the same paper, the same figures", [savedKeyOf(fi, reopened), fi.documentNo?.(reopened.shipment), missingOf(fi, reopened)], ["proforma-invoice", "PI-HBL/26-27/0042", []]);
is("an old save opens with what is new blank, not missing", withSaved(emptyState(), "shipment", { blNumber: "X" }).shipment, { currency: "USD", invoice_kind: "freight", bill_to: "notify", blNumber: "X" });
is("a new invoice is billed to the notify party; one saved to the consignee stays so", [
  emptyState().shipment.bill_to, withSaved(emptyState(), "shipment", { blNumber: "X", bill_to: "consignee" }).shipment.bill_to,
], ["notify", "consignee"]);
is("a B/L number written one way, as the database writes it", normaliseBl("  hbl/26-27/0042   x "), "HBL/26-27/0042 X");

is("without lines, the one freight figure, as before; and a tax invoice its number", missingOf(fi, { ...emptyState(), shipment: { origin: "CHENNAI", destination: "JEBEL ALI" } }), ["Agreed freight rate", "Invoice number"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
