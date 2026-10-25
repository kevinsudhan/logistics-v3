import type { Shipment } from "../../types";
import { fieldDef, type RequestDetails } from "../../data/requestFields";
import type { ChargeLine, ContainerLine, DataKey, DocumentData } from "./types";
import { appliesTo, termsText, type FreeTimeTerms } from "../freeTime";
import { docDate } from "./letterhead";
import type { ReleaseMode } from "../hbl";

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
  masterBlNumber: "Master B/L number",
  freeTimeText: "Free time per box",
  vessel: "Vessel",
  voyage: "Voyage",
  portOfLoading: "Port of loading",
  igmNumber: "IGM number",
  igmDate: "IGM date",
  cfsName: "Delivery from (CFS)",
  vgmMethod: "Weighing method",
  vgmFacility: "Weighbridge / facility",
  vgmWeighedOn: "Date weighed",
  deliveredOn: "Date delivered",
  receivedBy: "Received by (name)",
  blDate: "House B/L date",
  masterBlDate: "Master B/L date",
  bookingNumber: "Booking number",
  serviceType: "Service",
  shipperAddress: "Shipper address",
  consigneeGstin: "Consignee GSTIN",
  notifyName: "Notify party (CHA / broker)",
  notifyAddress: "Notify party address",
  notifyGstin: "Notify party GSTIN",
  finalDestination: "Final destination",
  finalEtaDate: "ETA at final destination",
  igmItemNo: "IGM item number",
  igmSubItemNo: "IGM sub-item number",
  cfsAddress: "CFS address",
  releaseMode: "House B/L released as",
  freightTerms: "Freight",
  marksNumbers: "Marks and numbers",
  sealNumber: "Seal number",
  poNumber: "PO number",
  invoiceRef: "Invoice reference",
  salesRef: "Sales reference",
  consigneeIec: "Consignee IEC",
  chaName: "CHA",
  tsaNumber: "TSA number",
  unstuffDate: "Unstuff date",
  deliverTo: "Please deliver to",
  doValidity: "DO valid until",
  jobDate: "Job date",
  authBlNumber: "Auth. B/L number",
  authBlDate: "Auth. B/L date",
  cfsEtaDate: "ETA at the CFS",
  consigneeIecType: "Importer type",
  originAgent: "From (origin agent)",
  doDate: "DO date",
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
 * What a job holds besides its shipment row, for the papers that print it
 * (services/documentExtras): the accepted quotation's charges, for the
 * invoices; the import IGM line; the CHA and the customer on the Parties tab;
 * the boxes; and the tax invoice's number, once its B/L has been given one.
 * From the console a house travels in, what the job's own row leaves empty:
 * the vessel, the CFS and the day the box was destuffed there.
 */
export interface BookingExtras {
  charges?: ChargeLine[];
  exchangeRates?: Record<string, number>;
  igm?: { number?: string; date?: string; item?: string; subItem?: string };
  vessel?: string;
  voyage?: string;
  cfsName?: string;
  unstuffDate?: string;
  /** The master's date, the console's. */
  masterDate?: string;
  /**
   * The house bill the job travels under, as the job keeps it: the agent's,
   * read in from their PDF by Gemini (088), or our own (123). Its date, how it
   * is released, where it delivers, and — on the agent's — our DO's date and
   * validity, recorded when the DO is issued from the Bill tab.
   */
  bill?: { date?: string; releaseMode?: ReleaseMode; placeOfDelivery?: string; doIssuedOn?: string; doValidUntil?: string };
  /** Who the shipment comes from: the origin agent on the Parties tab, or the agent whose B/L it is. */
  originAgent?: string;
  chaName?: string;
  customerParty?: DocumentData["customerParty"];
  containers?: ContainerLine[];
  invoiceNumber?: string;
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
    // What the invoices and the delivery order print besides (065, 033, 032, 140).
    voyage?: string | null;
    port_of_loading?: string | null;
    port_of_discharge?: string | null;
    shipper_address?: string | null;
    consignee_gstin?: string | null;
    consignee_iec?: string | null;
    notify_name?: string | null;
    notify_address?: string | null;
    notify_gstin?: string | null;
    marks_and_numbers?: string | null;
    freight_terms?: "prepaid" | "collect" | null;
    tsa_no?: string | null;
    cfs_location?: string | null;
    cfs_clearance_date?: string | null;
    shipment_date?: string | null;
    billed_party?: "consignee" | "customer" | null;
    // What the arrival notice and the delivery order print that nothing else keeps (142).
    po_number?: string | null;
    sales_ref?: string | null;
    invoice_ref?: string | null;
    bl_date?: string | null;
    mainline_date?: string | null;
    auth_bl_no?: string | null;
    auth_bl_date?: string | null;
    final_eta?: string | null;
    cfs_eta?: string | null;
    cfs_address?: string | null;
    consignee_iec_type?: string | null;
    deliver_to?: string | null;
    do_issued_on?: string | null;
    do_valid_until?: string | null;
  } & Partial<FreeTimeTerms>,
  customer?: { name?: string | null; company?: string | null; phone?: string | null } | null,
  extras: BookingExtras = {}
): DocumentData {
  const un = <T,>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);
  /** A day as the documents print it, 14-Oct-2026. */
  const day = (v: string | null | undefined) => (v ? docDate(v) : undefined);
  /** A box's or a job's service, as a delivery order prints it. */
  const service = s.transport_mode === "sea_fcl" ? "FCL" : s.transport_mode === "sea_lcl" ? "LCL" : undefined;
  const boxes = extras.containers?.filter((c) => c.containerId);
  const unstuffed = day(extras.unstuffDate) || day(s.cfs_clearance_date);
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
    // Typed on the job, or the bill's and the console's own.
    blDate: day(s.bl_date) || day(extras.bill?.date),
    masterBlDate: s.mainline_no && s.mainline_no !== house ? day(s.mainline_date) || day(extras.masterDate) : undefined,
    authBlNumber: un(s.auth_bl_no),
    authBlDate: day(s.auth_bl_date),
    bookingNumber: un(s.booking_number),
    jobDate: day(s.shipment_date),
    poNumber: un(s.po_number),
    salesRef: un(s.sales_ref),
    // The notice's own reference, or the tax invoice's number once it has one.
    invoiceRef: un(s.invoice_ref) || extras.invoiceNumber,
    releaseMode: extras.bill?.releaseMode,
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

    shipperAddress: un(s.shipper_address),
    consigneeGstin: un(s.consignee_gstin),
    consigneeIec: un(s.consignee_iec),
    consigneeIecType: un(s.consignee_iec_type),
    originAgent: extras.originAgent,
    notifyName: un(s.notify_name),
    notifyAddress: un(s.notify_address),
    notifyGstin: un(s.notify_gstin),
    chaName: extras.chaName,

    origin: un(s.origin),
    destination: un(s.port_of_discharge) || un(s.destination),
    // The job's destination where it is beyond its port, else where the bill says it delivers.
    finalDestination: finalDestination(
      s.port_of_discharge || s.destination,
      s.port_of_discharge && s.destination !== s.port_of_discharge ? s.destination : extras.bill?.placeOfDelivery
    ),
    finalEtaDate: day(s.final_eta),
    carrier: un(s.carrier),
    // The booking's box, or the job's boxes by number (032) when it names none.
    containerId: un(s.container_number) || boxes?.map((c) => c.containerId).join(", ") || undefined,
    containerType: un(s.container_type) || (boxes?.length === 1 ? boxes[0].containerType : undefined),
    containers: boxes?.length ? boxes.map((c) => ({ serviceType: service, unstuffDate: unstuffed, ...c })) : undefined,
    sealNumber: boxes?.length === 1 ? boxes[0].sealNumber : undefined,
    serviceType: service,
    sailingDate: day(s.sailing_date) || day(s.etd),
    etaDate: day(s.eta),

    vessel: un(s.vessel) || extras.vessel,
    voyage: un(s.voyage) || extras.voyage,
    portOfLoading: un(s.port_of_loading),
    igmNumber: extras.igm?.number,
    igmDate: day(extras.igm?.date),
    igmItemNo: extras.igm?.item,
    igmSubItemNo: extras.igm?.subItem,
    cfsName: un(s.cfs_location) || extras.cfsName,
    cfsAddress: un(s.cfs_address),
    cfsEtaDate: day(s.cfs_eta),
    tsaNumber: un(s.tsa_no),
    unstuffDate: unstuffed,
    deliverTo: un(s.deliver_to),
    // The DO as the Bill tab issued it on the agent's B/L (088), or as typed on the job.
    doDate: day(extras.bill?.doIssuedOn) || day(s.do_issued_on),
    doValidity: day(extras.bill?.doValidUntil) || day(s.do_valid_until),
    freightTerms: s.freight_terms === "prepaid" ? "Prepaid" : s.freight_terms === "collect" ? "Collect" : undefined,

    marksNumbers: un(s.marks_and_numbers),
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

    // Billed as the Parties tab says (140): the consignee, or the customer there; the consignee until it is chosen.
    billTo: s.billed_party === "customer" ? "customer" : "consignee",
    customerParty: extras.customerParty,
    charges: extras.charges,
    exchangeRates: extras.exchangeRates,
    // ORIGINAL, as the e-invoice marks the copy sent; dated the day it is printed.
    invoice: { number: extras.invoiceNumber, copy: "ORIGINAL" },

    sourceNote: `From the booking on job ${s.enquiry_ref}.`,
    raw: {} as RequestDetails,
  };
}

/** Where the cargo ends up, when that is beyond the port of discharge: nothing when it is the port. */
function finalDestination(port: string | null | undefined, beyond: string | null | undefined): string | undefined {
  const b = beyond?.trim();
  return b && b.toUpperCase() !== (port ?? "").trim().toUpperCase() ? b : undefined;
}

/**
 * The number a document prints and is filed under: what kind it is, then what
 * it is numbered by — BKG-ALG09004-26, BL-MAEU123456789.
 *
 * It used to lead with ARX-, the house prefix from before Aashish Logistics
 * had its own references. The ALG in the job reference says whose it is.
 *
 * A document numbered in a series of its own prints that instead, once it has
 * it: the tax invoice, ALG/26-27/0001 (141).
 */
export const documentNo = (
  spec: { numberPrefix: string; number?: (d: DocumentData) => string | undefined },
  data: { documentNumber: string }
): string => spec.number?.(data as DocumentData) ?? `${spec.numberPrefix}-${data.documentNumber}`;

/**
 * The same number as a file name, with the document's kind spelled out.
 *
 * Our house bills are HBL/26-27/0001, and a slash in a file name is a folder
 * to the browser and an invalid name to a mail attachment, so the characters
 * no file system accepts become hyphens.
 */
export const documentFilename = (
  spec: { numberPrefix: string; id: string; number?: (d: DocumentData) => string | undefined },
  data: { documentNumber: string }
): string =>
  `${documentNo(spec, data)}-${spec.id}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");

/** Which of a document's required fields are still outstanding. */
export function readiness(data: DocumentData, requires: DataKey[], check?: (d: DocumentData) => string[]) {
  const missing = requires.filter((k) => {
    const v = data[k];
    return v === undefined || v === null || v === "";
  });
  const also = check?.(data) ?? [];
  return {
    ready: missing.length === 0 && also.length === 0,
    missing,
    missingLabels: [...missing.map(labelFor), ...also],
    have: requires.length - missing.length,
    need: requires.length + also.length,
  };
}
