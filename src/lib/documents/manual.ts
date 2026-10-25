import type { jsPDF } from "jspdf";
import { fieldDef } from "../../data/requestFields";
import { emptyHbl, missingForIssue, normaliseHbl, RELEASE_LABEL, RELEASE_MODES, type HblData, type ReleaseMode } from "../hbl";
import { emptyHawb, missingForOriginal, normaliseHawb, type HawbData } from "../hawb";
import { DOCUMENTS } from "./registry";
import { documentFilename, documentNo, labelFor, readiness } from "./data";
import { renderDocument } from "./render";
import { docDate } from "./letterhead";
import { hblFileName, renderHblPdf, type HblPrint } from "./hblPdf";
import { hawbFileName, renderHawbPdf } from "./hawbPdf";
import { CONSOLE_DOCUMENTS } from "./manualConsole";
import { CHARGE_SETS, chargeHead, CURRENCY_NAME, INVOICE_BASES, INVOICE_CHARGES, INVOICE_CURRENCIES, usualCurrency, usualGst } from "./charges";
import {
  lines,
  parseNumber,
  parseYesNo,
  text,
  type FormDoc,
  type ManualField,
  type ManualGroup,
  type ManualInput,
  type ManualSection,
  type ManualStore,
  type ManualValues,
} from "./manualForm";
import type { ChargeLine, DataKey, DocSpec, DocumentData, InvoiceExtras } from "./types";
import { outstanding, PROFORMA_INVOICE, readyToNumber, TAX_INVOICE } from "./invoice";

/**
 * Documents typed in by hand (Documentation → Manual documents).
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS FOR
 *
 * Every other document in this CRM is drawn from a record: a job, a console,
 * a quotation. That is the rule and it stays the rule. This is the way round
 * it for the paper a record does not hold yet — a job still being moved over
 * from the old system, a one-off for a customer with no enquiry, a CAN for an
 * import that arrived before anybody opened a file — so it is typed in and
 * printed on the same letterhead, by the same renderers, as everything else.
 *
 * WHAT IT IS NOT
 *
 * A record. Nothing typed here is saved to the database, numbered from a
 * sequence, put on a job's timeline or sent from here. It lives in the
 * browser tab (sessionStorage, on the page) and goes when the tab does. The
 * footer of every registry document says it was entered by hand.
 *
 * THE SAME HONESTY RULES
 *
 * A shipment document typed here goes through `renderDocument` like any
 * other: a field left empty prints TBD, and a document missing anything it
 * requires is stamped DRAFT and lists what is outstanding. Typing a document
 * by hand is not a way to print one as final without its particulars.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// The shipment documents: the registry's twelve, as forms
// ---------------------------------------------------------------------------

type ShipmentSection =
  | "bills"
  | "parties"
  | "customer"
  | "route"
  | "arrival"
  | "cargo"
  | "commercial"
  | "handling"
  | "weighing"
  | "delivery";

const SECTION_TITLE: Record<ShipmentSection, string> = {
  bills: "Bills of lading",
  parties: "Parties",
  customer: "Customer",
  route: "Route and carriage",
  arrival: "Arrival",
  cargo: "Cargo",
  commercial: "Value and terms",
  handling: "Handling",
  weighing: "Weighing",
  delivery: "Delivery",
};

interface FieldMeta {
  section: ShipmentSection;
  input?: ManualInput;
  /** Printed after the label: the unit the figure is in. */
  unit?: string;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
}

const options = (values: string[]) => values.map((v) => ({ value: v, label: v }));

const IN_CURRENCY = "In the currency chosen under Document.";

/** The fields that are sums of money: a document printing one says which currency it is in. */
const MONEY_KEYS: DataKey[] = ["freightAmountInr", "targetPriceInr", "invoiceValueInr"];

/**
 * Every field a registry document can print, and how it is typed.
 *
 * A `Record` over DataKey, so a field added to DocumentData does not compile
 * until it says how a person types it. The order is the order on the form.
 */
const FIELDS: Record<DataKey, FieldMeta> = {
  blNumber: { section: "bills", placeholder: "HBL/26-27/0001" },
  blDate: { section: "bills", input: "date" },
  masterBlNumber: { section: "bills", hint: "The carrier's bill the house bill sits under (the OBL), where it differs." },
  masterBlDate: { section: "bills", input: "date" },
  authBlNumber: { section: "bills", hint: "A bill between the master and the house — the co-loader's — printed on the arrival notice as Auth. B/L." },
  authBlDate: { section: "bills", input: "date" },
  bookingNumber: { section: "bills" },
  jobDate: { section: "bills", input: "date", hint: "The day the job was opened: beside its reference on the arrival notice and the invoice." },

  shipperName: { section: "parties" },
  shipperAddress: { section: "parties", input: "textarea", wide: true },
  shipperGstinIec: { section: "parties" },
  consigneeName: { section: "parties" },
  consigneeAddress: { section: "parties", input: "textarea", wide: true },
  consigneeCountry: { section: "parties" },
  consigneeGstin: { section: "parties", placeholder: "33AAACT1234A1Z5", hint: "Its state code is printed from its first two digits." },
  notifyName: { section: "parties", hint: "The consignee's customs broker, copied on the arrival notice." },
  notifyAddress: { section: "parties", input: "textarea", wide: true },
  notifyGstin: { section: "parties" },
  consigneeIec: { section: "parties", hint: "The consignee's importer-exporter code, printed on the delivery order." },
  consigneeIecType: { section: "parties", placeholder: "Proprietary, partnership, company", hint: "Printed beside the IEC on the delivery order." },
  chaName: { section: "parties", hint: "The consignee's customs house agent." },
  originAgent: { section: "parties", hint: "Who the shipment comes from: the origin agent, the arrival notice's From." },

  company: { section: "customer" },
  customerName: { section: "customer" },
  phone: { section: "customer" },

  origin: { section: "route", placeholder: "CHENNAI" },
  destination: { section: "route", placeholder: "JEBEL ALI" },
  finalDestination: { section: "route", hint: "Where it is delivered, when beyond the port of discharge." },
  carrier: { section: "route" },
  serviceType: { section: "route", input: "select" },
  containerId: { section: "route", placeholder: "PCIU1234567" },
  containerType: { section: "route", placeholder: "40HC" },
  sealNumber: { section: "route" },
  sailingDate: { section: "route", input: "date" },
  etaDate: { section: "route", input: "date" },
  finalEtaDate: { section: "route", input: "date" },

  vessel: { section: "arrival" },
  voyage: { section: "arrival" },
  portOfLoading: { section: "arrival" },
  igmNumber: { section: "arrival" },
  igmDate: { section: "arrival", input: "date" },
  igmItemNo: { section: "arrival", hint: "The IGM line the Bill of Entry is filed against." },
  igmSubItemNo: { section: "arrival" },
  cfsName: { section: "arrival" },
  cfsAddress: { section: "arrival", input: "textarea", wide: true },
  cfsEtaDate: { section: "arrival", input: "date", hint: "When the cargo is expected at the CFS, where it is not the vessel's ETA." },
  freeTimeText: { section: "arrival", placeholder: "14 days demurrage, 7 days detention" },
  releaseMode: { section: "arrival", input: "select", hint: "What the consignee must hand over to take delivery." },
  freightTerms: { section: "arrival", input: "select" },
  tsaNumber: { section: "arrival" },
  unstuffDate: { section: "arrival", input: "date", hint: "The day the box was unstuffed at the CFS." },

  marksNumbers: { section: "cargo", placeholder: "N/M" },
  cargoDescription: { section: "cargo", input: "textarea", wide: true },
  cargoType: { section: "cargo", placeholder: "General, reefer, DG" },
  hsCode: { section: "cargo" },
  pieceCount: { section: "cargo", input: "number" },
  pieceDimensions: { section: "cargo", placeholder: "120 x 80 x 100 cm" },
  packageCount: { section: "cargo", input: "number" },
  packageType: { section: "cargo", placeholder: "CARTONS" },
  netWeightKg: { section: "cargo", input: "number", unit: "kg" },
  grossWeightKg: { section: "cargo", input: "number", unit: "kg" },
  volumeCbm: { section: "cargo", input: "number", unit: "CBM" },
  stackable: { section: "cargo", input: "yesno" },
  uprightOnly: { section: "cargo", input: "yesno" },

  freightAmountInr: { section: "commercial", input: "number", hint: IN_CURRENCY },
  targetPriceInr: { section: "commercial", input: "number", hint: IN_CURRENCY },
  invoiceValueInr: { section: "commercial", input: "number", hint: IN_CURRENCY },
  incoterm: { section: "commercial", input: "select" },
  paymentTerms: { section: "commercial", placeholder: "Advance, 30 days, against documents" },
  letterOfCredit: { section: "commercial", input: "yesno" },
  poNumber: { section: "commercial" },
  invoiceRef: { section: "commercial" },
  salesRef: { section: "commercial" },

  temperatureSetpointC: { section: "handling", input: "number", unit: "°C" },
  preCoolingRequired: { section: "handling", input: "yesno" },
  woodPackagingUsed: { section: "handling", input: "yesno" },
  msdsProvided: { section: "handling", input: "yesno" },
  unPackagingSpec: { section: "handling" },
  carrierDgApproval: { section: "handling" },

  vgmMethod: { section: "weighing", input: "select" },
  vgmFacility: { section: "weighing" },
  vgmWeighedOn: { section: "weighing", input: "date" },

  deliverTo: { section: "delivery", hint: "Whom the CFS hands the cargo to: left empty, the consignee." },
  doDate: { section: "delivery", input: "date", hint: "The day the delivery order is issued: left empty, the day it is printed." },
  doValidity: { section: "delivery", input: "date", hint: "The last day the delivery order may be presented." },
  deliveredOn: { section: "delivery", input: "date" },
  receivedBy: { section: "delivery" },
};

const FIELD_ORDER = Object.keys(FIELDS) as DataKey[];
const SECTION_ORDER = Object.keys(SECTION_TITLE) as ShipmentSection[];

/** The two methods SOLAS VI/2 allows, as the declaration names them. */
const VGM_METHODS = ["Method 1: the packed container weighed", "Method 2: the contents weighed, the container's tare added"];

/** The choices for a select field, where the catalogue or SOLAS gives them. */
function optionsFor(key: DataKey) {
  if (key === "incoterm") return [{ value: "", label: "Not named" }, ...options(fieldDef("incoterm")?.options ?? [])];
  if (key === "vgmMethod") return [{ value: "", label: "Not stated" }, ...options(VGM_METHODS)];
  if (key === "serviceType") return [{ value: "", label: "Not stated" }, ...options(["FCL", "LCL"])];
  if (key === "freightTerms") return [{ value: "", label: "Not stated" }, ...options(["Prepaid", "Collect"])];
  if (key === "releaseMode") return [{ value: "", label: "Not stated" }, ...RELEASE_MODES.map((r) => ({ value: r, label: RELEASE_LABEL[r] }))];
  return undefined;
}

/** The parties block the renderer draws for a document with `parties`. */
const PARTY_KEYS: DataKey[] = ["shipperName", "shipperGstinIec", "consigneeName", "consigneeAddress", "consigneeCountry"];

/**
 * Which fields a registry document prints.
 *
 * ---------------------------------------------------------------------------
 * READ FROM THE DOCUMENT, NOT LISTED BESIDE IT
 *
 * A row is a function of the data, so the fields it prints are whatever it
 * reads. Each row is run against a record that notes every field asked for —
 * once with every field empty and once with every field filled, because
 * `d.company ?? d.customerName` reads the second only when the first is empty
 * and `d.origin && d.destination` the second only when the first is not.
 *
 * A list kept by hand here would be right on the day it was written and wrong
 * the first time somebody added a row to the registry. This cannot drift: add
 * a row that prints a new field and the form grows that field.
 * ---------------------------------------------------------------------------
 */
export function keysOf(spec: DocSpec): DataKey[] {
  const read = new Set<string>(spec.requires);
  if (spec.parties) PARTY_KEYS.forEach((k) => read.add(k));
  for (const fill of [undefined, 1]) {
    const probe = new Proxy({} as DocumentData, {
      get: (_, key) => {
        if (typeof key === "string") read.add(key);
        return fill;
      },
    });
    const sections = [...spec.sections, ...(spec.appendix?.sections ?? [])];
    const reads = [
      ...sections.flatMap((s) => [...s.rows.map((r) => () => r.value(probe)), () => s.each?.(probe)]),
      () => spec.notes?.lead?.(probe),
      () => spec.notes?.lines(probe),
    ];
    for (const read of reads) {
      try {
        read();
      } catch {
        // A row that cannot take a stand-in value still read what it read.
      }
    }
  }
  return FIELD_ORDER.filter((k) => read.has(k));
}

const labelOf = (key: DataKey) => {
  const unit = FIELDS[key].unit;
  return unit ? `${labelFor(key)} (${unit})` : labelFor(key);
};

/** The job reference, on every shipment document. */
const REFERENCE: ManualField = {
  key: "reference",
  label: "Job reference",
  placeholder: "ALG09004-26",
  hint: "Printed as the document's reference; the B/L number, where typed, numbers it instead.",
};

/** Dollars or rupees, for every shipment document that prints a sum: they share it, as they share the rest. */
const CURRENCY: ManualField = {
  key: "currency",
  label: "Currency",
  input: "select",
  options: [
    { value: "USD", label: "USD — US dollars" },
    { value: "INR", label: "INR — Indian rupees" },
  ],
  hint: "The rates on the document are in this. A freight invoice's charge lines each name their own currency.",
};

/**
 * The charges of an itemised invoice, a line each.
 *
 * Picked from the list (lib/documents/charges) or typed as they are; the SAC
 * and the basis come from the list when left empty, so picking a charge is
 * enough to price it. Its GST starts at the usual rate for the charge (5% on
 * freight, 18% on the rest) and another can be chosen. A line saved before
 * there was a usual rate, its GST left blank, keeps none: it prints as it
 * was issued.
 */
const USUAL_GST = "usual";

const GST_CHOICES = [
  { value: USUAL_GST, label: "Usual rate" },
  { value: "", label: "None" },
  ...[5, 12, 18, 28, 40].map((r) => ({ value: String(r), label: `${r}%` })),
];

const CHARGES_SECTION: ManualSection = {
  title: "Charges",
  note: "A line per charge, each in its own currency; the invoice totals in INR at the rates of exchange below. Pick a charge or type your own; SAC and basis fill in from the list when left blank. No quantity is one. GST is the usual rate unless chosen: 5% on freight and its surcharges, 18% on LCL and the rest. Itemised, these replace the single freight rate.",
  table: {
    key: "charges",
    label: "Charges",
    lineLabel: "Charge",
    addLabel: "Add a charge",
    columns: [
      { key: "charge", label: "Charge", placeholder: "Ocean freight", suggestions: INVOICE_CHARGES.map((h) => h.label) },
      { key: "basis", label: "Basis", placeholder: "Container, W/M, B/L", suggestions: INVOICE_BASES },
      { key: "quantity", label: "Quantity", input: "number", placeholder: "1" },
      { key: "currency", label: "Currency", input: "select", options: INVOICE_CURRENCIES.map((c) => ({ value: c, label: c })) },
      { key: "rate", label: "Rate", input: "number", required: true },
      { key: "gst", label: "GST %", input: "select", options: GST_CHOICES, default: USUAL_GST },
      { key: "sac", label: "SAC", placeholder: "From the list" },
    ],
    presets: CHARGE_SETS.map((set) => ({
      label: set.label,
      rows: set.charges.map((c) => {
        const h = chargeHead(c);
        return { charge: c, basis: h?.basis ?? "", quantity: "", currency: usualCurrency(h), rate: "", gst: USUAL_GST, sac: "" };
      }),
    })),
  },
};

/** The currencies the typed charge lines are in, other than rupees: the ones a rate of exchange is asked for. */
const foreignTyped = (v: ManualValues) => new Set(lines(v, "charges").map((r) => (r.currency || "INR").toUpperCase()).filter((c) => c !== "INR"));

/**
 * One rate of exchange per foreign currency, for the whole invoice: every
 * line in that currency is converted at it. Each is on the form only while a
 * line is in that currency.
 */
const EXCHANGE_SECTION: ManualSection = {
  title: "Rates of exchange",
  note: "Rupees to one unit of each currency the charges are in. Every line in it is converted at this rate, and the totals are in INR.",
  fields: INVOICE_CURRENCIES.filter((c) => c !== "INR").map(
    (c): ManualField => ({
      key: `roe_${c}`,
      label: `1 ${c} = ? INR`,
      input: "number",
      required: true,
      placeholder: c === "USD" ? "e.g. 83.50" : "",
      hint: CURRENCY_NAME[c],
      when: (v) => foreignTyped(v).has(c),
    })
  ),
};

/** The rates of exchange typed, by currency; one not typed, or not a positive number, is left out. */
function exchangeRatesOf(v: ManualValues): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of INVOICE_CURRENCIES) {
    const r = parseNumber(text(v, `roe_${c}`));
    if (c !== "INR" && r !== undefined && r > 0) out[c] = r;
  }
  return out;
}

/** What was typed on the charge lines, as the invoice prints them; a line with nothing typed is left out. */
function chargesOf(v: ManualValues): ChargeLine[] {
  return lines(v, "charges").map((r, i) => {
    const name = (r.charge ?? "").trim();
    const h = chargeHead(name);
    const quantity = parseNumber(r.quantity);
    return {
      charge: name || `Charge ${i + 1}`,
      sac: (r.sac ?? "").trim() || h?.sac,
      basis: (r.basis ?? "").trim() || h?.basis,
      quantity: quantity ?? 1,
      currency: (r.currency || "INR").toUpperCase(),
      rate: parseNumber(r.rate),
      // The usual rate for the charge, or the one chosen; blank is none (a line saved before there was a usual rate).
      gstPercent: (r.gst ?? "").trim() === USUAL_GST ? usualGst(h) : parseNumber(r.gst),
    };
  });
}

/** The form for one registry document: its fields, in sections, required ones marked. */
export function sectionsFor(spec: DocSpec): ManualSection[] {
  const keys = keysOf(spec);
  const money = Boolean(spec.charges) || keys.some((k) => MONEY_KEYS.includes(k));
  return [
    { title: "Document", fields: money ? [REFERENCE, CURRENCY] : [REFERENCE] },
    ...SECTION_ORDER.map((section) => ({
      title: SECTION_TITLE[section],
      fields: keys
        .filter((k) => FIELDS[k].section === section)
        .map(
          (k): ManualField => ({
            key: k,
            label: labelOf(k),
            input: FIELDS[k].input,
            options: optionsFor(k),
            required: spec.requires.includes(k),
            placeholder: FIELDS[k].placeholder,
            hint: FIELDS[k].hint,
            wide: FIELDS[k].wide,
          })
        ),
    })).filter((s) => s.fields.length > 0),
    ...(spec.charges ? [CHARGES_SECTION, EXCHANGE_SECTION] : []),
  ];
}

/** "12-Oct-2026", from the date picker's 2026-10-12, read as that day wherever the browser is. */
const printedDate = (iso: string) => (iso ? docDate(`${iso}T00:00:00`) : "");

export const MANUAL_SOURCE_NOTE = "Entered by hand on the Manual documents page, not drawn from a job record.";

/** Who printed it, put in by the page as it prints (the reference line at a closed document's foot). */
export const PREPARED_BY = "prepared_by";

/**
 * What was typed, as the one shape every registry document draws from.
 *
 * Text is trimmed and an empty field is undefined, so it prints TBD and counts
 * as outstanding; a number that does not read as one is undefined too, rather
 * than its leading digits. Dates print the way the letterhead dates them.
 */
export function documentDataFromManual(v: ManualValues): DocumentData {
  const out: Partial<Record<DataKey, string | number | boolean>> = {};
  for (const key of FIELD_ORDER) {
    const t = text(v, key);
    if (!t) continue;
    const input = FIELDS[key].input;
    const value = input === "number" ? parseNumber(t) : input === "yesno" ? parseYesNo(t) : input === "date" ? printedDate(t) : t;
    if (value !== undefined && value !== "") out[key] = value;
  }
  const data = out as Partial<DocumentData>;
  const reference = text(v, "reference");
  return {
    ...data,
    // Typed under Invoice particulars before it was a field of the job's own.
    jobDate: data.jobDate ?? (printedDate(text(v, "job_date")) || undefined),
    preparedBy: text(v, PREPARED_BY) || undefined,
    reference: reference || "TBD",
    // Numbered as a job's are: by the B/L once there is one, the reference until then.
    documentNumber: data.blNumber || reference || "TBD",
    sourceNote: MANUAL_SOURCE_NOTE,
    billTo: text(v, "bill_to") === "shipper" ? "shipper" : text(v, "bill_to") === "notify" ? "notify" : "consignee",
    // Dollars unless rupees were chosen: what the page has always typed in.
    currency: text(v, "currency") === "INR" ? "INR" : "USD",
    charges: chargesOf(v),
    exchangeRates: exchangeRatesOf(v),
    invoice: invoiceExtrasOf(v),
    raw: {} as DocumentData["raw"],
  };
}

/** What the desk also calls them. */
const ALIAS: Record<string, string> = {
  "booking-confirmation": "BKG",
  "shipping-instructions": "SI",
  "vgm-declaration": "VGM",
  "bl-draft": "B/L",
  "bl-final": "B/L",
  fcr: "FCR",
  "arrival-notice": "CAN",
  "delivery-order": "DO",
  "commercial-invoice": "CI / PL",
  "proof-of-delivery": "POD",
};

// ---------------------------------------------------------------------------
// The tax invoice, and its proforma (lib/documents/invoice)
// ---------------------------------------------------------------------------

/** The freight invoice printed as a proforma: the estimate, before the tax invoice. */
export const isProforma = (v: ManualValues) => text(v, "invoice_kind") === "proforma";

/** Who the invoice is addressed to: one of the three parties, whose name, address and GSTIN make its Billed to box. */
const BILL_TO: ManualField = {
  key: "bill_to",
  label: "Bill to",
  input: "segmented",
  options: [
    { value: "consignee", label: "Consignee" },
    { value: "shipper", label: "Shipper" },
    { value: "notify", label: "Notify party" },
  ],
  hint: "Its name, address and GSTIN, typed under Parties, are what the invoice is addressed to.",
  wide: true,
};

const INVOICE_KIND: ManualField = {
  key: "invoice_kind",
  label: "Print as",
  input: "segmented",
  options: [
    { value: "freight", label: "Tax invoice" },
    { value: "proforma", label: "Proforma invoice" },
  ],
  hint: "A proforma goes out first, for approval or an advance: the same charges and tax, numbered PI- and marked as not a tax invoice.",
  wide: true,
};

/**
 * What a tax invoice prints besides the shipment's details, as the line's
 * e-invoice (QDWJ26093202) has them: which copy, its dates, the customer's
 * code and PAN, the IRN, the references, a note, our own registrations.
 */
const INVOICE_PARTICULARS: ManualSection = {
  title: "Invoice particulars",
  note: "Each prints where the e-invoice has it, and is left off while empty. The tax invoice is numbered for you, ALG/26-27/0001 on across every shipment, the first time it is printed complete with its B/L number; printed again, here or on the shipment, it keeps that number.",
  fields: [
    {
      key: "copy",
      label: "Copy",
      input: "select",
      options: [
        { value: "", label: "Original" },
        { value: "duplicate", label: "Duplicate" },
        { value: "triplicate", label: "Triplicate" },
      ],
      hint: "Printed at the head of the tax invoice.",
    },
    { key: "invoice_date", label: "Invoice date", input: "date", hint: "Left empty, the day it is printed." },
    { key: "due_date", label: "Payment due date", input: "date" },
    { key: "customer_code", label: "Customer code", placeholder: "1103010005" },
    { key: "customer_pan", label: "Customer PAN", placeholder: "ABDCA2229C", hint: "Read from the GSTIN of the party billed when left empty." },
    { key: "irn", label: "IRN", hint: "The Invoice Reference Number the e-invoice portal gives it, as given.", wide: true },
    { key: "advance_receipt", label: "Advance receipt no" },
    { key: "shipper_ref", label: "Shipper ref no" },
    { key: "vehicle_no", label: "Vehicle no" },
    { key: "note", label: "Note", input: "textarea", wide: true },
    { key: "our_tan", label: "Our TAN", hint: "Printed beside our PAN and GSTIN." },
    { key: "our_lut", label: "Our LUT no", hint: "For services exported without IGST; beside our PAN and GSTIN." },
    { key: "our_msme", label: "Our MSME (Udyam) no", hint: "Printed beside our PAN and GSTIN." },
  ],
};

/** "26-27": the Indian financial year, April to March, a day (YYYY-MM-DD) falls in. */
export function financialYear(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const start = Number(iso.slice(5, 7)) >= 4 ? year : year - 1;
  const yy = (n: number) => String(n % 100).padStart(2, "0");
  return `${yy(start)}-${yy(start + 1)}`;
}

/** Where the page keeps the tax invoice's number, and the B/L it was given for. */
const NUMBER_KEY = "invoice_number";
const NUMBER_BL_KEY = "invoice_number_bl";

/**
 * The tax invoice's number, ALG/26-27/0004, as the database gave it (141) —
 * while it is still the B/L it was given for: the B/L typed over, it is the
 * other B/L's number, and this invoice has none until it is printed again.
 */
function invoiceNumberOf(v: ManualValues): string | undefined {
  const bl = text(v, "blNumber");
  return bl && text(v, NUMBER_BL_KEY) === normaliseBl(bl) ? text(v, NUMBER_KEY) || undefined : undefined;
}

/** What was typed under Invoice particulars, as the tax invoice prints it; an empty field is left out. */
function invoiceExtrasOf(v: ManualValues): InvoiceExtras {
  const typed = (key: string) => text(v, key) || undefined;
  const dated = (key: string) => printedDate(text(v, key)) || undefined;
  return {
    number: invoiceNumberOf(v),
    copy: (text(v, "copy") || "original").toUpperCase(),
    customerCode: typed("customer_code"),
    customerPan: typed("customer_pan")?.toUpperCase(),
    irn: typed("irn"),
    invoiceDate: dated("invoice_date"),
    dueDate: dated("due_date"),
    advanceReceipt: typed("advance_receipt"),
    shipperRef: typed("shipper_ref"),
    vehicleNo: typed("vehicle_no"),
    note: typed("note"),
    tan: typed("our_tan"),
    lut: typed("our_lut"),
    msme: typed("our_msme"),
  };
}

/**
 * The tax invoice, or its proforma: one form, one set of details.
 *
 * A proforma goes out first for approval or an advance, and the tax invoice
 * that follows is the same charges; both print as the shipment's Documents
 * tab prints them (lib/documents/invoice). The tax invoice takes its number
 * from the series as it is printed (`numbering`). Kept as the freight invoice
 * ("freight-invoice"), the page's name for it before it was the tax invoice.
 */
function freightInvoiceDoc(): FormDoc {
  const specOf = (v: ManualValues) => (isProforma(v) ? PROFORMA_INVOICE : TAX_INVOICE);
  const dataOf = documentDataFromManual;
  const sections = sectionsFor(TAX_INVOICE);
  sections[0] = { ...sections[0], fields: [INVOICE_KIND, BILL_TO, ...(sections[0].fields ?? [])] };
  sections.splice(1, 0, INVOICE_PARTICULARS);
  return {
    id: "freight-invoice",
    shortName: "Tax invoice",
    // The desk has called it the freight invoice: a search for that still finds it.
    alias: "TI / PI · freight invoice",
    purpose: "What the customer owes us for the forwarding service: as a tax invoice, or first as a proforma.",
    group: "shipment",
    store: "shipment",
    editor: "form",
    stampsDraft: true,
    sections,
    render: (v) => renderDocument(specOf(v), dataOf(v)),
    // ALG/26-27/0004 saves as ALG-26-27-0004-tax-invoice.pdf; one not yet numbered, by its job.
    fileName: (v) => documentFilename(specOf(v), dataOf(v)),
    // Not its number, while it has a B/L to be numbered by: it is given one as it is printed.
    missing: (v) => outstanding(specOf(v), dataOf(v), readiness(dataOf(v), TAX_INVOICE.requires, specOf(v).check).missingLabels),
    documentNo: (v) => {
      const d = dataOf(v);
      if (!isProforma(v) && readyToNumber(d)) return `ALG/${financialYear(text(v, "invoice_date") || todayIst())}/ the next in the series`;
      return documentNo(specOf(v), d);
    },
    numbering: (v) => {
      const bl = text(v, "blNumber");
      if (isProforma(v) || !bl) return undefined;
      return {
        bl,
        date: text(v, "invoice_date") || todayIst(),
        take: readyToNumber(dataOf(v)),
        apply: (number) => ({ ...v, [NUMBER_KEY]: number ?? "", [NUMBER_BL_KEY]: number ? normaliseBl(bl) : "" }),
      };
    },
  };
}

const fromRegistry = (spec: DocSpec): FormDoc => spec.id === TAX_INVOICE.id ? freightInvoiceDoc() : ({
  id: spec.id,
  // The arrival notice is the import desk's CAN: named as they name it.
  shortName: spec.id === "arrival-notice" ? "Cargo arrival notice" : spec.shortName,
  alias: ALIAS[spec.id],
  purpose: spec.purpose,
  group: "shipment",
  store: "shipment",
  editor: "form",
  stampsDraft: true,
  sections: sectionsFor(spec),
  render: (v) => renderDocument(spec, documentDataFromManual(v)),
  fileName: (v) => documentFilename(spec, documentDataFromManual(v)),
  missing: (v) => readiness(documentDataFromManual(v), spec.requires, spec.check).missingLabels,
  documentNo: (v) => documentNo(spec, documentDataFromManual(v)),
});

// ---------------------------------------------------------------------------
// The house bills, in their own forms
// ---------------------------------------------------------------------------

export interface ManualHbl {
  data: HblData;
  hblNo: string;
  release: ReleaseMode;
  originals: number;
  print: HblPrint;
}

export interface ManualHawb {
  data: HawbData;
  hawbNo: string;
  /** YYYY-MM-DD */
  hawbDate: string;
  kind: "draft" | "original";
}

interface BillDoc {
  id: string;
  shortName: string;
  alias?: string;
  purpose: string;
  group: ManualGroup;
  /** An original is printed as one whatever is missing; the page warns rather than stamps. */
  stampsDraft: false;
}
export interface HblDoc extends BillDoc {
  editor: "hbl";
  store: "hbl";
}
export interface HawbDoc extends BillDoc {
  editor: "hawb";
  store: "hawb";
}

export type ManualDoc = FormDoc | HblDoc | HawbDoc;

const HBL_DOC: HblDoc = {
  id: "house-bl",
  shortName: "House bill of lading",
  alias: "HBL",
  purpose: "Our house B/L, box for box: as a draft for approval, a copy, or the originals.",
  group: "bills",
  store: "hbl",
  editor: "hbl",
  stampsDraft: false,
};

const HAWB_DOC: HawbDoc = {
  id: "house-awb",
  shortName: "House air waybill",
  alias: "HAWB",
  purpose: "Our house air waybill on the IATA layout, with its rate lines and charges.",
  group: "bills",
  store: "hawb",
  editor: "hawb",
  stampsDraft: false,
};

// ---------------------------------------------------------------------------
// The page's state, and what each document makes of it
// ---------------------------------------------------------------------------

export interface ManualState {
  shipment: ManualValues;
  console: ManualValues;
  hbl: ManualHbl;
  hawb: ManualHawb;
}

/** Today in India, as the date picker writes it. */
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function emptyStore<K extends ManualStore>(store: K): ManualState[K] {
  const fresh: { [S in ManualStore]: () => ManualState[S] } = {
    // Billed to the notify party, the forwarder at the other end, until another is chosen: who the desk usually invoices.
    shipment: () => ({ currency: "USD", invoice_kind: "freight", bill_to: "notify" }),
    console: () => ({ freight_terms: "prepaid" }),
    hbl: () => ({ data: emptyHbl(), hblNo: "", release: "original", originals: 3, print: "draft" }),
    hawb: () => ({ data: { ...emptyHawb(), currency: "USD" }, hawbNo: "", hawbDate: todayIst(), kind: "draft" }),
  };
  return fresh[store]();
}

export const emptyState = (): ManualState => ({
  shipment: emptyStore("shipment"),
  console: emptyStore("console"),
  hbl: emptyStore("hbl"),
  hawb: emptyStore("hawb"),
});

/** The PDF, and the name it saves under. */
export function pdfOf(doc: ManualDoc, s: ManualState): { pdf: jsPDF; name: string } {
  if (doc.editor === "hbl") {
    const input = { data: s.hbl.data, hblNo: s.hbl.hblNo.trim() || null, release: s.hbl.release, originals: s.hbl.originals, print: s.hbl.print };
    return { pdf: renderHblPdf(input), name: hblFileName(input) };
  }
  if (doc.editor === "hawb") {
    const input = { data: s.hawb.data, hawbNo: s.hawb.hawbNo.trim() || null, hawbDate: s.hawb.hawbDate || null, kind: s.hawb.kind };
    return { pdf: renderHawbPdf(input), name: hawbFileName(input) };
  }
  const v = s[doc.store as "shipment" | "console"];
  return { pdf: doc.render(v), name: doc.fileName(v) };
}

/**
 * What it still needs, by name.
 *
 * For a shipment document, exactly what its PDF will list as outstanding. For
 * a house bill, what an original cannot be issued without — a draft or a copy
 * needs nothing, being for checking. For a console document, its own fields.
 */
export function missingOf(doc: ManualDoc, s: ManualState): string[] {
  if (doc.editor === "hbl") {
    if (s.hbl.print !== "original") return [];
    return [...(s.hbl.hblNo.trim() ? [] : ["the B/L number"]), ...missingForIssue(s.hbl.data, s.hbl.release, s.hbl.originals)];
  }
  if (doc.editor === "hawb") {
    if (s.hawb.kind !== "original") return [];
    return [...(s.hawb.hawbNo.trim() ? [] : ["HAWB number"]), ...missingForOriginal(s.hawb.data)];
  }
  return doc.missing(s[doc.store as "shipment" | "console"]);
}

/**
 * Everything that can be typed in, in the order of a shipment's life: the
 * shipment's own papers as the registry orders them, then its bills, then the
 * console's.
 *
 * The quotation in the list is the registry's single-figure one. The rate
 * sheet with its charge lines is issued from the enquiry, where it goes
 * through approval and the customer's Accept button; a way to print one with
 * neither would be a way round both.
 */
// The proforma is the tax invoice's form printed as one ("Print as"), not a document of its own here.
export const MANUAL_DOCUMENTS: ManualDoc[] = [
  ...DOCUMENTS.filter((d) => d.id !== PROFORMA_INVOICE.id).map(fromRegistry),
  HBL_DOC,
  HAWB_DOC,
  ...CONSOLE_DOCUMENTS,
];

export const manualDocument = (id: string | null | undefined) => MANUAL_DOCUMENTS.find((d) => d.id === id);

/** Whether a document answers to what was typed in the search: its name, what it is also called, what it is for. */
export function matches(doc: ManualDoc, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [doc.shortName, doc.alias ?? "", doc.purpose].some((s) => s.toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Kept by B/L number (139, services/manualDocuments)
// ---------------------------------------------------------------------------

/** A B/L number written one way, whoever typed it — as the database writes it (139's trigger). */
export const normaliseBl = (bl: string) => bl.replace(/\s+/g, " ").trim().toUpperCase();

/** The number a document is kept under: its house B/L (or HAWB) number, or a console's master B/L. */
export function blOf(doc: ManualDoc, s: ManualState): string {
  if (doc.editor === "hbl") return s.hbl.hblNo.trim();
  if (doc.editor === "hawb") return s.hawb.hawbNo.trim();
  return text(s[doc.store as "shipment" | "console"], doc.store === "console" ? "mbl_number" : "blNumber");
}

/** Where that number is typed on the form, for the page to point at. */
export function blFieldOf(doc: ManualDoc): string {
  if (doc.editor === "hbl") return "House B/L number";
  if (doc.editor === "hawb") return "HAWB number";
  return doc.store === "console" ? "Master B/L number" : "B/L number";
}

/** Which paper it is, kept: the freight invoice's two forms are two papers. */
export const savedKeyOf = (doc: ManualDoc, s: ManualState) => (doc.id === "freight-invoice" && isProforma(s.shipment) ? "proforma-invoice" : doc.id);

/** Its name and printed number, for the list of what is kept. */
export function savedLabelOf(doc: ManualDoc, s: ManualState): { title: string; documentNo: string } {
  if (doc.editor === "hbl") return { title: doc.shortName, documentNo: s.hbl.hblNo.trim() };
  if (doc.editor === "hawb") return { title: doc.shortName, documentNo: s.hawb.hawbNo.trim() };
  const v = s[doc.store as "shipment" | "console"];
  return { title: savedKeyOf(doc, s) === "proforma-invoice" ? "Proforma invoice" : doc.shortName, documentNo: doc.documentNo?.(v) ?? "" };
}

/** What is kept for it: the details the document reads, as the page holds them. */
export const savedValuesOf = (doc: ManualDoc, s: ManualState) => s[doc.store] as unknown as Record<string, unknown>;

/** The page's own entry for a kept document. */
export const documentForKey = (key: string) => manualDocument(key === "proforma-invoice" ? "freight-invoice" : key);

/**
 * The page with a kept document's details put back into its form, the other
 * forms as they were. Merged over a fresh form, as the page restores a tab,
 * so a field added since it was kept exists blank instead of undefined.
 */
export function withSaved(s: ManualState, store: ManualStore, values: Record<string, unknown>): ManualState {
  if (store === "hbl") {
    const v = values as Partial<ManualHbl>;
    return { ...s, hbl: { ...emptyStore("hbl"), ...v, data: normaliseHbl(v.data) } };
  }
  if (store === "hawb") {
    const v = values as Partial<ManualHawb>;
    return { ...s, hawb: { ...emptyStore("hawb"), ...v, data: normaliseHawb(v.data) } };
  }
  return { ...s, [store]: { ...emptyStore(store), ...(values as ManualValues) } };
}
