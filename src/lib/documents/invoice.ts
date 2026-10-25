import type { DocSection, DocSpec, DocumentData } from "./types";
import { billed, chargesOutstanding, docMoney, gstinOf, stateOf } from "./charges";
import { documentNo, labelFor, readiness } from "./data";
import { issuedToday } from "./letterhead";

/**
 * The tax invoice and its proforma: one paper, wherever it is made.
 *
 * ---------------------------------------------------------------------------
 * The same two specs print on the shipment's Documents tab, from the job and
 * its accepted quotation, and on the Manual documents page, from what is typed
 * there, so the two can never come out different (the user, 25 Oct 2026). It
 * was the freight invoice; it is the tax invoice now.
 *
 * THE NUMBER
 *
 * A tax invoice is one of a series, ALG/26-27/0001 on, across all shipments.
 * It is given by the database (141) the first time the invoice is made for its
 * B/L with nothing else outstanding, and kept for that B/L: made again, here or
 * on the other page, it prints the same number. Until then it is a draft. The
 * proforma is numbered by its job, PI-, as it always was.
 * ---------------------------------------------------------------------------
 */

/** A weight or a measure as the e-invoice prints it: 330.000, 0.400. */
const three = (n?: number) => (n !== undefined ? n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : undefined);
const joined = (...parts: Array<string | number | undefined>) => parts.filter((x) => x !== undefined && x !== "").join(" ") || undefined;
/** A number and what goes with it, as the sample writes them: "1214865 / 01-Oct-2026"; nothing without the number. */
const slashed = (first?: string, second?: string) => (first ? [first, second].filter(Boolean).join(" / ") : undefined);

/** Where the service is supplied, for a party registered for GST: its state, from the first two digits of its GSTIN. */
const placeOfSupply = (d: DocumentData) => stateOf(billed(d).tax);

/** A party as the invoice prints it: the name, then what goes under it, a line each; nothing without the name. */
const party = (name?: string, ...under: Array<string | undefined>) => (name ? [name, ...under].filter(Boolean).join("\n") : undefined);

/** Whether a party is the one billed: printed in full as Billed to, and by name alone where it comes again. */
const isBilled = (d: DocumentData, who: "consignee" | "shipper" | "notify") => (d.billTo ?? "consignee") === who;

/** What an invoice to us says, at the foot of both forms (lib/documents/render.ts). */
export const INVOICE_TERMS = [
  "Payment by NEFT / RTGS to the account shown, quoting the invoice number.",
  "Any discrepancy is to be reported to us in writing within 7 days of the invoice date; otherwise the invoice is taken as correct.",
  "Cargo is released on receipt and realisation of payment for the freight and other charges.",
  "Subject to Chennai jurisdiction.",
];

/**
 * What both forms of the invoice print above the charges, as the line's
 * e-invoice (QDWJ26093202) sets them out, under its labels: label and value,
 * without boxes. Down the left, the party billed with its GSTIN and state
 * code; the shipper, the consignee and the notify party, the one billed by
 * name alone, its address being above; the route and the note. Down the
 * right, the customer's code and PAN, the invoice's own particulars and the
 * shipment's. The proforma is the same paper numbered PI-, without the tax
 * invoice's IRN and reverse-charge lines.
 */
export function invoiceSections(prefix: string, tax: boolean): DocSection[] {
  return [
    {
      title: "Billed to",
      place: "left",
      rows: [
        { label: "Billed to", value: (d) => party(billed(d).name, billed(d).address), bold: true },
        {
          label: "GSTIN",
          value: (d) => {
            const g = billed(d).tax;
            return g ? [g, placeOfSupply(d) && `State code: ${placeOfSupply(d)}`].filter(Boolean).join("     ") : undefined;
          },
        },
        { label: "Contact", value: (d) => d.phone, optional: true },
      ],
    },
    {
      title: "Parties",
      place: "left",
      rows: [
        {
          label: "Shipper",
          value: (d) => (isBilled(d, "shipper") ? d.shipperName : party(d.shipperName, d.shipperAddress, d.shipperGstinIec && `GSTIN / IEC: ${d.shipperGstinIec}`)),
          bold: true,
        },
        {
          label: "Consignee",
          value: (d) =>
            isBilled(d, "consignee")
              ? d.consigneeName
              : party(d.consigneeName, d.consigneeAddress, d.consigneeCountry, d.consigneeGstin && `GSTIN: ${d.consigneeGstin}`),
          bold: true,
        },
        {
          label: "Notify party",
          value: (d) => (isBilled(d, "notify") ? d.notifyName : party(d.notifyName, d.notifyAddress, d.notifyGstin && `GSTIN: ${d.notifyGstin}`)),
          bold: true,
          optional: true,
        },
      ],
    },
    {
      title: "Route",
      place: "left",
      rows: [
        { label: "Port of origin", value: (d) => d.portOfLoading ?? d.origin },
        { label: "Port of discharge", value: (d) => d.destination },
        { label: "Final destination", value: (d) => d.finalDestination, optional: true },
        { label: "Vessel", value: (d) => d.vessel },
        { label: "Voyage number", value: (d) => d.voyage, optional: true },
        { label: "Commodity", value: (d) => d.cargoDescription },
        { label: "Carrier", value: (d) => d.carrier, optional: true },
        { label: "ETD", value: (d) => d.sailingDate, optional: true },
        { label: "ETA", value: (d) => d.etaDate, optional: true },
        { label: "Place of supply", value: placeOfSupply, optional: true },
        { label: "Shipper ref no", value: (d) => d.invoice?.shipperRef, optional: true },
        { label: "Note", value: (d) => d.invoice?.note, optional: true },
        { label: "Salesman", value: (d) => d.salesRef, optional: true },
      ],
    },
    {
      title: "Customer",
      place: "right",
      rows: [
        { label: "Customer code", value: (d) => d.invoice?.customerCode, optional: true },
        { label: "Customer PAN no", value: (d) => d.invoice?.customerPan ?? gstinOf(billed(d).tax)?.slice(2, 12), optional: true },
      ],
    },
    {
      title: tax ? "Invoice" : "Proforma",
      place: "right",
      rows: [
        {
          label: tax ? "Invoice number" : "Proforma number",
          // A tax invoice by its own series, as given (141); a proforma by the job, as it always was.
          value: (d) => (tax ? d.invoice?.number : documentNo({ numberPrefix: prefix }, d)),
          bold: true,
        },
        ...(tax ? [{ label: "IRN", value: (d: DocumentData) => d.invoice?.irn, optional: true }] : []),
        { label: "Date", value: (d) => d.invoice?.invoiceDate ?? issuedToday() },
        ...(tax ? [{ label: "Reverse charge", value: () => "No" }] : []),
        { label: "Payment due date", value: (d) => d.invoice?.dueDate, optional: true },
        { label: "Job number", value: (d) => (d.reference === "TBD" ? undefined : d.reference) },
        { label: "Job date", value: (d) => d.jobDate, optional: true },
        { label: "Freight terms", value: (d) => d.freightTerms, optional: true },
        { label: "Payment terms", value: (d) => d.paymentTerms, optional: true },
        // The one freight figure, where the charges are not itemised; itemised, the table says it.
        { label: "Ocean freight", value: (d) => (d.charges?.length ? undefined : docMoney(d, d.freightAmountInr)), optional: true },
      ],
    },
    {
      title: "Shipment",
      place: "right",
      rows: [
        { label: "Master number", value: (d) => d.masterBlNumber, optional: true },
        { label: "House number", value: (d) => d.blNumber },
        { label: "Advance receipt no", value: (d) => d.invoice?.advanceReceipt, optional: true },
        // The box's number, then its size and type, as the arrival notice writes it: "TWCU8075142 - 40HC".
        { label: "Container", value: (d) => [d.containerId, d.containerType].filter(Boolean).join(" - ") || undefined },
        { label: "Vehicle no", value: (d) => d.invoice?.vehicleNo, optional: true },
        { label: "Number of packs", value: (d) => (d.packageCount !== undefined ? joined(d.packageCount, d.packageType) : undefined) },
        { label: "Weight (kgs)", value: (d) => three(d.grossWeightKg) },
        { label: "Volume (CBM)", value: (d) => three(d.volumeCbm) },
        { label: "IGM number", value: (d) => slashed(d.igmNumber, d.igmDate), optional: true },
        { label: "Item number", value: (d) => d.igmItemNo, optional: true },
        { label: "Sub item number", value: (d) => d.igmSubItemNo, optional: true },
      ],
    },
  ];
}

/** What a tax invoice still needs until it is given its number. */
export const INVOICE_NUMBER = "Invoice number";
/** What it needs instead when there is no B/L for the number to be given by. */
export const NUMBER_BY_BL = "B/L number, to number it by";

/** The charges line by line with a rate on each, or the freight as one figure. */
const chargesCheck = (d: DocumentData) =>
  d.charges?.length ? chargesOutstanding(d) : d.freightAmountInr === undefined ? [labelFor("freightAmountInr")] : [];

/**
 * The tax invoice, laid out as a GST invoice to the trade (`layout:
 * "invoice"`): the tax on each line, central and state or integrated,
 * summarised by SAC, our PAN and GSTIN, the terms, and the bank account to pay
 * into by the signature, on the one page. Not issued without its number.
 */
export const TAX_INVOICE: DocSpec = {
  id: "tax-invoice",
  title: "TAX INVOICE",
  shortName: "Tax invoice",
  purpose: "What the customer owes us for the forwarding service, numbered in our series, ALG/26-27/0001 on.",
  issuer: "desk",
  numberPrefix: "TI",
  requires: ["origin", "destination"],
  check: (d) => [...chargesCheck(d), ...(d.invoice?.number ? [] : [d.blNumber ? INVOICE_NUMBER : NUMBER_BY_BL])],
  number: (d) => d.invoice?.number,
  copies: true,
  parties: false,
  layout: "invoice",
  sections: invoiceSections("TI", true),
  // Itemised, line by line, each in its currency (the manual form's Charges, a job's accepted quotation).
  charges: { title: "Charges" },
  terms: INVOICE_TERMS,
};

/** The proforma: the same paper, PROFORMA INVOICE, numbered PI- by the job, saying it is not a tax invoice. */
export const PROFORMA_INVOICE: DocSpec = {
  ...TAX_INVOICE,
  id: "proforma-invoice",
  title: "PROFORMA INVOICE",
  shortName: "Proforma invoice",
  purpose: "The same charges and tax, for approval or an advance before the tax invoice.",
  numberPrefix: "PI",
  check: chargesCheck,
  number: undefined,
  copies: false,
  sections: invoiceSections("PI", false),
  declaration: "A statement of the charges, for approval or advance payment. It is not a tax invoice.",
};

/** Whether a tax invoice wants nothing but its number: the moment it is given one. */
export const readyToNumber = (d: DocumentData) =>
  Boolean(d.blNumber) &&
  !d.invoice?.number &&
  readiness(d, TAX_INVOICE.requires, TAX_INVOICE.check).missingLabels.every((l) => l === INVOICE_NUMBER);

/**
 * What a list says a document still needs: a tax invoice with a B/L to be
 * numbered by does not need its number from anybody — it is given one as it
 * is made.
 */
export const outstanding = (spec: Pick<DocSpec, "number">, d: DocumentData, labels: string[]) =>
  spec.number && d.blNumber ? labels.filter((l) => l !== INVOICE_NUMBER) : labels;
