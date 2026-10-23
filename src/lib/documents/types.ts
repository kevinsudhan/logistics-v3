/**
 * One flattened shape every document draws from, and the spec language they are declared in.
 *
 * The alternative — a bespoke generator per document — was rejected after the first one.
 * Twelve hand-written jsPDF functions would each need their own letterhead, their own TBD
 * handling, their own readiness check and their own footer, and they would drift apart
 * within a week. Here a document is a declaration: which fields it cannot be issued
 * without, and which rows it prints. The renderer is written once.
 */
import type { RequestDetails } from "../../data/requestFields";
import type { ReleaseMode } from "../hbl";

/**
 * Everything any document might print, sourced from the extracted call fields and the
 * customer record. Optional throughout: a field nobody has established yet prints as TBD
 * and, when the document requires it, is named in the outstanding list.
 */
export interface DocumentData {
  // identity
  /** The job's own reference, ALG09004-26: what the desk and the customer call it. */
  reference: string;
  /** What the document is numbered by: the B/L number once there is one, the reference until then. */
  documentNumber: string;
  blNumber?: string;
  /** The carrier's master bill the house bill sits under, where there is one (082). */
  masterBlNumber?: string;
  // The dates of the two bills, the carrier's booking and the service, as an
  // import desk's cargo arrival notice prints them. Like the arrival fields
  // below, typed on the Manual documents page; no booking supplies them.
  blDate?: string;
  masterBlDate?: string;
  bookingNumber?: string;
  /** FCL, LCL. */
  serviceType?: string;
  /** The free days granted per box, in words (083): "14 days demurrage, 7 days detention". */
  freeTimeText?: string;

  // parties
  shipperName?: string;
  shipperAddress?: string;
  shipperGstinIec?: string;
  consigneeName?: string;
  consigneeAddress?: string;
  consigneeCountry?: string;
  consigneeGstin?: string;
  /** Who the notice also goes to on an import: the consignee's customs broker (CHA). */
  notifyName?: string;
  notifyAddress?: string;
  notifyGstin?: string;

  // contact
  customerName?: string;
  company?: string;
  phone?: string;

  // route & carriage
  origin?: string;
  destination?: string;
  carrier?: string;
  containerType?: string;
  containerId?: string;
  sailingDate?: string;
  etaDate?: string;
  /** Where the cargo ends up when that is beyond the port of discharge, and when. */
  finalDestination?: string;
  finalEtaDate?: string;

  // arrival, for the cargo arrival notice and the delivery order. Typed on the
  // Manual documents page; no booking supplies them, so a job's own documents
  // print exactly what they did before these existed.
  vessel?: string;
  voyage?: string;
  portOfLoading?: string;
  igmNumber?: string;
  igmDate?: string;
  /** The line and sub-line on the IGM the Bill of Entry is filed against. */
  igmItemNo?: string;
  igmSubItemNo?: string;
  /** The CFS or terminal the cargo is delivered from. */
  cfsName?: string;
  cfsAddress?: string;
  /** How the house bill is released: what the consignee needs to take delivery. */
  releaseMode?: ReleaseMode;
  freightTerms?: "Prepaid" | "Collect";

  // cargo
  marksNumbers?: string;
  sealNumber?: string;
  cargoDescription?: string;
  cargoType?: string;
  hsCode?: string;
  pieceCount?: number;
  pieceDimensions?: string;
  packageCount?: number;
  packageType?: string;
  netWeightKg?: number;
  grossWeightKg?: number;
  volumeCbm?: number;
  stackable?: boolean;
  uprightOnly?: boolean;

  // commercial
  invoiceValueInr?: number;
  freightAmountInr?: number;
  targetPriceInr?: number;
  incoterm?: string;
  paymentTerms?: string;
  letterOfCredit?: boolean;
  /** References the customer quotes back: their order, our invoice, the salesperson's. */
  poNumber?: string;
  invoiceRef?: string;
  salesRef?: string;

  // special handling
  temperatureSetpointC?: number;
  preCoolingRequired?: boolean;
  woodPackagingUsed?: boolean;
  msdsProvided?: boolean;
  unPackagingSpec?: string;
  carrierDgApproval?: string;

  // recorded by a person at the time, never derived from a record: how the box
  // was weighed for the VGM, and who took delivery for the POD. A job's own
  // documents leave them TBD, to be completed by hand; the Manual documents
  // page is where somebody holding the weighbridge slip or the signed POD types
  // them in.
  vgmMethod?: string;
  vgmFacility?: string;
  vgmWeighedOn?: string;
  deliveredOn?: string;
  receivedBy?: string;

  // provenance
  sourceNote: string;
  /** What the money fields are in: rupees unless said. A manual document says which. */
  currency?: "INR" | "USD";
  /** The charges, line by line, where they were itemised (a manual freight invoice); otherwise the one freight figure. */
  charges?: ChargeLine[];
  /** Rupees to one unit of each foreign currency the charges are in ("USD" -> 83.5): what they are converted at. */
  exchangeRates?: Record<string, number>;
  /** Which of the parties an invoice is addressed to: its To block is theirs. */
  billTo?: "shipper" | "consignee" | "notify";
  raw: RequestDetails;
}

/** One line of an itemised invoice: its rate in its own currency, converted to rupees for the totals. */
export interface ChargeLine {
  charge: string;
  sac?: string;
  /** What the quantity counts: Container, W/M, B/L, Kg. */
  basis?: string;
  quantity?: number;
  /** What the rate is in: "INR" when not said. */
  currency?: string;
  rate?: number;
  /** GST on the line, as a percentage; none when not given. */
  gstPercent?: number;
}

/** Keys of DocumentData that a document can declare itself unable to be issued without. */
export type DataKey = keyof Omit<DocumentData, "reference" | "documentNumber" | "sourceNote" | "currency" | "charges" | "exchangeRates" | "billTo" | "raw">;

export interface DocRow {
  label: string;
  /** Rendered value, or undefined when not established — the renderer prints TBD. */
  value: (d: DocumentData) => string | undefined;
  /**
   * Left out, rather than printed as TBD, when there is no value: for a fact
   * only some jobs have. A direct job has no master bill apart from its own,
   * and "Master B/L: TBD" would tell the consignee something is missing.
   */
  optional?: boolean;
  /** In a party box (a section placed "left"): the value alone, without its label — a name, an address. */
  bare?: boolean;
  /** In the details grid (placed "right"): the whole width rather than half — an address, a vessel. */
  wide?: boolean;
  /** As a column of a table (placed "table"): its share of the width, and figures to the right. */
  width?: number;
  align?: "right";
  /** In an invoice's columns: its first line in bold — a party's name over its address, the invoice's number. */
  bold?: boolean;
}

export interface DocSection {
  title: string;
  rows: DocRow[];
  /**
   * Where a section of a split document (`layout: "split"`) is drawn: a party
   * box down the left, the details grid on the right, or a table across the
   * page under both. An invoice's (`layout: "invoice"`) left and right are
   * its two columns of particulars, label and value, without boxes. Without
   * it, as a band across the page, as everywhere else.
   */
  place?: "left" | "right" | "table";
  /** In the band layout: the rows two to a line, label and value each — a block of short particulars, kept compact. */
  columns?: 2;
}

/**
 * Who actually issues the document.
 *
 * The distinction is not cosmetic. An `araxys` document is one the forwarder can put its
 * name to today; an `authority` document is issued by customs, a chamber of commerce or a
 * quarantine office, and what we produce is an application or a filing record. Printing
 * the second kind as though it were the first would be a forgery, so the renderer labels
 * them differently and refuses to imply the authority has signed anything.
 */
/**
 * Who puts their name to the document.
 *
 * "desk" is this forwarder — the value used to read "araxys", which is the
 * vendor that built the CRM and never issues anybody's bill of lading.
 * "authority" is a carrier, a customs office or a weighbridge, whose documents
 * this system reproduces but does not sign.
 */
export type Issuer = "desk" | "authority";

export interface DocSpec {
  id: string;
  /** Printed at the top of the document. */
  title: string;
  /** Short label for the UI list. */
  shortName: string;
  /** One line explaining what the document is for, shown in the UI. */
  purpose: string;
  issuer: Issuer;
  /** Prefix for the generated document number, e.g. QUO -> QUO-ALG09004-26 (see documentNo). */
  numberPrefix: string;
  /** Fields the document cannot honestly be issued without. */
  requires: DataKey[];
  /** Whether to draw the shipper/consignee block. */
  parties: boolean;
  sections: DocSection[];
  /** Fixed text printed above the signature line. */
  declaration?: string;
  /**
   * Drawn in two columns — the parties down the left, the details on the
   * right, the cargo as a table across — the way a cargo arrival notice is
   * laid out, rather than as bands. Its sections say where each goes.
   *
   * "invoice" is laid out as a GST invoice to the trade, without boxes: the
   * parties and the route down the left and the invoice's and the shipment's
   * particulars down the right, label and value; the charges ruled, with the
   * tax on each line; the tax by SAC; the terms; our bank details beside the
   * signature.
   */
  layout?: "split" | "invoice";
  /** An invoice's terms, numbered under the tax summary. */
  terms?: string[];
  /**
   * Printed under the sections, worked out from the record: a sentence, then a
   * list headed by `title` — what the consignee needs to do.
   */
  notes?: { title: string; lead?: (d: DocumentData) => string | undefined; lines: (d: DocumentData) => string[] };
  /**
   * Drawn after the sections as a table with totals, under this heading, when
   * the record itemises its charges. An invoice's table goes without one.
   */
  charges?: { title: string };
  /**
   * What it still needs that a list of fields cannot say — a rate on every
   * charge line, say — by label, added to what `requires` finds missing.
   */
  check?: (d: DocumentData) => string[];
}
