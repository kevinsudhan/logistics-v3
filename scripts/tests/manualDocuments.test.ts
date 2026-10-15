import {
  blFieldOf,
  blOf,
  documentDataFromManual,
  documentForKey,
  emptyState,
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
import { rupeesInWords, statementTotal, taxLines } from "../../src/lib/documents/charges";
import type { DocumentData } from "../../src/lib/documents/types";
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
is("the usual currency: freight in dollars, the rest in rupees", chargeTable?.presets?.find((p) => p.label === "LCL export")?.rows.map((r) => r.currency), ["USD", "INR", "INR", "INR", "INR", "INR"]);
const invoice: ManualValues = {
  reference: "ALG09004-26", company: "TEST IMPORTS PVT LTD", origin: "CHENNAI", destination: "JEBEL ALI", roe_USD: "83.50",
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
is("each rate in its currency, converted, GST and totals in rupees, the rates printed", [
  "CHARGES", "ROE", "AMOUNT (INR)", "GST (INR)", "TOTAL (INR)", "USD 60.00", "EUR 50.00", "INR 650.00", "INR 5,000.00", "83.50", "22,545.00", "2,925.00", "4,500.00",
  "526.50", "810.00", "900.00", "Taxable value (INR)", "34,970.00", "2,236.50", "37,206.50", "Rates of exchange", "1 USD = INR 83.50", "1 EUR = INR 90.00",
].filter((w) => !fiText.includes(w)), []);
is("not the freight twice", fiText.includes("Ocean freight USD"), false);
const missingRoe = (await bodies(fi.render({ ...priced, roe_EUR: "" }))).flat().join(" ");
is("without a rate of exchange, its line and the totals are TBD", [missingRoe.includes("1 EUR = INR TBD"), missingRoe.includes("37,206.50"), missingRoe.includes("Rate of exchange for EUR")], [true, false, true]);
const inrOnly = (await bodies(fi.render({ origin: "CHENNAI", destination: "JEBEL ALI", charges: [{ charge: "THC", currency: "INR", rate: "1000" }] }))).flat().join(" ");
is("all in rupees: no rate-of-exchange column or line", [inrOnly.includes("ROE"), inrOnly.includes("Rates of exchange"), inrOnly.includes("1,000.00")], [false, false, true]);
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
const freightText = (await bodies(fi.render(parties))).flat().join(" ");
is("three boxes, each with its address and GSTIN", [
  "SHIPPER / EXPORTER", "CONSIGNEE / IMPORTER", "NOTIFY PARTY / FORWARDER", "SAMPLE TEXTILES PVT LTD", "TIRUPPUR 641604", "GSTIN / IEC: 33AABCS1234F1Z9",
  "GULF TRADING LLC", "GSTIN: TRN 100200300", "SAMPLE FORWARDERS FZE", "JEBEL ALI FREE ZONE", "GSTIN: TRN 100400500", "FREIGHT INVOICE", "FI-HBL/26-27/0042", "GST (INR)",
].filter((w) => !freightText.includes(w)), []);
const proformaValues = { ...parties, invoice_kind: "proforma" };
const proformaText = (await bodies(fi.render(proformaValues))).flat().join(" ");
is("the proforma: its own title and number, the parties, GST as lines of its own and in the total", [
  proformaText.includes("PROFORMA INVOICE"), proformaText.includes("PI-HBL/26-27/0042"), proformaText.includes("NOTIFY PARTY / FORWARDER"),
  ["GST %", "GST (INR)", "Taxable value"].some((w) => proformaText.includes(w)), proformaText.includes("Central Goods and Service Tax @9%"), proformaText.includes("37,206.50"), proformaText.includes("not a tax invoice"),
], [true, true, true, false, true, true, true]);
is("named as a proforma", [fi.fileName(proformaValues), fi.documentNo?.(proformaValues)], ["PI-HBL-26-27-0042-proforma-invoice.pdf", "PI-HBL/26-27/0042"]);

console.log("\nas a statement of charges");
const statement: ManualValues = {
  ...proformaValues, freightTerms: "Collect", vessel: "WAN HAI 326", voyage: "W062", carrier: "WAN HAI LINES", masterBlNumber: "030G547522",
  cargoDescription: "INJECTION MOULD", portOfLoading: "SHEKOU", finalDestination: "CHENNAI", containerType: "42P3", containerId: "WHSU8296786",
  packageCount: "1", grossWeightKg: "751.5", volumeCbm: "0.215", salesRef: "DINESH CHN",
};
const statementText = (await bodies(fi.render(statement))).flat().join(" ");
is("the proforma's columns, the shipment's particulars, headed with the freight terms, the total in words", [
  "COLLECT CHARGES", "S.NO", "CHARGE NAME", "VOLUME", "PER UNIT", "CURRENCY", "ROE", "AMOUNT", "IN INR", "1.000", "WAN HAI 326", "W062", "WAN HAI LINES",
  "030G547522", "HBL/26-27/0042", "INJECTION MOULD", "SHEKOU", "42P3 WHSU8296786", "751.5 kg", "0.215 CBM", "DINESH CHN",
  "TAX", "Amount in words: Indian Rupees Thirty-Seven Thousand Two Hundred and Six and Fifty Paise Only",
].filter((w) => !statementText.includes(w)), []);
const toShipper = (await bodies(fi.render({ ...statement, bill_to: "shipper" }))).flat().join(" ");
is("the party billed: its box says so, with the state code and PAN read from a GSTIN", [
  statementText.includes("CONSIGNEE / IMPORTER · BILLED TO"), toShipper.includes("SHIPPER / EXPORTER · BILLED TO"), toShipper.includes("State code: 33 (Tamil Nadu)"),
  toShipper.includes("PAN: AABCS1234F"), statementText.includes("State code"),
], [true, true, true, true, false]);

console.log("\nthe GST a statement adds, as lines");
const sampleLines = [
  { charge: "Freight charge", currency: "USD", quantity: 1, rate: 18, gstPercent: 5 },
  { charge: "LCL charges", currency: "INR", quantity: 1, rate: 300, gstPercent: 18 },
  { charge: "Delivery order charges", currency: "INR", quantity: 1, rate: 1000, gstPercent: 18 },
  { charge: "Not taxed", currency: "INR", quantity: 1, rate: 50 },
];
const sampleData = { exchangeRates: { USD: 98.4 }, billTo: "consignee", consigneeGstin: "33AAACF1234K1Z5" } as unknown as DocumentData;
is("within the state: central and state tax, half the rate each, the highest rate first", taxLines(sampleLines, sampleData), [
  { label: "Central Goods and Service Tax @9%", amount: 117 },
  { label: "State Goods and Service Tax @9%", amount: 117 },
  { label: "Central Goods and Service Tax @2.5%", amount: 44.28 },
  { label: "State Goods and Service Tax @2.5%", amount: 44.28 },
]);
is("the statement's total: the charges and the tax lines, as on the sample", statementTotal(sampleLines.slice(0, 3), sampleData), 3393.76);
is("billed in another state: integrated tax at the whole rate", taxLines(sampleLines, { ...sampleData, consigneeGstin: "29AAACF1234K1Z5" }), [
  { label: "Integrated Goods and Service Tax @18%", amount: 234 },
  { label: "Integrated Goods and Service Tax @5%", amount: 88.56 },
]);
is("no rate of exchange yet: the tax on it is not known either", taxLines(sampleLines, { ...sampleData, exchangeRates: {} }).map((t) => t.amount), [117, 117, undefined, undefined]);
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
is("an old save opens with what is new blank, not missing", withSaved(emptyState(), "shipment", { blNumber: "X" }).shipment, { currency: "USD", invoice_kind: "freight", bill_to: "consignee", blNumber: "X" });
is("a B/L number written one way, as the database writes it", normaliseBl("  hbl/26-27/0042   x "), "HBL/26-27/0042 X");

is("without lines, the one freight figure, as before", missingOf(fi, { ...emptyState(), shipment: { origin: "CHENNAI", destination: "JEBEL ALI" } }), ["Agreed freight rate"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
