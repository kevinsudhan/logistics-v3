import type { DocSpec, DocumentData } from "./types";
import { COMPANY } from "../company";
import { deliveryNeeds } from "../arrivalNotice";
import { chargesOutstanding, docMoney } from "./charges";
import { labelFor } from "./data";

/**
 * Every document the forwarder issues, as a declaration.
 *
 * Ordered by where they fall in a shipment's life, from the first quote to proof that the
 * cargo arrived — which is also the order the desk works through them, so the UI list
 * reads as a progression rather than an alphabetical pile.
 *
 * `requires` is the honest part of each entry. It lists what the document genuinely
 * cannot be issued without, not everything it prints: a Delivery Order without a
 * container number is not a Delivery Order, while one without an Incoterm is fine.
 * Getting these wrong in the lenient direction is the dangerous one — it produces a
 * document that claims to be issuable when it is missing something a port will stop it
 * for.
 */

const money = docMoney;
const kg = (n?: number) => (n !== undefined ? `${n.toLocaleString("en-IN")} kg` : undefined);
const yesNo = (b?: boolean) => (b === undefined ? undefined : b ? "Yes" : "No");
const packages = (d: DocumentData) =>
  d.packageCount !== undefined ? `${d.packageCount} x ${d.packageType ?? "units"}` : undefined;
const route = (d: DocumentData) =>
  d.origin && d.destination ? `${d.origin} to ${d.destination}` : undefined;
const vesselVoyage = (d: DocumentData) => [d.vessel, d.voyage].filter(Boolean).join(" / ") || undefined;
const igm = (d: DocumentData) =>
  d.igmNumber ? [d.igmNumber, d.igmDate && `dated ${d.igmDate}`].filter(Boolean).join(" ") : undefined;
const igmItem = (d: DocumentData) =>
  d.igmItemNo ? [d.igmItemNo, d.igmSubItemNo && `sub-item ${d.igmSubItemNo}`].filter(Boolean).join(", ") : undefined;
const numberAndDate = (no?: string, date?: string) => (no ? [no, date].filter(Boolean).join(" / ") : undefined);
/** A GSTIN, with the state it is registered in: its first two digits are the state code. */
const gstin = (g?: string) => (g ? `${g}${/^\d{2}/.test(String(g)) ? `  ·  State code ${String(g).slice(0, 2)}` : ""}` : undefined);
/** A weight or measure as a manifest prints it: 330.000. */
const three = (n?: number) =>
  n !== undefined ? n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : undefined;
/** Our PAN, for a consignee deducting tax at source: a GSTIN carries its holder's PAN as characters 3 to 12. */
const PAN = COMPANY.gstin.slice(2, 12);

/** Rows almost every document repeats. Declared once so they cannot drift apart. */
const CARGO_ROWS = [
  { label: "Cargo description", value: (d: DocumentData) => d.cargoDescription },
  { label: "HS code", value: (d: DocumentData) => d.hsCode },
  { label: "Packages", value: packages },
  { label: "Net weight", value: (d: DocumentData) => kg(d.netWeightKg) },
  { label: "Gross weight", value: (d: DocumentData) => kg(d.grossWeightKg) },
  { label: "Volume", value: (d: DocumentData) => (d.volumeCbm !== undefined ? `${d.volumeCbm} CBM` : undefined) },
];

const ROUTE_ROWS = [
  { label: "Origin", value: (d: DocumentData) => d.origin },
  { label: "Destination", value: (d: DocumentData) => d.destination },
  { label: "Carrier", value: (d: DocumentData) => d.carrier },
  { label: "Container type", value: (d: DocumentData) => d.containerType },
  { label: "Container number", value: (d: DocumentData) => d.containerId },
  { label: "Sailing date", value: (d: DocumentData) => d.sailingDate },
];

export const DOCUMENTS: DocSpec[] = [
  // ------------------------------------------------------------- pre-booking
  {
    id: "quotation",
    title: "QUOTATION / RATE SHEET",
    shortName: "Quotation",
    purpose: "The rate offered to the customer, before anything is booked.",
    issuer: "desk",
    numberPrefix: "QUO",
    requires: ["origin", "destination", "cargoDescription", "freightAmountInr"],
    parties: false,
    sections: [
      {
        title: "Enquiry",
        rows: [
          { label: "Customer", value: (d) => d.company ?? d.customerName },
          { label: "Contact", value: (d) => d.phone },
          { label: "Route", value: route },
          { label: "Cargo", value: (d) => d.cargoDescription },
          { label: "Piece dimensions", value: (d) => d.pieceDimensions },
          { label: "Pieces", value: (d) => d.pieceCount?.toLocaleString("en-IN") },
          { label: "Volume", value: (d) => (d.volumeCbm !== undefined ? `${d.volumeCbm} CBM` : undefined) },
          { label: "Gross weight", value: (d) => kg(d.grossWeightKg) },
        ],
      },
      {
        title: "Rate offered",
        rows: [
          { label: "Container type", value: (d) => d.containerType },
          { label: "Freight rate", value: (d) => money(d, d.freightAmountInr) },
          { label: "Rate requested by customer", value: (d) => money(d, d.targetPriceInr) },
          { label: "Indicative sailing", value: (d) => d.sailingDate },
          { label: "Incoterm", value: (d) => d.incoterm },
        ],
      },
    ],
    declaration:
      "This quotation is an offer of freight only and excludes duties, taxes and destination charges unless stated. Rates are subject to space and equipment availability at the time of booking.",
  },
  {
    id: "booking-confirmation",
    title: "BOOKING CONFIRMATION",
    shortName: "Booking confirmation",
    purpose: "Confirms space is held on a named sailing at an agreed rate.",
    issuer: "desk",
    numberPrefix: "BKG",
    requires: ["origin", "destination", "sailingDate", "containerType", "freightAmountInr"],
    parties: false,
    sections: [
      {
        title: "Booking",
        rows: [
          { label: "Customer", value: (d) => d.company ?? d.customerName },
          ...ROUTE_ROWS,
          { label: "Agreed freight rate", value: (d) => money(d, d.freightAmountInr) },
        ],
      },
      { title: "Cargo", rows: CARGO_ROWS },
    ],
    declaration:
      "Space is held against this booking. Cargo must reach the terminal before the carrier's cut-off; bookings not met by cut-off are released without further notice.",
  },

  // ------------------------------------------------------------ export filing
  {
    id: "shipping-instructions",
    title: "SHIPPING INSTRUCTIONS TO CARRIER",
    shortName: "Shipping instructions",
    purpose: "What we tell the carrier to print on the bill of lading.",
    issuer: "desk",
    numberPrefix: "SI",
    requires: [
      "shipperName",
      "consigneeName",
      "consigneeAddress",
      "origin",
      "destination",
      "cargoDescription",
      "packageCount",
      "grossWeightKg",
    ],
    parties: true,
    sections: [
      { title: "Carriage", rows: ROUTE_ROWS },
      { title: "Cargo as to be described on the B/L", rows: CARGO_ROWS },
      {
        title: "Handling",
        rows: [
          { label: "Stackable", value: (d) => yesNo(d.stackable) },
          { label: "Must stay upright", value: (d) => yesNo(d.uprightOnly) },
          { label: "Temperature setpoint", value: (d) => (d.temperatureSetpointC !== undefined ? `${d.temperatureSetpointC} C` : undefined) },
          { label: "Pre-cooling required", value: (d) => yesNo(d.preCoolingRequired) },
          { label: "Wood packaging (ISPM-15)", value: (d) => yesNo(d.woodPackagingUsed) },
          { label: "DG - UN packaging", value: (d) => d.unPackagingSpec },
          { label: "DG - carrier approval", value: (d) => d.carrierDgApproval },
        ],
      },
    ],
    declaration:
      "The particulars above are furnished by the shipper. The carrier is requested to issue the bill of lading accordingly.",
  },
  {
    id: "vgm-declaration",
    title: "VERIFIED GROSS MASS DECLARATION (SOLAS VI/2)",
    shortName: "VGM declaration",
    purpose: "Mandatory verified weight of the packed container, before loading.",
    issuer: "desk",
    numberPrefix: "VGM",
    requires: ["shipperName", "containerId", "grossWeightKg"],
    parties: false,
    sections: [
      {
        title: "Declaration",
        rows: [
          { label: "Shipper (responsible party)", value: (d) => d.shipperName },
          { label: "Shipper GSTIN / IEC", value: (d) => d.shipperGstinIec },
          { label: "Container number", value: (d) => d.containerId },
          { label: "Container type", value: (d) => d.containerType },
          { label: "Booking reference", value: (d) => d.reference },
          { label: "Verified gross mass", value: (d) => kg(d.grossWeightKg) },
          { label: "Cargo net weight", value: (d) => kg(d.netWeightKg) },
        ],
      },
      {
        title: "Weighing",
        rows: [
          // Neither method is derivable from a phone call, so both are left for the desk
          // rather than guessed. A VGM with an invented method is a false declaration.
          // No record sets these: they print TBD on a job's VGM and are filled only
          // where a person types them in from the weighing slip (Manual documents).
          { label: "Method used", value: (d) => d.vgmMethod },
          { label: "Weighbridge / facility", value: (d) => d.vgmFacility },
          { label: "Date weighed", value: (d) => d.vgmWeighedOn },
        ],
      },
    ],
    declaration:
      "The verified gross mass stated above is declared under SOLAS Chapter VI Regulation 2. Method and weighing details must be completed and signed by the authorised person before submission to the carrier.",
  },

  // ------------------------------------------------------------- title & receipt
  {
    id: "bl-draft",
    title: "DRAFT BILL OF LADING - FOR APPROVAL",
    shortName: "Draft B/L",
    purpose: "Sent to the customer to check before the carrier issues the original.",
    issuer: "desk",
    numberPrefix: "BLD",
    requires: [
      "shipperName",
      "consigneeName",
      "consigneeAddress",
      "origin",
      "destination",
      "cargoDescription",
      "packageCount",
      "grossWeightKg",
    ],
    parties: true,
    sections: [
      { title: "Carriage", rows: ROUTE_ROWS },
      { title: "Particulars furnished by the shipper", rows: CARGO_ROWS },
      {
        title: "Freight",
        rows: [
          { label: "Freight", value: (d) => money(d, d.freightAmountInr) },
          { label: "Incoterm", value: (d) => d.incoterm },
          { label: "Payment terms", value: (d) => d.paymentTerms },
        ],
      },
    ],
    declaration:
      "DRAFT - NOT A DOCUMENT OF TITLE. Check every particular and confirm in writing. Corrections after the original is issued attract carrier amendment charges.",
  },
  {
    id: "bl-final",
    title: "BILL OF LADING - PARTICULARS",
    shortName: "Final B/L particulars",
    purpose: "The approved particulars against the carrier's issued B/L number.",
    issuer: "desk",
    numberPrefix: "BL",
    requires: [
      "blNumber",
      "shipperName",
      "consigneeName",
      "consigneeAddress",
      "origin",
      "destination",
      "cargoDescription",
      "packageCount",
      "grossWeightKg",
    ],
    parties: true,
    sections: [
      {
        title: "Bill of lading",
        rows: [
          { label: "B/L number", value: (d) => d.blNumber },
          { label: "Master B/L", value: (d) => d.masterBlNumber, optional: true },
          ...ROUTE_ROWS,
        ],
      },
      { title: "Particulars furnished by the shipper", rows: CARGO_ROWS },
    ],
    declaration:
      "This is a record of the particulars on the carrier's bill of lading. The original bill of lading issued by the carrier is the document of title; this record is not.",
  },
  {
    id: "fcr",
    title: "FORWARDER'S CARGO RECEIPT",
    shortName: "Cargo receipt (FCR)",
    purpose: "Our receipt that the cargo was taken into our care.",
    issuer: "desk",
    numberPrefix: "FCR",
    requires: ["shipperName", "consigneeName", "cargoDescription", "packageCount", "grossWeightKg"],
    parties: true,
    sections: [
      { title: "Cargo received", rows: CARGO_ROWS },
      {
        title: "For carriage",
        rows: [
          { label: "Route", value: route },
          { label: "Container type", value: (d) => d.containerType },
          { label: "Container number", value: (d) => d.containerId },
          { label: "Intended sailing", value: (d) => d.sailingDate },
        ],
      },
    ],
    declaration:
      "Received the goods described above in apparent good order and condition, for forwarding in accordance with our standard trading conditions.",
  },

  // ------------------------------------------------------------------ arrival
  {
    /*
      The cargo arrival notice (CAN), in two columns.
      ------------------------------------------------------------------------
      Laid out the way an import desk's CAN is: who it concerns down the left
      (the CHA it is copied to, the consignee, the shipper), the shipment on
      the right (the two bills, the vessel, the ports and ETA, the IGM line the
      Bill of Entry is filed against, the CFS it is delivered from), the cargo
      as one line across, then what the consignee has to do to take delivery.

      Most of the right-hand column is optional: a job's notice prints what its
      booking holds and leaves the rest out, rather than a column of TBD.
    */
    id: "arrival-notice",
    title: "CARGO ARRIVAL NOTICE",
    shortName: "Arrival notice",
    purpose: "Tells the consignee the cargo has arrived and what is owed before release.",
    issuer: "desk",
    numberPrefix: "AN",
    requires: ["blNumber", "consigneeName", "destination", "etaDate"],
    // The parties are the left column's boxes, below, not the usual pair.
    parties: false,
    layout: "split",
    sections: [
      {
        title: "Notify party (CHA / broker)",
        place: "left",
        rows: [
          { label: "Name", value: (d) => d.notifyName, bare: true, optional: true },
          { label: "Address", value: (d) => d.notifyAddress, bare: true, optional: true },
          { label: "GSTIN", value: (d) => gstin(d.notifyGstin), optional: true },
        ],
      },
      {
        title: "Consignee",
        place: "left",
        rows: [
          { label: "Name", value: (d) => d.consigneeName, bare: true },
          { label: "Address", value: (d) => d.consigneeAddress, bare: true },
          { label: "Country", value: (d) => d.consigneeCountry, bare: true, optional: true },
          { label: "GSTIN", value: (d) => gstin(d.consigneeGstin), optional: true },
        ],
      },
      {
        title: "Shipper",
        place: "left",
        rows: [
          { label: "Name", value: (d) => d.shipperName, bare: true },
          { label: "Address", value: (d) => d.shipperAddress, bare: true, optional: true },
        ],
      },
      {
        title: "Shipment details",
        place: "right",
        rows: [
          { label: "House B/L", value: (d) => numberAndDate(d.blNumber, d.blDate) },
          { label: "Service", value: (d) => d.serviceType, optional: true },
          { label: "Master B/L (OBL)", value: (d) => numberAndDate(d.masterBlNumber, d.masterBlDate), optional: true },
          { label: "Booking number", value: (d) => d.bookingNumber, optional: true },
          { label: "Vessel / voyage", value: vesselVoyage, optional: true },
          { label: "Carrier", value: (d) => d.carrier, optional: true },
          { label: "Origin", value: (d) => d.origin, optional: true },
          { label: "Port of loading", value: (d) => d.portOfLoading, optional: true },
          { label: "Port of discharge", value: (d) => d.destination },
          { label: "ETA", value: (d) => d.etaDate },
          { label: "Final destination", value: (d) => d.finalDestination, optional: true },
          { label: "ETA at final destination", value: (d) => d.finalEtaDate, optional: true },
          { label: "IGM", value: igm, optional: true },
          { label: "IGM item", value: igmItem, optional: true },
          {
            label: "Delivery from (CFS / warehouse)",
            value: (d) => [d.cfsName, d.cfsAddress].filter(Boolean).join("\n") || undefined,
            optional: true,
            wide: true,
          },
          { label: "Freight", value: (d) => d.freightTerms, optional: true },
          { label: "Free time per box", value: (d) => d.freeTimeText, optional: true },
          { label: "PO number", value: (d) => d.poNumber, optional: true },
          { label: "Invoice reference", value: (d) => d.invoiceRef, optional: true },
          { label: "Sales reference", value: (d) => d.salesRef, optional: true },
        ],
      },
      {
        title: "Cargo",
        place: "table",
        rows: [
          // Optional, so a job's notice (whose booking holds neither) leaves the cells blank rather than TBD.
          { label: "Marks & numbers", value: (d) => d.marksNumbers, width: 24, optional: true },
          {
            label: "Description",
            value: (d) => [d.cargoDescription, d.hsCode && `HS ${d.hsCode}`].filter(Boolean).join("\n") || undefined,
            width: 44,
          },
          {
            label: "Container",
            value: (d) => (d.containerId ? [d.containerId, d.containerType].filter(Boolean).join(" - ") : d.containerType),
            width: 32,
          },
          { label: "Seal", value: (d) => d.sealNumber, width: 22, optional: true },
          {
            label: "Packages",
            value: (d) => (d.packageCount !== undefined ? `${d.packageCount} ${d.packageType ?? ""}`.trim() : undefined),
            width: 20,
            align: "right",
          },
          { label: "Gross kg", value: (d) => three(d.grossWeightKg), width: 19, align: "right" },
          { label: "CBM", value: (d) => three(d.volumeCbm), width: 17, align: "right" },
        ],
      },
      {
        // Under the parties, where the left column has room the right does not use.
        title: "Payable before release",
        place: "left",
        rows: [{ label: "Freight and charges", value: (d) => money(d, d.freightAmountInr) }],
      },
    ],
    notes: {
      title: "To take delivery",
      lead: (d) =>
        d.etaDate
          ? `${d.vessel ? `The vessel ${d.vessel}${d.voyage ? ` (voyage ${d.voyage})` : ""}` : "The vessel"} is expected to arrive on or about ${d.etaDate} at ${d.destination ?? "the port of discharge"}.`
          : undefined,
      // The same list the import desk's arrival mail sends (lib/arrivalNotice),
      // for the way the house bill is released and whether freight is collect.
      lines: (d) => {
        const needs = deliveryNeeds({ release: d.releaseMode ?? null, freightCollect: d.freightTerms === "Collect" });
        return [
          // Not said how it is released: not assumed to need an original.
          d.releaseMode ? needs[0] : "The house B/L as released to you: the original, duly endorsed, or our confirmation of its telex release",
          `${needs[1]}, payable to ${COMPANY.legalName} (PAN ${PAN})`,
          ...(d.freightTerms === "Collect" ? ["A freight certificate on your letterhead, for the assessable value"] : []),
          needs[2],
          needs[3],
        ];
      },
    },
    declaration:
      "Free time runs from discharge; demurrage, detention and storage beyond it are at the carrier's and the CFS's tariff. Duties, taxes, port dues, storage and detention are to the consignee's account. Cargo not cleared within thirty days of landing may be sold under section 48 of the Customs Act, 1962.",
  },
  {
    id: "delivery-order",
    title: "DELIVERY ORDER",
    shortName: "Delivery order",
    purpose: "Authorises the terminal to release the container to the consignee.",
    issuer: "desk",
    numberPrefix: "DO",
    requires: ["blNumber", "consigneeName", "containerId", "destination"],
    parties: true,
    sections: [
      {
        title: "Release",
        rows: [
          { label: "B/L number", value: (d) => d.blNumber },
          { label: "Master B/L", value: (d) => d.masterBlNumber, optional: true },
          { label: "Release to", value: (d) => d.consigneeName },
          { label: "Vessel / voyage", value: vesselVoyage, optional: true },
          { label: "IGM", value: igm, optional: true },
          { label: "Container number", value: (d) => d.containerId },
          { label: "Container type", value: (d) => d.containerType },
          { label: "Place of delivery", value: (d) => d.destination },
          { label: "Delivery from (CFS)", value: (d) => d.cfsName, optional: true },
        ],
      },
      { title: "Cargo", rows: CARGO_ROWS },
    ],
    declaration:
      "Please release the container described above to the named party against surrender of this order. Valid only when all charges are settled and customs clearance is complete.",
  },

  // ------------------------------------------------------------------ closing
  {
    id: "commercial-invoice",
    title: "COMMERCIAL INVOICE & PACKING LIST",
    shortName: "Commercial invoice & packing list",
    purpose: "The customs-facing invoice and pack detail for the goods themselves.",
    issuer: "desk",
    numberPrefix: "INV",
    requires: [
      "shipperName",
      "shipperGstinIec",
      "consigneeName",
      "consigneeAddress",
      "consigneeCountry",
      "hsCode",
      "invoiceValueInr",
      "packageCount",
      "packageType",
      "netWeightKg",
      "grossWeightKg",
      "incoterm",
      "paymentTerms",
    ],
    parties: true,
    sections: [
      { title: "Shipment details", rows: ROUTE_ROWS },
      { title: "Goods", rows: CARGO_ROWS },
      {
        title: "Value & terms",
        rows: [
          { label: "Declared invoice value", value: (d) => money(d, d.invoiceValueInr) },
          { label: "Freight rate (agreed)", value: (d) => money(d, d.freightAmountInr) },
          { label: "Incoterm", value: (d) => d.incoterm },
          { label: "Payment terms", value: (d) => d.paymentTerms },
          { label: "Letter of credit", value: (d) => yesNo(d.letterOfCredit) },
        ],
      },
    ],
  },
  {
    id: "freight-invoice",
    title: "FREIGHT INVOICE",
    shortName: "Freight invoice",
    purpose: "What the customer owes us for the forwarding service.",
    issuer: "desk",
    numberPrefix: "FI",
    requires: ["origin", "destination"],
    // The freight as one figure, or the charges line by line with a rate on each.
    check: (d) => (d.charges?.length ? chargesOutstanding(d) : d.freightAmountInr === undefined ? [labelFor("freightAmountInr")] : []),
    parties: false,
    sections: [
      {
        title: "Billed to",
        rows: [
          { label: "Customer", value: (d) => d.company ?? d.customerName },
          { label: "GSTIN / IEC", value: (d) => d.shipperGstinIec },
          { label: "Contact", value: (d) => d.phone },
        ],
      },
      {
        title: "Shipment",
        rows: [
          { label: "Route", value: route },
          { label: "B/L number", value: (d) => d.blNumber },
          { label: "Container", value: (d) => d.containerType },
          // Itemised, the lines below say it; the one figure as well would be counting it twice.
          { label: "Ocean freight", value: (d) => (d.charges?.length ? undefined : money(d, d.freightAmountInr)), optional: true },
          { label: "Payment terms", value: (d) => d.paymentTerms },
        ],
      },
    ],
    charges: { title: "Charges" },
    declaration:
      "Payable per the terms stated. Local charges, duties and taxes at destination are payable by the consignee unless the Incoterm provides otherwise.",
  },
  {
    id: "proof-of-delivery",
    title: "PROOF OF DELIVERY",
    shortName: "Proof of delivery",
    purpose: "Signed record that the consignee received the cargo.",
    issuer: "desk",
    numberPrefix: "POD",
    requires: ["blNumber", "consigneeName", "destination"],
    parties: true,
    sections: [
      {
        title: "Delivery",
        rows: [
          { label: "B/L number", value: (d) => d.blNumber },
          { label: "Delivered to", value: (d) => d.consigneeName },
          { label: "Place of delivery", value: (d) => d.destination },
          { label: "Container number", value: (d) => d.containerId },
          // Filled in at the point of delivery, never in advance: no record sets
          // these, only a person typing them off the signed copy (Manual documents).
          { label: "Date delivered", value: (d) => d.deliveredOn },
          { label: "Received by (name)", value: (d) => d.receivedBy },
        ],
      },
      { title: "Cargo delivered", rows: CARGO_ROWS },
    ],
    declaration:
      "Received the cargo described above in apparent good order and condition, save for any exception noted below. Signature acknowledges delivery only, not the condition of the contents of sealed packages.",
  },
];

export const documentSpec = (id: string) => DOCUMENTS.find((d) => d.id === id);
