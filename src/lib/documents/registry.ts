import type { DocSpec, DocumentData } from "./types";
import { COMPANY } from "../company";
import { deliveryNeeds } from "../arrivalNotice";
import { chargesOutstanding, docMoney, isFreightCharge, lineAmount, lineCurrency } from "./charges";
import { labelFor } from "./data";
import { issuedToday } from "./letterhead";
import { PROFORMA_INVOICE, TAX_INVOICE } from "./invoice";

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
/** A party as a closed document prints it: the name, then what goes under it, a line each; nothing without the name. */
const party = (name?: string, ...under: Array<string | undefined>) => (name ? [name, ...under].filter(Boolean).join("\n") : undefined);
/** A party's GSTIN line, with the state it is registered in. */
const gstinLine = (g?: string) => (g ? `GSTIN: ${gstin(g)}` : undefined);
/** The packages as a line of a table prints them: "120 ROLLS". */
const pkgs = (d: DocumentData) => (d.packageCount !== undefined ? `${d.packageCount} ${d.packageType ?? "PACKAGE(S)"}`.trim() : undefined);
/** The packages of several boxes added up, in their kind where they are all of one. */
const pkgsTotal = (ls: DocumentData[]) => {
  const n = ls.map((l) => l.packageCount);
  if (n.some((x) => x === undefined)) return undefined;
  const kinds = new Set(ls.map((l) => l.packageType ?? "PACKAGE(S)"));
  return `${n.reduce((t, x) => t! + x!, 0)} ${kinds.size === 1 ? [...kinds][0] : "PACKAGE(S)"}`;
};
/** A box as a table prints it: its number, then its size and type, "TWCU8075142 - 40HC". */
const box = (d: DocumentData) => (d.containerId ? [d.containerId, d.containerType].filter(Boolean).join(" - ") : undefined);
/** The job's boxes, a record each with the box's own figures over the job's; none, the one the fields describe. */
const boxes = (d: DocumentData) => d.containers?.map((c) => ({ ...d, ...c }));
/** Where the freight was carried from and to, as a freight certificate heads its figures. */
const carriedFrom = (d: DocumentData) => d.portOfLoading ?? d.origin;
const carriedTo = (d: DocumentData) => d.finalDestination ?? d.destination;
/** A figure in its currency, as a certificate prints it. */
const amount = (n?: number) => (n === undefined ? undefined : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** The one freight line a certificate's record carries (freightLines), when it carries one. */
const freightLine = (d: DocumentData) => (d.charges?.length === 1 && isFreightCharge(d.charges[0]) ? d.charges[0] : undefined);
/** The freight, a record a line: the freight lines of the charges, or — not itemised — the one freight figure. */
const freightLines = (d: DocumentData) => {
  const lines = (d.charges ?? []).filter(isFreightCharge);
  return lines.length ? lines.map((l) => ({ ...d, charges: [l] })) : [{ ...d, charges: [] }];
};

/**
 * The freight certificate, the arrival notice's second page, as the line's
 * (HCSE2609X113) has it: the shipment it is for, label and value, then the
 * freight ruled — what the consignee's CHA declares as the freight in the
 * assessable value.
 */
const FREIGHT_CERTIFICATE: DocSpec = {
  id: "freight-certificate",
  title: "FREIGHT CERTIFICATE",
  shortName: "Freight certificate",
  purpose: "The freight charged on the shipment, for its assessable value at customs.",
  issuer: "desk",
  numberPrefix: "FC",
  requires: [],
  parties: false,
  layout: "order",
  sections: [
    {
      title: "Shipment",
      place: "below",
      rows: [
        { label: "Consignee", value: (d) => d.consigneeName, bold: true },
        { label: "MBL no", value: (d) => numberAndDate(d.masterBlNumber, d.masterBlDate), optional: true },
        { label: "HBL no", value: (d) => numberAndDate(d.blNumber, d.blDate) },
        { label: "Container no", value: (d) => d.containerId },
        { label: "Gross weight", value: (d) => (d.grossWeightKg !== undefined ? `${three(d.grossWeightKg)} KGS` : undefined) },
        { label: "No of pkgs", value: pkgs },
        { label: "Port of loading", value: carriedFrom },
        { label: "Port of discharge", value: (d) => d.destination },
        { label: "Place of delivery", value: carriedTo },
        { label: "Freight from", value: (d) => (carriedFrom(d) && carriedTo(d) ? `${carriedFrom(d)} to ${carriedTo(d)}` : undefined) },
      ],
    },
    {
      title: "Freight",
      place: "table",
      each: freightLines,
      rows: [
        { label: "Particular", value: (d) => freightLine(d)?.charge ?? "Ocean freight", width: 3 },
        {
          label: "Currency",
          value: (d) => {
            const l = freightLine(d);
            return l ? lineCurrency(l) : d.freightAmountInr !== undefined ? (d.currency ?? "INR") : undefined;
          },
          width: 1,
        },
        {
          label: "Amount",
          value: (d) => {
            const l = freightLine(d);
            return amount(l ? lineAmount(l) : d.freightAmountInr);
          },
          width: 1.4,
          align: "right",
          // Added up only in one currency; across two, the lines say it.
          total: (ls) => {
            const lines = ls.map(freightLine);
            if (new Set(lines.map((l) => (l ? lineCurrency(l) : ""))).size !== 1) return "";
            const sums = lines.map((l) => (l ? lineAmount(l) : undefined));
            return sums.some((n) => n === undefined) ? undefined : amount(sums.reduce((t: number, n) => t + n!, 0));
          },
        },
      ],
    },
  ],
  declaration: "Certified that the freight charged for the carriage of the consignment described above is as stated.",
};

/** Weights or measures added up as a manifest prints them; nothing while any is unknown. */
const sum = (ns: Array<number | undefined>) => (ns.some((n) => n === undefined) ? undefined : three(ns.reduce((t: number, n) => t + n!, 0)));
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
      The cargo arrival notice (CAN), as the line's (HCSE2609X113) is set out
      and closed as the tax invoice and the DO are: no boxes, its notice on
      the one page, the freight certificate on a second.
      ------------------------------------------------------------------------
      Who it concerns down the left — the notify party (the consignee's
      broker), the consignee and the shipper, each with address and GSTIN —
      and the job, its IGM and the shipment down the right; the cargo ruled
      across, a line a box; then what to do to take delivery, our bank account
      beside the signature.

      Most of the right is optional: a job's notice prints what the job holds
      and leaves the rest out, rather than a column of TBD.
    */
    id: "arrival-notice",
    title: "CARGO ARRIVAL NOTICE",
    shortName: "Arrival notice",
    purpose: "Tells the consignee the cargo is arriving, and what to bring and pay to take delivery.",
    issuer: "desk",
    numberPrefix: "AN",
    requires: ["blNumber", "consigneeName", "destination", "etaDate"],
    parties: false,
    layout: "order",
    sections: [
      {
        title: "Notify party",
        place: "left",
        rows: [{ label: "Notify party", value: (d) => party(d.notifyName, d.notifyAddress, gstinLine(d.notifyGstin)), bold: true, optional: true }],
      },
      {
        title: "Consignee",
        place: "left",
        rows: [{ label: "Consignee", value: (d) => party(d.consigneeName, d.consigneeAddress, gstinLine(d.consigneeGstin)), bold: true }],
      },
      {
        title: "Shipper",
        place: "left",
        rows: [
          { label: "Shipper", value: (d) => party(d.shipperName, d.shipperAddress), bold: true },
          { label: "Sales ref", value: (d) => d.salesRef, optional: true },
        ],
      },
      {
        title: "Job",
        place: "right",
        rows: [
          { label: "Job ref no", value: (d) => (d.reference === "TBD" ? undefined : numberAndDate(d.reference, d.jobDate)), bold: true },
          { label: "Invoice ref", value: (d) => d.invoiceRef, optional: true },
          { label: "IGM no / date", value: (d) => numberAndDate(d.igmNumber, d.igmDate), optional: true },
          { label: "From", value: (d) => d.originAgent, optional: true },
        ],
      },
      {
        title: "Shipment details",
        place: "right",
        rows: [
          { label: "PO no", value: (d) => d.poNumber, optional: true },
          { label: "HBL no / date", value: (d) => numberAndDate(d.blNumber, d.blDate) },
          { label: "Vessel / voyage", value: vesselVoyage, optional: true },
          { label: "Booking no", value: (d) => d.bookingNumber, optional: true },
          { label: "Service", value: (d) => d.serviceType, optional: true },
          { label: "OBL no / date", value: (d) => numberAndDate(d.masterBlNumber, d.masterBlDate), optional: true },
          { label: "Origin", value: (d) => d.origin, optional: true },
          { label: "Port of loading", value: (d) => d.portOfLoading, optional: true },
          { label: "Port of discharge", value: (d) => d.destination },
          { label: "ETA", value: (d) => d.etaDate },
          { label: "Final destination", value: (d) => d.finalDestination, optional: true },
          { label: "ETA (final dest.)", value: (d) => d.finalEtaDate, optional: true },
          { label: "Warehouse (CFS)", value: (d) => party(d.cfsName, d.cfsAddress), optional: true },
          { label: "ETA (CFS)", value: (d) => d.cfsEtaDate, optional: true },
          { label: "Auth. B/L", value: (d) => numberAndDate(d.authBlNumber, d.authBlDate), optional: true },
          { label: "Freight", value: (d) => d.freightTerms, optional: true },
          { label: "Item no", value: (d) => d.igmItemNo, optional: true },
          { label: "Sub item no", value: (d) => d.igmSubItemNo, optional: true },
          { label: "Carrier", value: (d) => d.carrier, optional: true },
          { label: "Free time", value: (d) => d.freeTimeText, optional: true },
        ],
      },
      {
        // A line a box; the marks and the description, the bill's, on the first.
        title: "Cargo",
        place: "table",
        each: boxes,
        rows: [
          { label: "Marks & numbers", value: (d) => d.marksNumbers, width: 1.5, optional: true, firstOnly: true },
          { label: "Description", value: (d) => [d.cargoDescription, d.hsCode && `HS ${d.hsCode}`].filter(Boolean).join("\n") || undefined, width: 2, firstOnly: true },
          { label: "Container", value: box, width: 1.9 },
          { label: "Seal", value: (d) => d.sealNumber, width: 1.45, optional: true },
          { label: "Pkgs", value: pkgs, width: 1.1, total: pkgsTotal },
          { label: "Weight (kgs)", value: (d) => three(d.grossWeightKg), width: 1.1, align: "right", total: (ls) => sum(ls.map((l) => l.grossWeightKg)) },
          { label: "Volume (CBM)", value: (d) => three(d.volumeCbm), width: 0.95, align: "right", optional: true, total: (ls) => sum(ls.map((l) => l.volumeCbm)) },
        ],
      },
    ],
    notes: {
      title: "",
      lead: (d) =>
        d.etaDate
          ? `${d.vessel ? `The vessel ${d.vessel}${d.voyage ? ` (voyage ${d.voyage})` : ""}` : "The vessel"} is expected to arrive on or about ${d.etaDate} at ${d.destination ?? "the port of discharge"}.`
          : undefined,
      // As the line's notice words it; the release as the house bill is released (lib/arrivalNotice).
      lines: (d) => {
        const needs = deliveryNeeds({ release: d.releaseMode ?? null, freightCollect: d.freightTerms === "Collect" });
        return [
          d.releaseMode === "original" || !d.releaseMode
            ? `Kindly submit the original bill of lading, duly endorsed${d.releaseMode ? "" : ", or our confirmation of its telex release"}, to release the shipment.`
            : `${needs[0]}.`,
          `Payment of ${d.freightTerms === "Collect" ? "the freight (collect) and " : ""}our delivery order charges should be by NEFT / RTGS to the account below, or by demand draft or pay order favouring ${COMPANY.legalName} (PAN ${PAN}).`,
          "We wish to advise you that your consignment is coming forward as per the subject vessel. We send this notice so that you can make all arrangements for speedy clearance of the cargo on its arrival, and avoid port demurrage and container detention charges. The delivery order is issued from our office against the release above, after payment of the relevant charges.",
          "Please send your KYC documents and an authorisation letter for your customs broker (CHA), who files the Bill of Entry once the IGM is filed. Our freight certificate, for the assessable value, is on the next page.",
          "We thank you for using our services, and assure you of our best attention at all times.",
        ];
      },
    },
    bank: true,
    declaration:
      "Cargo remaining undelivered for 30 days from the date of arrival will be listed for auction and duly auctioned on completion of Customs and CFS formalities (section 48 of the Customs Act, 1962). Free time runs from discharge; demurrage, detention and storage beyond it are at the carrier's and the CFS's tariff, and duties, taxes and port dues are to the consignee's account.",
    appendix: FREIGHT_CERTIFICATE,
  },
  {
    /*
      The delivery order, set out as the line's (QDWJ26093202) is and closed
      as the tax invoice is: no boxes, one page (layout "order").
      ------------------------------------------------------------------------
      To the CFS's manager, with the party to deliver to, the consignee, its
      IEC, the notify party and the CHA down the left; the order's number,
      date and validity, then the vessel, the two bills, the ports, the ETA,
      the IGM line and the TSA down the right. The boxes ruled across, a line
      each; the marks and the description under them; the signature; and at
      the foot, that it is subject to the relative B/L.
    */
    id: "delivery-order",
    title: "DELIVERY ORDER",
    shortName: "Delivery order",
    purpose: "Authorises the CFS to deliver the cargo to the consignee, or to its CHA.",
    issuer: "desk",
    numberPrefix: "DO",
    requires: ["blNumber", "consigneeName", "containerId", "destination"],
    parties: false,
    layout: "order",
    sections: [
      {
        title: "Attention",
        place: "left",
        rows: [
          { label: "Attention to", value: (d) => (d.cfsName ? ["The Manager", d.cfsName, d.cfsAddress].filter(Boolean).join("\n") : undefined) },
        ],
      },
      {
        title: "Deliver to",
        place: "left",
        rows: [
          // The consignee, unless another — its CHA — is named to take it.
          { label: "Please deliver to", value: (d) => d.deliverTo ?? d.consigneeName, bold: true },
          { label: "Consignee", value: (d) => (d.consigneeName ? [d.consigneeName, d.consigneeAddress].filter(Boolean).join("\n") : undefined), bold: true },
          { label: "IEC / type", value: (d) => [d.consigneeIec, d.consigneeIecType].filter(Boolean).join(" / ") || undefined, optional: true },
          { label: "Notify party", value: (d) => d.notifyName, optional: true },
          { label: "CHA", value: (d) => d.chaName, optional: true },
        ],
      },
      {
        title: "Order",
        place: "right",
        rows: [
          { label: "DO number", value: (d) => `DO-${d.documentNumber}`, bold: true },
          { label: "Date", value: (d) => d.doDate ?? issuedToday() },
          { label: "Valid until", value: (d) => d.doValidity, optional: true },
        ],
      },
      {
        title: "Shipment",
        place: "right",
        rows: [
          { label: "Vessel / voyage", value: vesselVoyage },
          { label: "Master B/L", value: (d) => numberAndDate(d.masterBlNumber, d.masterBlDate), optional: true },
          { label: "House B/L", value: (d) => numberAndDate(d.blNumber, d.blDate) },
          { label: "Port of loading", value: (d) => d.portOfLoading ?? d.origin },
          { label: "Port of discharge", value: (d) => d.destination },
          { label: "ETA", value: (d) => d.etaDate },
          { label: "IGM no / date", value: (d) => numberAndDate(d.igmNumber, d.igmDate), optional: true },
          { label: "Item / line no", value: (d) => d.igmItemNo, optional: true },
          { label: "Sub item / line no", value: (d) => d.igmSubItemNo, optional: true },
          { label: "TSA no", value: (d) => d.tsaNumber, optional: true },
          { label: "Unstuff place", value: (d) => d.cfsName, optional: true },
        ],
      },
      {
        // A line per box: the job's boxes (032), or the one the fields describe.
        title: "Containers",
        place: "table",
        each: boxes,
        rows: [
          { label: "Container no", value: box, width: 2.3 },
          { label: "LCL / FCL", value: (d) => d.serviceType, optional: true, width: 0.8 },
          { label: "Unstuff date", value: (d) => d.unstuffDate, optional: true, width: 1.1 },
          { label: "No of pkgs", value: pkgs, width: 1.5, total: pkgsTotal },
          { label: "Weight in kgs", value: (d) => three(d.grossWeightKg), width: 1.1, align: "right", total: (ls) => sum(ls.map((l) => l.grossWeightKg)) },
          { label: "Volume (CBM)", value: (d) => three(d.volumeCbm), optional: true, width: 1, align: "right", total: (ls) => sum(ls.map((l) => l.volumeCbm)) },
        ],
      },
      {
        title: "Cargo",
        place: "below",
        rows: [
          { label: "Marks & Nos", value: (d) => d.marksNumbers },
          { label: "Description", value: (d) => d.cargoDescription },
        ],
      },
    ],
    declaration:
      "Please deliver the cargo described above to the party named, against surrender of this order, once all charges are settled and customs clearance is complete.",
    footnote: "This Delivery Order is subject to the terms and conditions of the relative B/L.",
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
  // The proforma, then the tax invoice: the same paper, laid out as the line's e-invoice (lib/documents/invoice).
  PROFORMA_INVOICE,
  TAX_INVOICE,
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
