import type { Shipment } from "../../types";
import type { RealRecord } from "../../services/backend";
import { fieldDef, type RequestDetails } from "../../data/requestFields";
import type { DataKey, DocumentData } from "./types";
import { appliesTo, termsText, type FreeTimeTerms } from "../freeTime";

/**
 * Builds the one shape every document draws from.
 *
 * NO FALLBACKS ON A FIELD ANY DOCUMENT REQUIRES. A booking-stage value must never stand
 * in for a documentation one, however interchangeable they look — substituting the
 * trading name for the shipper's legal name, or the piece count for the package count,
 * produces a document that prints a value for a field it also lists as outstanding, and
 * a reader cannot tell which half to believe. Booking values fill only the fields no
 * document requires.
 */

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Human labels for the outstanding list. Catalogue fields keep the catalogue's wording. */
const LOCAL_LABELS: Partial<Record<DataKey, string>> = {
  blNumber: "Bill of lading number",
  customerName: "Contact name",
  company: "Company",
  phone: "Phone",
  carrier: "Carrier",
  containerId: "Container number",
  etaDate: "ETA date",
  pieceDimensions: "Piece dimensions",
  freightAmountInr: "Agreed freight rate",
  cargoType: "Cargo type",
  containerType: "Container type",
  sailingDate: "Sailing date",
  origin: "Origin",
  destination: "Destination",
  cargoDescription: "Cargo description",
  pieceCount: "Number of pieces",
  volumeCbm: "Volume",
  stackable: "Stackable",
  uprightOnly: "Must stay upright",
  targetPriceInr: "Target price",
};

/**
 * The catalogue owns the wording wherever a document field maps to a collected one, so
 * the label on an invoice matches the label on the CRM grid the desk is reading from.
 */
const CATALOGUE_KEY: Partial<Record<DataKey, string>> = {
  shipperName: "shipper_legal_name",
  shipperGstinIec: "shipper_gstin_iec",
  consigneeName: "consignee_name",
  consigneeAddress: "consignee_address",
  consigneeCountry: "consignee_country",
  hsCode: "hs_code",
  invoiceValueInr: "invoice_value_inr",
  packageCount: "package_count",
  packageType: "package_type",
  netWeightKg: "net_weight_kg",
  grossWeightKg: "gross_weight_kg",
  incoterm: "incoterm",
  paymentTerms: "payment_terms",
  letterOfCredit: "letter_of_credit",
  temperatureSetpointC: "temperature_setpoint_c",
  preCoolingRequired: "pre_cooling_required",
  woodPackagingUsed: "wood_packaging_used",
  msdsProvided: "msds_provided",
  unPackagingSpec: "un_packaging_spec",
  carrierDgApproval: "carrier_dg_approval",
};

export function labelFor(key: DataKey): string {
  const catKey = CATALOGUE_KEY[key];
  if (catKey) {
    const def = fieldDef(catKey);
    if (def) return def.label;
  }
  return LOCAL_LABELS[key] ?? key;
}

/** Dimensions read as a single line on a document, not three rows. */
function dimensions(d: RequestDetails): string | undefined {
  const l = num(d.piece_length_cm);
  const w = num(d.piece_width_cm);
  const h = num(d.piece_height_cm);
  return l && w && h ? `${l} x ${w} x ${h} cm` : undefined;
}

/**
 * An enquiry, before anything is booked.
 *
 * ---------------------------------------------------------------------------
 * WHY AN ENQUIRY CAN ISSUE A DOCUMENT AT ALL
 *
 * One of them: the quotation. It is the rate offered to the customer, and it is
 * produced before a booking exists by definition — a customer accepts a
 * quotation and that acceptance is what creates the booking.
 *
 * Everything after it needs particulars an enquiry does not have, so the rest
 * of the list sits there as drafts naming what they are waiting for. That is
 * useful rather than noise: it is the desk's checklist of what still has to be
 * agreed before this shipment can move.
 *
 * WHERE THE RATE COMES FROM
 *
 * The quote the desk has issued, passed in — not a partner's rate. Those are
 * buying prices and putting one on a customer's quotation would send the agent's
 * cost to the shipper. The two are deliberately not interchangeable and this
 * function takes only the selling figure.
 * ---------------------------------------------------------------------------
 */
export function documentDataFromEnquiry(
  e: {
    ref: string;
    origin: string | null;
    destination: string | null;
    cargo: string | null;
    cargo_type: string | null;
    incoterm: string | null;
    ready_date: string | null;
    piece_count: number | null;
    piece_length_cm: number | null;
    piece_width_cm: number | null;
    piece_height_cm: number | null;
    gross_weight_kg: number | null;
    volume_cbm: number | null;
    stackable: boolean | null;
    upright_only: boolean | null;
    consignee_name: string | null;
    consignee_country: string | null;
  },
  customer?: { name?: string | null; company?: string | null; phone?: string | null } | null,
  /** The rate this desk has quoted the customer, if one has been issued. */
  quotedInr?: number | null
): DocumentData {
  const un = <T,>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);

  const l = un(e.piece_length_cm);
  const w = un(e.piece_width_cm);
  const h = un(e.piece_height_cm);

  return {
    // Enquiries are ALG09004-26 now. A ref from before 044 (ARX-C0001-E02) is
    // numbered without its house prefix, so no document says ARX- twice or at all.
    reference: e.ref,
    documentNumber: e.ref.replace(/^ARX-/, ""),

    shipperName: un(customer?.company) || un(customer?.name),
    customerName: un(customer?.name),
    company: un(customer?.company),
    phone: un(customer?.phone),
    consigneeName: un(e.consignee_name),
    consigneeCountry: un(e.consignee_country) || un(e.destination),

    origin: un(e.origin),
    destination: un(e.destination),
    sailingDate: un(e.ready_date),

    cargoDescription: un(e.cargo),
    cargoType: un(e.cargo_type),
    pieceCount: un(e.piece_count),
    pieceDimensions: l && w && h ? `${l} x ${w} x ${h} cm` : undefined,
    grossWeightKg: un(e.gross_weight_kg),
    volumeCbm: un(e.volume_cbm),
    stackable: un(e.stackable),
    uprightOnly: un(e.upright_only),

    freightAmountInr: un(quotedInr),
    incoterm: un(e.incoterm),

    sourceNote: `From enquiry ${e.ref}.`,
    raw: {} as RequestDetails,
  };
}

/**
 * A real booking, from the shipments table.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS ALONGSIDE documentDataFromShipment
 *
 * That one maps the LEGACY mock shipment — the shape with blNumber, company and
 * callExtraction on it, which came from the demo data that has since been
 * deleted. Nothing produces that shape any more.
 *
 * This maps the row the database actually holds. The two are kept apart rather
 * than merged because their field names differ almost everywhere and a single
 * function taking a union would be a pile of `in` checks pretending to be one
 * mapping.
 *
 * WHAT HAPPENS WHEN A FIELD IS STILL EMPTY
 *
 * It comes through undefined and the readiness check reports that document as a
 * draft naming exactly what it needs. That is the correct answer rather than a
 * shortcoming: a bill of lading cannot be issued final off a booking that has
 * never been told who the consignee is, and filling the field with a blank
 * would produce a document that looks complete and is not.
 *
 * Until 028 that state was permanent — the shipments table had no consignee,
 * packing or invoice columns at all, so nine of the twelve documents could
 * never be issued however complete the booking was. The columns exist now; an
 * empty one means nobody has filled it in yet.
 * ---------------------------------------------------------------------------
 */
export function documentDataFromBooking(
  s: {
    id: string;
    enquiry_ref: string;
    origin: string | null;
    destination: string | null;
    cargo: string | null;
    piece_count: number | null;
    volume_cbm: number | null;
    gross_weight_kg: number | null;
    agreed_inr: number | null;
    sailing_date: string | null;
    carrier: string | null;
    booking_number: string | null;
    container_number: string | null;
    bl_number: string | null;
    mainline_no?: string | null;
    /** Whose house bill it travels under: ours (bl_number), or another's, received (088). */
    bl_type?: "house" | "forwarder" | null;
    forwarders_bl_no?: string | null;
    vessel: string | null;
    etd: string | null;
    eta: string | null;
    container_type?: string | null;
    consignee_name?: string | null;
    consignee_address?: string | null;
    consignee_country?: string | null;
    shipper_name?: string | null;
    shipper_gstin_iec?: string | null;
    package_count?: number | null;
    package_type?: string | null;
    hs_code?: string | null;
    net_weight_kg?: number | null;
    invoice_value_inr?: number | null;
    incoterm?: string | null;
    payment_terms?: string | null;
    letter_of_credit?: boolean | null;
    transport_mode?: string | null;
  } & Partial<FreeTimeTerms>,
  customer?: { name?: string | null; company?: string | null; phone?: string | null } | null
): DocumentData {
  const un = <T,>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);
  // The house bill the cargo is released against: the origin agent's on an
  // import that travels under theirs, ours otherwise.
  const house = s.bl_type === "forwarder" && s.forwarders_bl_no ? s.forwarders_bl_no : s.bl_number;

  return {
    // The job's reference, not the booking's row id: ARX-SHP-0004 is how the
    // database files it, and nobody outside the database has heard of it. The
    // number is the B/L number once there is one, and the job reference until
    // then — a document has to be numbered even while it is a draft.
    reference: s.enquiry_ref,
    documentNumber: house || s.enquiry_ref,
    blNumber: un(house),
    // The same number twice says nothing: on a direct job the carrier's bill is
    // both, and the second line would only look like a second document.
    masterBlNumber: s.mainline_no && s.mainline_no !== house ? s.mainline_no : undefined,
    // Only a full container load has a box on the line's clock.
    freeTimeText: appliesTo(s.transport_mode)
      ? termsText({
          free_time_basis: s.free_time_basis ?? "separate",
          demurrage_free_days: s.demurrage_free_days ?? null,
          detention_free_days: s.detention_free_days ?? null,
          combined_free_days: s.combined_free_days ?? null,
          demurrage_rate: null,
          detention_rate: null,
          combined_rate: null,
          dnd_currency: null,
        })
      : undefined,

    // The booking's own shipper wins over the customer record: they are usually
    // the same and occasionally not, and the booking is the later statement.
    shipperName: un(s.shipper_name) || un(customer?.company) || un(customer?.name),
    shipperGstinIec: un(s.shipper_gstin_iec),
    customerName: un(customer?.name),
    company: un(customer?.company),
    phone: un(customer?.phone),

    consigneeName: un(s.consignee_name),
    consigneeAddress: un(s.consignee_address),
    consigneeCountry: un(s.consignee_country) || un(s.destination),

    origin: un(s.origin),
    destination: un(s.destination),
    carrier: un(s.carrier),
    containerId: un(s.container_number),
    containerType: un(s.container_type),
    sailingDate: un(s.sailing_date) || un(s.etd),
    etaDate: un(s.eta),

    cargoDescription: un(s.cargo),
    hsCode: un(s.hs_code),
    pieceCount: un(s.piece_count),
    packageCount: un(s.package_count),
    packageType: un(s.package_type),
    netWeightKg: un(s.net_weight_kg),
    grossWeightKg: un(s.gross_weight_kg),
    volumeCbm: un(s.volume_cbm),

    invoiceValueInr: un(s.invoice_value_inr) ?? un(s.agreed_inr),
    freightAmountInr: un(s.agreed_inr),
    incoterm: un(s.incoterm),
    paymentTerms: un(s.payment_terms),
    letterOfCredit: un(s.letter_of_credit),

    sourceNote: `From the booking on job ${s.enquiry_ref}.`,
    raw: {} as RequestDetails,
  };
}



/**
 * The number a document prints and is filed under: what kind it is, then what
 * it is numbered by — BKG-ALG09004-26, BL-MAEU123456789.
 *
 * It used to lead with ARX-, the house prefix from before Aashish Logistics
 * had its own references. The ALG in the job reference says whose it is.
 */
export const documentNo = (spec: { numberPrefix: string }, data: { documentNumber: string }): string =>
  `${spec.numberPrefix}-${data.documentNumber}`;

/**
 * The same number as a file name, with the document's kind spelled out.
 *
 * Our house bills are HBL/26-27/0001, and a slash in a file name is a folder
 * to the browser and an invalid name to a mail attachment, so the characters
 * no file system accepts become hyphens.
 */
export const documentFilename = (spec: { numberPrefix: string; id: string }, data: { documentNumber: string }): string =>
  `${documentNo(spec, data)}-${spec.id}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");

/** Which of a document's required fields are still outstanding. */
export function readiness(data: DocumentData, requires: DataKey[]) {
  const missing = requires.filter((k) => {
    const v = data[k];
    return v === undefined || v === null || v === "";
  });
  return {
    ready: missing.length === 0,
    missing,
    missingLabels: missing.map(labelFor),
    have: requires.length - missing.length,
    need: requires.length,
  };
}
