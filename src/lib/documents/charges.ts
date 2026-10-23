import type { ChargeLine, DocumentData } from "./types";
import { COMPANY } from "../company";
import { STATES } from "../../services/charges";

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
// Currencies
// ---------------------------------------------------------------------------

/**
 * What a charge line can be in. Each line names its own: ocean freight comes
 * in dollars, a delivery order in rupees, a European agent's handling in
 * euros, and all of it is one invoice. The invoice foots in rupees, at a rate
 * of exchange given once for each foreign currency on it.
 */
export const INVOICE_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "CNY", "JPY", "HKD", "AUD", "SAR"];

export const CURRENCY_NAME: Record<string, string> = {
  INR: "Indian rupee",
  USD: "US dollar",
  EUR: "Euro",
  GBP: "British pound",
  AED: "UAE dirham",
  SGD: "Singapore dollar",
  CNY: "Chinese yuan",
  JPY: "Japanese yen",
  HKD: "Hong Kong dollar",
  AUD: "Australian dollar",
  SAR: "Saudi riyal",
};

/** What a charge is usually billed in: the carrier's freight and surcharges in dollars, the rest in rupees. */
export const usualCurrency = (h: InvoiceChargeHead | undefined) => (h?.group === "freight" && h.label !== "Air freight") || h?.group === "surcharge" ? "USD" : "INR";

export const lineCurrency = (l: ChargeLine) => (l.currency || "INR").toUpperCase();

/** Rupees to one unit of a currency on this invoice: one for rupees, the rate given for the rest, or undefined until it is. */
export function rateOfExchange(d: DocumentData, currency: string): number | undefined {
  if (currency === "INR") return 1;
  const r = d.exchangeRates?.[currency];
  return r && r > 0 ? r : undefined;
}

/** The foreign currencies the lines are in, in the order they first appear. */
export const foreignCurrencies = (lines: ChargeLine[]) => [...new Set(lines.map(lineCurrency).filter((c) => c !== "INR"))];

// ---------------------------------------------------------------------------
// The sums
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A line's amount before tax, in its own currency, once it has a rate; a line with no quantity typed is one of it. */
export function lineAmount(l: ChargeLine): number | undefined {
  if (l.rate === undefined) return undefined;
  return round2((l.quantity ?? 1) * l.rate);
}

/** The same in rupees, at the invoice's rate of exchange for the line's currency; undefined until both are known. */
export function lineInr(l: ChargeLine, d: DocumentData): number | undefined {
  const amount = lineAmount(l);
  const roe = rateOfExchange(d, lineCurrency(l));
  return amount === undefined || roe === undefined ? undefined : round2(amount * roe);
}

/** A line's figures in rupees: its value before tax, the tax on it as charged, and the two together. */
export interface TaxSums {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

/**
 * GST on the line, in rupees, charged on its rupee value as an Indian tax
 * invoice states it: central and state tax at half the rate each within the
 * state, integrated tax at the whole rate across it (5% on 3,441.90 is 86.05
 * and 86.05). Undefined until the line has a rupee value.
 */
export function lineTax(l: ChargeLine, d: DocumentData): TaxSums | undefined {
  const taxable = lineInr(l, d);
  if (taxable === undefined) return undefined;
  const r = l.gstPercent ?? 0;
  const half = round2((taxable * r) / 200);
  const [cgst, sgst, igst] = !r ? [0, 0, 0] : interState(d) ? [0, 0, round2((taxable * r) / 100)] : [half, half, 0];
  return { taxable, cgst, sgst, igst, total: round2(taxable + cgst + sgst + igst) };
}

/** Lines' figures added up, as the columns are; undefined while any of them has no rupee value. */
function added(lines: ChargeLine[], d: DocumentData): TaxSums | undefined {
  const each = lines.map((l) => lineTax(l, d));
  if (!each.length || each.some((t) => t === undefined)) return undefined;
  const sum = (k: keyof TaxSums) => round2(each.reduce((t, x) => t + x![k], 0));
  return { taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), total: sum("total") };
}

/** The invoice's totals in rupees, or undefined while any line has no rate or no rate of exchange: a total of some of it is not the total. */
export const chargeTotals = (lines: ChargeLine[], d: DocumentData) => added(lines, d);

/**
 * The tax summarised under the charges, as a GST invoice sets it out: a line
 * per SAC and rate, in the order the charges first name them, with its
 * taxable value and the tax on it. Undefined while the totals are.
 */
export function taxSummary(lines: ChargeLine[], d: DocumentData): Array<TaxSums & { sac: string; rate: number }> | undefined {
  if (!added(lines, d)) return undefined;
  const groups = new Map<string, ChargeLine[]>();
  for (const l of lines) {
    const key = `${l.sac ?? ""}|${l.gstPercent ?? 0}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return [...groups.values()].map((g) => ({ sac: g[0].sac ?? "", rate: g[0].gstPercent ?? 0, ...added(g, d)! }));
}

/** What an itemised invoice still needs: a rate on every line, and a rate of exchange for every foreign currency on it. */
export function chargesOutstanding(d: DocumentData): string[] {
  const lines = d.charges ?? [];
  return [
    ...lines.filter((l) => l.rate === undefined).map((l) => `Rate for ${l.charge}`),
    ...foreignCurrencies(lines)
      .filter((c) => rateOfExchange(d, c) === undefined)
      .map((c) => `Rate of exchange for ${c}`),
  ];
}

// ---------------------------------------------------------------------------
// Money, as the document prints it
// ---------------------------------------------------------------------------

/** A sum in the document's currency: "Rs. 1,25,000" from a job, "USD 1,250.5" where dollars were chosen. */
export function docMoney(d: DocumentData, n?: number): string | undefined {
  if (n === undefined) return undefined;
  return d.currency === "USD" ? `USD ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `Rs. ${n.toLocaleString("en-IN")}`;
}

/** A rupee figure in a column of the charges table: always to the paisa, so the column lines up. */
export const rupeeFigure = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A rate of exchange as it is printed: "1 USD = INR 83.50". */
export const roeFigure = (currency: string, roe: number) =>
  `1 ${currency} = INR ${roe.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

// ---------------------------------------------------------------------------
// Who is billed, and whether the GST is integrated
// ---------------------------------------------------------------------------

/** A GSTIN as GST writes one: two digits of state, the PAN, the entity, Z, a check character. */
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/** The GSTIN, written one way, or null for anything that is not one (an IEC, a foreign tax number). */
export const gstinOf = (g?: string) => {
  const t = (g ?? "").replace(/\s+/g, "").toUpperCase();
  return GSTIN.test(t) ? t : null;
};

/** "33 (Tamil Nadu)", from a GSTIN's first two digits; nothing for a number that is not a GSTIN. */
export const stateOf = (tax?: string) => {
  const g = gstinOf(tax);
  if (!g) return undefined;
  const name = STATES.find((s) => s.code === g.slice(0, 2))?.name;
  return name ? `${g.slice(0, 2)} (${name})` : g.slice(0, 2);
};

/** The party an invoice is addressed to (`billTo`): the consignee unless another was chosen. */
export function billed(d: DocumentData): { name?: string; address?: string; tax?: string } {
  if (d.billTo === "shipper") return { name: d.shipperName, address: d.shipperAddress, tax: d.shipperGstinIec };
  if (d.billTo === "notify") return { name: d.notifyName, address: d.notifyAddress, tax: d.notifyGstin };
  return { name: d.consigneeName, address: [d.consigneeAddress, d.consigneeCountry].filter(Boolean).join(", ") || undefined, tax: d.consigneeGstin };
}

/**
 * Whether the GST is integrated: the party billed is registered in another
 * state than ours. Within the state — and where the party billed has no
 * GSTIN to say otherwise — it is central and state tax, half each.
 */
export function interState(d: DocumentData): boolean {
  const g = gstinOf(billed(d).tax);
  return Boolean(g) && g!.slice(0, 2) !== COMPANY.gstin.slice(0, 2);
}

/** A rate as the invoice prints it: "2.5%", "18%". */
export const percent = (r: number) => `${r.toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;

// ---------------------------------------------------------------------------
// The total in words
// ---------------------------------------------------------------------------

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const belowHundred = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`);

/** A whole number in words, counted the Indian way: crore, lakh, thousand, hundred. */
function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(`${parts.length ? "and " : ""}${belowHundred(rest)}`);
  return parts.join(" ");
}

/** A rupee total as an invoice writes it out: "Indian Rupees Three Thousand Three Hundred and Ninety-Three and Seventy-Six Paise Only". */
export function rupeesInWords(n: number): string {
  const paisa = Math.round(Math.abs(n) * 100);
  const rupees = Math.floor(paisa / 100);
  const paise = paisa % 100;
  return `Indian Rupees ${indianWords(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ""} Only`;
}
