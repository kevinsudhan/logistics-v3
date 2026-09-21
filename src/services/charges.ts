/**
 * The charge catalogue, and money as the desk writes it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SPLIT OUT OF billing.ts
 *
 * Because quoting needs it and quoting is not accounts. `QuoteCharges` builds a
 * quotation out of charge heads; it was reaching into the invoicing module for
 * the list, which meant the charge catalogue could not be reasoned about --
 * or switched off -- separately from invoices, payments and receipts.
 *
 * What is here is the part that describes a charge: the heads with their SAC
 * codes, the units and currencies a line can be in, the GST state codes a party
 * carries, and one formatter. What stays in `billing.ts` is everything that
 * raises or reads a document.
 *
 * A quotation has money on it -- that is what a quotation is. The line between
 * the two modules is not "no figures", it is that nothing here issues a tax
 * document or tracks whether it was paid.
 *
 * THE SAC CODES ARE A STARTING POINT, NOT AN AUTHORITY
 *
 * The classification is between the desk and its auditor, and a list baked into
 * a CRM should not be the reason a quotation goes out with the wrong code on it.
 * ---------------------------------------------------------------------------
 */
export type TradeDirection = "export" | "import" | "cross_trade";

export const DIRECTION_LABEL: Record<TradeDirection, string> = {
  export: "Export",
  import: "Import",
  cross_trade: "Cross trade",
};

export interface ChargeHead {
  label: string;
  sac: string;
  unit: string;
  /** Which way the cargo has to be going for this charge to make sense. */
  applies: TradeDirection[] | "any";
}

export const CHARGE_HEADS: ChargeHead[] = [
  { label: "Ocean freight", sac: "996521", unit: "W/M", applies: "any" },
  { label: "Air freight", sac: "996531", unit: "Kg", applies: "any" },
  { label: "Terminal handling charges (THC)", sac: "996719", unit: "Container", applies: "any" },
  { label: "Documentation / B/L fee", sac: "996799", unit: "B/L", applies: "any" },
  { label: "CFS charges", sac: "996719", unit: "Container", applies: "any" },
  { label: "Customs clearance", sac: "996799", unit: "Shipment", applies: "any" },
  { label: "Inland haulage / transport", sac: "996511", unit: "Trip", applies: "any" },
  { label: "Amendment fee", sac: "996799", unit: "Lumpsum", applies: "any" },

  // Export only: both are things you do to a box before it leaves.
  { label: "Container seal", sac: "996719", unit: "Container", applies: ["export"] },
  { label: "VGM filing", sac: "996799", unit: "Container", applies: ["export"] },

  // Import only: none of these exist until cargo has arrived somewhere.
  { label: "Delivery order fee", sac: "996799", unit: "B/L", applies: ["import"] },
  { label: "Detention & demurrage", sac: "996719", unit: "Container", applies: ["import"] },
  { label: "Ground rent / storage", sac: "996719", unit: "Container", applies: ["import"] },

  { label: "Other charges", sac: "996799", unit: "Lumpsum", applies: "any" },
];

/**
 * The charge heads that can apply to a job going this way.
 *
 * Offering a delivery-order fee on an export and a VGM filing on an import is
 * not harmless clutter — it is the operator having to know which half of the
 * list to ignore, which is the knowledge the system was supposed to hold. With
 * the direction unknown, everything is offered rather than nothing.
 */
export function chargeHeadsFor(direction: TradeDirection | null | undefined): ChargeHead[] {
  if (!direction) return CHARGE_HEADS;
  return CHARGE_HEADS.filter((h) => h.applies === "any" || h.applies.includes(direction));
}

export const UNITS = ["W/M", "CBM", "Kg", "Container", "B/L", "Shipment", "Trip", "Lumpsum"];

/**
 * Currencies a charge is billed in.
 *
 * Per line, not per invoice: ocean freight is quoted in dollars and the
 * documentation fee is in rupees, and they appear on the same invoice because
 * they are the same job. The invoice foots in INR.
 */
export const LINE_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];

/** GST state codes. The first two digits of a GSTIN are one of these. */
export const STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu & Kashmir" }, { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" }, { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" }, { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" }, { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" }, { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra & Nagar Haveli and Daman & Diu" },
  { code: "27", name: "Maharashtra" }, { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" }, { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" }, { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" }, { code: "35", name: "Andaman & Nicobar Islands" },
  { code: "36", name: "Telangana" }, { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" }, { code: "97", name: "Other territory" },
];

/** Money as the desk writes it. Indian grouping, two decimals only when they matter. */
export function money(n: number | null | undefined, currency = "INR"): string {
  if (n === null || n === undefined) return "—";
  const body = n.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return currency === "INR" ? `₹${body}` : `${currency} ${body}`;
}
