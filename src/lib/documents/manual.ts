import type { jsPDF } from "jspdf";
import { fieldDef } from "../../data/requestFields";
import { emptyHbl, missingForIssue, type HblData, type ReleaseMode } from "../hbl";
import { emptyHawb, missingForOriginal, type HawbData } from "../hawb";
import { DOCUMENTS } from "./registry";
import { documentFilename, documentNo, labelFor, readiness } from "./data";
import { renderDocument } from "./render";
import { docDate } from "./letterhead";
import { hblFileName, renderHblPdf, type HblPrint } from "./hblPdf";
import { hawbFileName, renderHawbPdf } from "./hawbPdf";
import { CONSOLE_DOCUMENTS } from "./manualConsole";
import {
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
import type { DataKey, DocSpec, DocumentData } from "./types";

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
  parties: "Shipper and consignee",
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

/**
 * Every field a registry document can print, and how it is typed.
 *
 * A `Record` over DataKey, so a field added to DocumentData does not compile
 * until it says how a person types it. The order is the order on the form.
 */
const FIELDS: Record<DataKey, FieldMeta> = {
  blNumber: { section: "bills", placeholder: "HBL/26-27/0001" },
  masterBlNumber: { section: "bills", hint: "The carrier's bill the house bill sits under, where it differs." },

  shipperName: { section: "parties" },
  shipperGstinIec: { section: "parties" },
  consigneeName: { section: "parties" },
  consigneeAddress: { section: "parties", input: "textarea", wide: true },
  consigneeCountry: { section: "parties" },

  company: { section: "customer" },
  customerName: { section: "customer" },
  phone: { section: "customer" },

  origin: { section: "route", placeholder: "CHENNAI" },
  destination: { section: "route", placeholder: "JEBEL ALI" },
  carrier: { section: "route" },
  containerType: { section: "route", placeholder: "40HC" },
  containerId: { section: "route", placeholder: "PCIU1234567" },
  sailingDate: { section: "route", input: "date" },
  etaDate: { section: "route", input: "date" },

  vessel: { section: "arrival" },
  voyage: { section: "arrival" },
  portOfLoading: { section: "arrival" },
  igmNumber: { section: "arrival" },
  igmDate: { section: "arrival", input: "date" },
  cfsName: { section: "arrival" },
  freeTimeText: { section: "arrival", placeholder: "14 days demurrage, 7 days detention" },

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

  freightAmountInr: { section: "commercial", input: "number", unit: "Rs." },
  targetPriceInr: { section: "commercial", input: "number", unit: "Rs." },
  invoiceValueInr: { section: "commercial", input: "number", unit: "Rs." },
  incoterm: { section: "commercial", input: "select" },
  paymentTerms: { section: "commercial", placeholder: "Advance, 30 days, against documents" },
  letterOfCredit: { section: "commercial", input: "yesno" },

  temperatureSetpointC: { section: "handling", input: "number", unit: "°C" },
  preCoolingRequired: { section: "handling", input: "yesno" },
  woodPackagingUsed: { section: "handling", input: "yesno" },
  msdsProvided: { section: "handling", input: "yesno" },
  unPackagingSpec: { section: "handling" },
  carrierDgApproval: { section: "handling" },

  vgmMethod: { section: "weighing", input: "select" },
  vgmFacility: { section: "weighing" },
  vgmWeighedOn: { section: "weighing", input: "date" },

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
    for (const section of spec.sections) {
      for (const row of section.rows) {
        try {
          row.value(probe);
        } catch {
          // A row that cannot take a stand-in value still read what it read.
        }
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

/** The form for one registry document: its fields, in sections, required ones marked. */
export function sectionsFor(spec: DocSpec): ManualSection[] {
  const keys = keysOf(spec);
  return [
    { title: "Document", fields: [REFERENCE] },
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
  ];
}

/** "12-Oct-2026", from the date picker's 2026-10-12, read as that day wherever the browser is. */
const printedDate = (iso: string) => (iso ? docDate(`${iso}T00:00:00`) : "");

export const MANUAL_SOURCE_NOTE = "Entered by hand on the Manual documents page, not drawn from a job record.";

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
    reference: reference || "TBD",
    // Numbered as a job's are: by the B/L once there is one, the reference until then.
    documentNumber: data.blNumber || reference || "TBD",
    sourceNote: MANUAL_SOURCE_NOTE,
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

const fromRegistry = (spec: DocSpec): FormDoc => ({
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
  missing: (v) => readiness(documentDataFromManual(v), spec.requires).missingLabels,
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
    shipment: () => ({}),
    console: () => ({ freight_terms: "prepaid" }),
    hbl: () => ({ data: emptyHbl(), hblNo: "", release: "original", originals: 3, print: "draft" }),
    hawb: () => ({ data: emptyHawb(), hawbNo: "", hawbDate: todayIst(), kind: "draft" }),
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
export const MANUAL_DOCUMENTS: ManualDoc[] = [...DOCUMENTS.map(fromRegistry), HBL_DOC, HAWB_DOC, ...CONSOLE_DOCUMENTS];

export const manualDocument = (id: string | null | undefined) => MANUAL_DOCUMENTS.find((d) => d.id === id);

/** Whether a document answers to what was typed in the search: its name, what it is also called, what it is for. */
export function matches(doc: ManualDoc, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [doc.shortName, doc.alias ?? "", doc.purpose].some((s) => s.toLowerCase().includes(q));
}
