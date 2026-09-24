import type { DocSpec, DocumentData } from "./types";

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

const inr = (n?: number) => (n !== undefined ? `Rs. ${n.toLocaleString("en-IN")}` : undefined);
const kg = (n?: number) => (n !== undefined ? `${n.toLocaleString("en-IN")} kg` : undefined);
const yesNo = (b?: boolean) => (b === undefined ? undefined : b ? "Yes" : "No");
const packages = (d: DocumentData) =>
  d.packageCount !== undefined ? `${d.packageCount} x ${d.packageType ?? "units"}` : undefined;
const route = (d: DocumentData) =>
  d.origin && d.destination ? `${d.origin} to ${d.destination}` : undefined;

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
          { label: "Freight rate", value: (d) => inr(d.freightAmountInr) },
          { label: "Rate requested by customer", value: (d) => inr(d.targetPriceInr) },
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
          { label: "Agreed freight rate", value: (d) => inr(d.freightAmountInr) },
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
          { label: "Method used", value: () => undefined },
          { label: "Weighbridge / facility", value: () => undefined },
          { label: "Date weighed", value: () => undefined },
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
          { label: "Freight", value: (d) => inr(d.freightAmountInr) },
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
    id: "arrival-notice",
    title: "ARRIVAL NOTICE",
    shortName: "Arrival notice",
    purpose: "Tells the consignee the cargo has arrived and what is owed before release.",
    issuer: "desk",
    numberPrefix: "AN",
    requires: ["blNumber", "consigneeName", "destination", "etaDate"],
    parties: true,
    sections: [
      {
        title: "Arrival",
        rows: [
          { label: "B/L number", value: (d) => d.blNumber },
          { label: "Master B/L", value: (d) => d.masterBlNumber, optional: true },
          { label: "Port of discharge", value: (d) => d.destination },
          { label: "Vessel ETA", value: (d) => d.etaDate },
          { label: "Container number", value: (d) => d.containerId },
          { label: "Container type", value: (d) => d.containerType },
        ],
      },
      { title: "Cargo", rows: CARGO_ROWS },
      {
        title: "Payable before release",
        rows: [{ label: "Freight and charges", value: (d) => inr(d.freightAmountInr) }],
      },
    ],
    declaration:
      "Free time runs from discharge. Demurrage and detention accrue at the carrier's tariff once free time expires. Please arrange clearance and collection promptly.",
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
          { label: "Container number", value: (d) => d.containerId },
          { label: "Container type", value: (d) => d.containerType },
          { label: "Place of delivery", value: (d) => d.destination },
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
          { label: "Declared invoice value", value: (d) => inr(d.invoiceValueInr) },
          { label: "Freight rate (agreed)", value: (d) => inr(d.freightAmountInr) },
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
    requires: ["freightAmountInr", "origin", "destination"],
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
        title: "Charges",
        rows: [
          { label: "Route", value: route },
          { label: "B/L number", value: (d) => d.blNumber },
          { label: "Container", value: (d) => d.containerType },
          { label: "Ocean freight", value: (d) => inr(d.freightAmountInr) },
          { label: "Payment terms", value: (d) => d.paymentTerms },
        ],
      },
    ],
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
          // Filled in at the point of delivery, never in advance.
          { label: "Date delivered", value: () => undefined },
          { label: "Received by (name)", value: () => undefined },
        ],
      },
      { title: "Cargo delivered", rows: CARGO_ROWS },
    ],
    declaration:
      "Received the cargo described above in apparent good order and condition, save for any exception noted below. Signature acknowledges delivery only, not the condition of the contents of sealed packages.",
  },
];

export const documentSpec = (id: string) => DOCUMENTS.find((d) => d.id === id);
