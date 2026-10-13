import type { ChargeLine, DocumentData } from "./types";

/**
 * The charges a freight invoice is itemised in, and the sums on it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE LIST IS
 *
 * The heads an Indian forwarder's invoice carries, by where in the move they
 * arise: the freight and the carrier's surcharges on it, the origin's local
 * charges, the LCL warehouse's, the destination's, an air shipment's, and the
 * rest. It is what the desk picks from; a charge that is not on it is typed in
 * as it is, and prints as typed.
 *
 * THE SAC CODES ARE A STARTING POINT, NOT AN AUTHORITY
 *
 * As in services/charges.ts: the classification is between the desk and its
 * auditor. A code typed on the line prints instead of the list's.
 * ---------------------------------------------------------------------------
 */

export type ChargeGroup = "freight" | "surcharge" | "origin" | "lcl" | "destination" | "air" | "other";

export const CHARGE_GROUP_LABEL: Record<ChargeGroup, string> = {
  freight: "Freight",
  surcharge: "Freight surcharges",
  origin: "Origin charges",
  lcl: "LCL / CFS",
  destination: "Destination charges",
  air: "Air",
  other: "Other",
};

export interface InvoiceChargeHead {
  label: string;
  sac: string;
  /** What it is usually charged per. */
  basis: string;
  group: ChargeGroup;
}

const head = (group: ChargeGroup, label: string, sac: string, basis: string): InvoiceChargeHead => ({ label, sac, basis, group });

export const INVOICE_CHARGES: InvoiceChargeHead[] = [
  head("freight", "Ocean freight", "996521", "Container"),
  head("freight", "Air freight", "996531", "Kg"),

  // The carrier's, passed on as the carrier bills them: they move with the freight.
  head("surcharge", "Bunker adjustment factor (BAF)", "996521", "Container"),
  head("surcharge", "Low sulphur surcharge (LSS)", "996521", "Container"),
  head("surcharge", "Currency adjustment factor (CAF)", "996521", "Container"),
  head("surcharge", "Peak season surcharge (PSS)", "996521", "Container"),
  head("surcharge", "General rate increase (GRI)", "996521", "Container"),
  head("surcharge", "Emergency / war risk surcharge", "996521", "Container"),
  head("surcharge", "Congestion surcharge", "996521", "Container"),
  head("surcharge", "Hazardous (DG) surcharge", "996521", "Container"),

  head("origin", "Origin THC", "996719", "Container"),
  head("origin", "B/L fee", "996799", "B/L"),
  head("origin", "Documentation fee", "996799", "Shipment"),
  head("origin", "Container seal", "996719", "Container"),
  head("origin", "VGM filing", "996799", "Container"),
  head("origin", "Mandatory user charge (MUC)", "996719", "Container"),
  head("origin", "ISPS charge", "996719", "Container"),
  head("origin", "ENS / AMS / ACI filing", "996799", "B/L"),
  head("origin", "Customs clearance", "996799", "Shipment"),
  head("origin", "Pickup / ex-works haulage", "996511", "Trip"),
  head("origin", "Fumigation", "998531", "Shipment"),
  head("origin", "Palletisation / labelling", "998540", "Shipment"),

  // An LCL shipment is charged by the revenue ton (W/M): the greater of its CBM and its tonnes.
  head("lcl", "CFS charges", "996719", "W/M"),
  head("lcl", "LCL THC", "996719", "W/M"),
  head("lcl", "Consolidation / stuffing", "996719", "W/M"),
  head("lcl", "Carting", "996719", "W/M"),
  head("lcl", "Destuffing", "996719", "W/M"),

  head("destination", "Destination THC", "996719", "Container"),
  head("destination", "Delivery order fee", "996799", "B/L"),
  head("destination", "IGM filing", "996799", "B/L"),
  head("destination", "Container cleaning", "996719", "Container"),
  head("destination", "Detention & demurrage", "996719", "Container"),
  head("destination", "Ground rent / storage", "996729", "Container"),
  head("destination", "Examination / inspection", "996719", "Shipment"),
  head("destination", "Delivery haulage", "996511", "Trip"),

  head("air", "Fuel surcharge (FSC)", "996531", "Kg"),
  head("air", "Security surcharge (SSC)", "996531", "Kg"),
  head("air", "Airport terminal handling", "996719", "Kg"),
  head("air", "X-ray screening", "996719", "Kg"),
  head("air", "AWB fee", "996799", "AWB"),

  head("other", "Cargo insurance", "997136", "Shipment"),
  head("other", "Courier", "996812", "Shipment"),
  head("other", "Telex release / B/L surrender", "996799", "B/L"),
  head("other", "Amendment / correction fee", "996799", "Lumpsum"),
  head("other", "Agency / service fee", "996713", "Shipment"),
  head("other", "Other charges", "996799", "Lumpsum"),
];

export const INVOICE_BASES = ["Container", "W/M", "CBM", "Kg", "B/L", "AWB", "Shipment", "Trip", "Lumpsum"];

export const chargeHead = (label: string) => {
  const l = label.trim().toLowerCase();
  return INVOICE_CHARGES.find((h) => h.label.toLowerCase() === l);
};

/** The heads a shipment of each kind is usually invoiced in: added together, as a starting point to price. */
export const CHARGE_SETS: Array<{ label: string; charges: string[] }> = [
  { label: "FCL export", charges: ["Ocean freight", "Origin THC", "B/L fee", "Container seal", "VGM filing", "Customs clearance"] },
  { label: "LCL export", charges: ["Ocean freight", "CFS charges", "LCL THC", "Consolidation / stuffing", "B/L fee", "Customs clearance"] },
  { label: "FCL import", charges: ["Delivery order fee", "Destination THC", "Container cleaning", "Customs clearance", "Delivery haulage"] },
  { label: "LCL import", charges: ["Delivery order fee", "CFS charges", "Destuffing", "IGM filing", "Customs clearance"] },
  { label: "Air export", charges: ["Air freight", "Fuel surcharge (FSC)", "Security surcharge (SSC)", "X-ray screening", "AWB fee", "Customs clearance"] },
];

// ---------------------------------------------------------------------------
// The sums
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A line's amount before tax, once it has a rate; a line with no quantity typed is one of it. */
export function lineAmount(l: ChargeLine): number | undefined {
  if (l.rate === undefined) return undefined;
  return round2((l.quantity ?? 1) * l.rate);
}

export function lineGst(l: ChargeLine): number | undefined {
  const amount = lineAmount(l);
  if (amount === undefined) return undefined;
  return l.gstPercent ? round2((amount * l.gstPercent) / 100) : 0;
}

/** The invoice's totals, or undefined while any line has no rate: a total of some of it is not the total. */
export function chargeTotals(lines: ChargeLine[]): { taxable: number; gst: number; total: number } | undefined {
  if (!lines.length || lines.some((l) => l.rate === undefined)) return undefined;
  const taxable = round2(lines.reduce((t, l) => t + lineAmount(l)!, 0));
  const gst = round2(lines.reduce((t, l) => t + lineGst(l)!, 0));
  return { taxable, gst, total: round2(taxable + gst) };
}

/** What an itemised invoice still needs: a rate on every line. */
export function chargesOutstanding(d: DocumentData): string[] {
  return (d.charges ?? []).filter((l) => l.rate === undefined).map((l) => `Rate for ${l.charge}`);
}

// ---------------------------------------------------------------------------
// Money, as the document prints it
// ---------------------------------------------------------------------------

/** A sum in the document's currency: "Rs. 1,25,000" from a job, "USD 1,250.5" where dollars were chosen. */
export function docMoney(d: DocumentData, n?: number): string | undefined {
  if (n === undefined) return undefined;
  return d.currency === "USD" ? `USD ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `Rs. ${n.toLocaleString("en-IN")}`;
}

/** A figure in a column of the charges table: always to the cent or paisa, so the column lines up. */
export function docFigure(d: DocumentData, n: number): string {
  return n.toLocaleString(d.currency === "USD" ? "en-US" : "en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The currency's name as a column heading says it. */
export const currencyCode = (d: DocumentData) => (d.currency === "USD" ? "USD" : "INR");
