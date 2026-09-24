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

  // parties
  shipperName?: string;
  shipperGstinIec?: string;
  consigneeName?: string;
  consigneeAddress?: string;
  consigneeCountry?: string;

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

  // cargo
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

  // special handling
  temperatureSetpointC?: number;
  preCoolingRequired?: boolean;
  woodPackagingUsed?: boolean;
  msdsProvided?: boolean;
  unPackagingSpec?: string;
  carrierDgApproval?: string;

  // provenance
  sourceNote: string;
  raw: RequestDetails;
}

/** Keys of DocumentData that a document can declare itself unable to be issued without. */
export type DataKey = keyof Omit<DocumentData, "reference" | "documentNumber" | "sourceNote" | "raw">;

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
}

export interface DocSection {
  title: string;
  rows: DocRow[];
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
}
