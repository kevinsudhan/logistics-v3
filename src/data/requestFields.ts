/**
 * The field catalogue: what an enquiry can hold, and how each field is asked for.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LIVES HERE NOW
 *
 * It used to sit in `supabase/functions/_shared/`, because that is where it was
 * used to build the schema the extractor was constrained to, and `src/data/`
 * held a one-line re-export pointing at it. That was the right call while those
 * functions existed. They were v1's — the voice ingest, the field extractor —
 * and v2 has one Edge Function, `classify-enquiry`, which carries its own copy
 * of what it needs.
 *
 * So the re-export pointed across a tree that no longer had a reason to be
 * here, and the tree stayed because of the re-export. The file moved; the tree
 * went.
 *
 * It imports nothing, which is what made both arrangements possible.
 * ---------------------------------------------------------------------------
 */

/**
 * `date` is its own kind rather than text carrying a YYYY-MM-DD.
 *
 * The form renders a date picker from it, which is the difference between an
 * operator typing "14th" and the field holding a date the cut-off can actually
 * be compared against. Older date fields in this catalogue are still "text";
 * they predate the form and changing them is a separate, testable job.
 */
export type FieldKind = "text" | "number" | "boolean" | "enum" | "date";
export type FieldGroup = "booking" | "documentation" | "handling";

export interface FieldDef {
  key: string;
  label: string;
  group: FieldGroup;
  kind: FieldKind;
  unit?: string;
  options?: string[];
  hint: string;
  /**
   * Whether a Commercial Invoice & Packing List cannot be issued without it.
   *
   * Marked on the field rather than listed in the PDF generator, so the document, the
   * readiness badge and the "still pending" note on the invoice itself all agree about
   * what is outstanding — and adding a field to the catalogue is still a one-file edit.
   */
  requiredForInvoice?: boolean;
}

export const GROUP_LABELS: Record<FieldGroup, string> = {
  booking: "To quote and book",
  documentation: "To generate documents",
  handling: "Cargo handling",
};

export const REQUEST_FIELDS: FieldDef[] = [
  // ---------------------------------------------------------------- booking
  {
    key: "customer_name",
    label: "Contact name",
    group: "booking",
    kind: "text",
    hint: "The caller's own name, as they gave it. Transliterate a Tamil name into Latin script; do not translate the meaning of a name.",
  },
  {
    key: "company",
    label: "Company",
    group: "booking",
    kind: "text",
    hint: "The company the caller is shipping on behalf of. Null if they are an individual shipper or never said.",
  },
  {
    key: "origin",
    label: "Origin",
    group: "booking",
    kind: "text",
    hint: "Port or city the cargo ships FROM. Use the English port name (Tuticorin, Chennai, Cochin, Mundra).",
  },
  {
    key: "destination",
    label: "Destination",
    group: "booking",
    kind: "text",
    hint: "Port or city the cargo ships TO, in English. Never swap this with origin — 'Chennai-la irundhu Colombo' means origin Chennai, destination Colombo.",
  },
  {
    key: "cargo_description",
    label: "Cargo description",
    group: "booking",
    kind: "text",
    hint: "What the goods actually are, translated into English. 'பருத்தி துணி' becomes 'cotton fabric'. Keep it short — a noun phrase, not a sentence.",
  },
  {
    key: "cargo_type",
    label: "Cargo type",
    group: "booking",
    kind: "enum",
    options: ["general_dry", "textiles_garments", "perishable_food", "hazardous_dg", "electronics", "agri_grain"],
    hint: "Classify the cargo into one of the six categories. Only if the goods are clear enough to classify confidently.",
  },
  {
    key: "piece_length_cm",
    label: "Piece length",
    group: "booking",
    kind: "number",
    unit: "cm",
    hint: "Length of ONE piece, converted to centimetres. Feet, inches and metres all convert. Never the total across all pieces.",
  },
  {
    key: "piece_width_cm",
    label: "Piece width",
    group: "booking",
    kind: "number",
    unit: "cm",
    hint: "Width of ONE piece in centimetres.",
  },
  {
    key: "piece_height_cm",
    label: "Piece height",
    group: "booking",
    kind: "number",
    unit: "cm",
    hint: "Height of ONE piece in centimetres. This is the dimension that decides whether cargo fits a container at all, so never infer it from the other two.",
  },
  {
    key: "piece_count",
    label: "Number of pieces",
    group: "booking",
    kind: "number",
    hint: "How many pieces in total. Tamil number words count: 'நாற்பது' / 'naapadhu' is 40.",
  },
  {
    key: "weight_per_piece_kg",
    label: "Weight per piece",
    group: "booking",
    kind: "number",
    unit: "kg",
    hint: "Weight of ONE piece in kilograms. If the caller gave only a total, put it in total_gross_weight_kg and leave this null — do not divide.",
  },
  {
    key: "total_gross_weight_kg",
    label: "Total gross weight",
    group: "booking",
    kind: "number",
    unit: "kg",
    hint: "Total weight of the whole consignment in kilograms. Tonnes convert. Do not multiply piece weight by count yourself.",
  },
  {
    key: "volume_cbm",
    label: "Volume",
    group: "booking",
    kind: "number",
    unit: "CBM",
    hint: "Total volume in cubic metres, only if the caller stated a CBM figure. Never compute it from the dimensions.",
  },
  {
    key: "stackable",
    label: "Stackable",
    group: "booking",
    kind: "boolean",
    hint: "True only if the caller said pieces CAN be stacked on each other. False only if they said they cannot. Null if never discussed — this is not a safe default either way.",
  },
  {
    key: "upright_only",
    label: "Must stay upright",
    group: "booking",
    kind: "boolean",
    hint: "True if the cargo must travel upright / cannot be laid on its side. Null if not discussed.",
  },
  {
    key: "preferred_sailing_date",
    label: "Preferred sailing date",
    group: "booking",
    kind: "text",
    hint: "The sailing date the caller wants, as a full ISO date (2026-09-14). The call date is given to you -- use it to resolve 'the 30th', 'August 30th' or 'next Friday' into a real date, and never resolve one backwards into the past. Only if they genuinely gave a window rather than a day, record their own words in English ('first week of September').",
  },
  {
    key: "container_type",
    label: "Container preference",
    group: "booking",
    kind: "enum",
    options: ["LCL", "20GP", "40GP", "40HC", "20RF", "40RF"],
    hint: "Only what the caller asked for or agreed to. '20 feet' is 20GP, 'reefer' plus a size gives 20RF/40RF. Not what the agent merely suggested.",
  },
  {
    key: "quote_accepted",
    label: "Quote accepted",
    group: "booking",
    kind: "boolean",
    hint: "True ONLY if the customer clearly agreed to a rate on this call -- 'okay, book it', 'that works, go ahead', 'sari, pannunga'. Not true when they said they would think about it, asked us to call back, or were still negotiating. This decides whether the enquiry becomes a booking, so a wrong true starts paperwork nobody agreed to.",
  },
  {
    key: "target_price_inr",
    label: "Target price",
    group: "booking",
    kind: "number",
    unit: "INR",
    hint: "The rate the CUSTOMER asked for, in rupees, not the rate the agent quoted. Lakhs and crores expand to full figures.",
  },

  // ---------------------------------------------------------- documentation
  {
    key: "shipper_legal_name",
    label: "Shipper legal name",
    group: "documentation",
    requiredForInvoice: true,
    kind: "text",
    hint: "The exporter's registered legal name, which may differ from the trading name in `company`.",
  },
  {
    key: "shipper_gstin_iec",
    label: "Shipper GSTIN / IEC",
    group: "documentation",
    requiredForInvoice: true,
    kind: "text",
    hint: "GSTIN (15 characters) or IEC (10 digits), read back exactly. If digits were unclear or partial, leave null rather than record an incomplete number.",
  },
  {
    key: "consignee_name",
    label: "Consignee name",
    group: "documentation",
    requiredForInvoice: true,
    kind: "text",
    hint: "The importer receiving the cargo.",
  },
  {
    key: "consignee_address",
    label: "Consignee address",
    group: "documentation",
    requiredForInvoice: true,
    kind: "text",
    hint: "The consignee's address as given. Do not complete a partial address.",
  },
  {
    key: "consignee_country",
    label: "Consignee country",
    group: "documentation",
    requiredForInvoice: true,
    kind: "text",
    hint: "Destination country in English. Only if stated or unambiguous from a named consignee city.",
  },
  {
    key: "hs_code",
    label: "HS code",
    group: "documentation",
    requiredForInvoice: true,
    kind: "text",
    hint: "Only a code the caller actually read out. Never classify the goods yourself — a wrong HS code is a customs problem.",
  },
  {
    key: "invoice_value_inr",
    label: "Invoice value",
    group: "documentation",
    requiredForInvoice: true,
    kind: "number",
    unit: "INR",
    hint: "Declared commercial value of the goods in rupees. Not the freight rate.",
  },
  {
    key: "package_count",
    label: "Number of packages",
    group: "documentation",
    requiredForInvoice: true,
    kind: "number",
    hint: "Package count for the packing list. May equal piece_count, but only record it if stated in a packaging context.",
  },
  {
    key: "package_type",
    label: "Package type",
    group: "documentation",
    requiredForInvoice: true,
    kind: "text",
    hint: "cartons, pallets, drums, bales, bags — in English.",
  },
  {
    key: "net_weight_kg",
    label: "Net weight",
    group: "documentation",
    requiredForInvoice: true,
    kind: "number",
    unit: "kg",
    hint: "Weight of the goods excluding packaging.",
  },
  {
    key: "gross_weight_kg",
    label: "Gross weight",
    group: "documentation",
    requiredForInvoice: true,
    kind: "number",
    unit: "kg",
    hint: "Weight including packaging, as stated for the documents.",
  },
  {
    key: "incoterm",
    label: "Incoterm",
    group: "documentation",
    requiredForInvoice: true,
    kind: "enum",
    options: ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"],
    hint: "Only if a term was actually named. Do not infer one from who is paying freight.",
  },
  {
    key: "payment_terms",
    label: "Payment terms",
    group: "documentation",
    requiredForInvoice: true,
    kind: "text",
    hint: "Advance, 30 days, against documents, and so on — in English.",
  },
  {
    key: "letter_of_credit",
    label: "Letter of credit involved",
    group: "documentation",
    kind: "boolean",
    hint: "True if an LC is in play. Null if never mentioned.",
  },

  // ---------------------------------------------------------------- handling
  // ---- what a consol agent asks for before they will take the cargo ----
  //
  // A co-loader quotes on these. Until now the answers arrived in a mail,
  // somebody read them, and they stayed in the mail — the catalogue is what the
  // extractor is constrained to, so a field absent here is one the model is not
  // allowed to return however plainly the sender wrote it.
  // How it travels. Asked because the chargeable weight is computed per mode
  // and the ratios differ by a factor of six between air and sea — a mode
  // guessed wrong is a quotation wrong in the direction that loses money.
  {
    key: "transport_mode",
    label: "Transport mode",
    group: "booking",
    kind: "enum",
    options: ["sea_lcl", "sea_fcl", "air", "road"],
    hint: "Only where the sender says so — 'LCL', 'we need an air quote', 'by road'. A request for a rate to a seaport is not by itself a mode; leave it null rather than assuming sea.",
  },
  {
    key: "cfs_location",
    label: "CFS / stuffing point",
    group: "booking",
    kind: "text",
    hint: "Where cargo is delivered to be consolidated. NOT the pickup address — a shipper in Tirupur usually delivers into a Chennai CFS. Only if a place is actually named.",
  },
  {
    key: "cargo_cutoff",
    label: "Cargo cut-off",
    group: "booking",
    kind: "date",
    hint: "The last date the consol agent accepts cargo for the sailing. Earlier than the carrier's own cut-off. Never inferred from the sailing date.",
  },
  {
    key: "si_cutoff",
    label: "SI cut-off",
    group: "documentation",
    kind: "date",
    hint: "Last date for shipping instructions. Only if stated as such.",
  },
  {
    key: "marks_and_numbers",
    label: "Marks & numbers",
    group: "documentation",
    kind: "text",
    hint: "What is stencilled on the packages, printed as-is on the B/L. Often literally 'NIL'. Copy what was written; do not tidy it.",
  },
  {
    key: "freight_terms",
    label: "Freight terms",
    group: "booking",
    kind: "enum",
    options: ["prepaid", "collect"],
    hint: "Who pays the carrier: prepaid is the shipper, collect is the consignee. Do not guess it from the incoterm — EXW cargo is frequently shipped prepaid by arrangement.",
  },
  {
    key: "notify_name",
    label: "Notify party",
    group: "documentation",
    kind: "text",
    hint: "Who is told on arrival. Often the consignee and often not — commonly the buyer's customs broker. Only if named separately.",
  },
  {
    key: "notify_address",
    label: "Notify address",
    group: "documentation",
    kind: "text",
    hint: "The notify party's full address, as it should print on the bill of lading.",
  },
  {
    key: "un_number",
    label: "UN number",
    group: "handling",
    kind: "text",
    hint: "Hazardous cargo only. Four digits, usually written 'UN 1263'. Return the digits.",
  },
  {
    key: "imo_class",
    label: "IMO class",
    group: "handling",
    kind: "text",
    hint: "Hazardous cargo only. The IMDG class, such as '3' or '8' or '9'. Never inferred from the cargo description — a wrong class on a DG declaration is a refused booking at best.",
  },
  {
    key: "packing_group",
    label: "Packing group",
    group: "handling",
    kind: "enum",
    options: ["I", "II", "III"],
    hint: "Hazardous cargo only. Roman numerals I, II or III, only if stated.",
  },
  {
    key: "flash_point_c",
    label: "Flash point",
    group: "handling",
    kind: "number",
    unit: "degC",
    hint: "Hazardous cargo only. In Celsius. Convert from Fahrenheit if that is how it was given, and only if a figure was given.",
  },
  {
    key: "msds_provided",
    label: "MSDS provided",
    group: "handling",
    kind: "boolean",
    hint: "Hazardous cargo only. True if the caller confirmed they have or have sent the MSDS.",
  },
  {
    key: "un_packaging_spec",
    label: "UN packaging spec",
    group: "handling",
    kind: "text",
    hint: "Hazardous cargo only. The UN number, IMDG class or packing group if stated.",
  },
  {
    key: "carrier_dg_approval",
    label: "Carrier DG approval",
    group: "handling",
    kind: "enum",
    options: ["not_required", "pending", "approved"],
    hint: "Hazardous cargo only. This must be approved before space is booked, so 'pending' is a real and important value.",
  },
  {
    key: "temperature_setpoint_c",
    label: "Temperature setpoint",
    group: "handling",
    kind: "number",
    unit: "°C",
    hint: "Reefer cargo only. Negative values are normal (-18). Convert Fahrenheit if given that way.",
  },
  {
    key: "pre_cooling_required",
    label: "Pre-cooling required",
    group: "handling",
    kind: "boolean",
    hint: "Reefer cargo only. True if the caller asked for pre-cooling before loading.",
  },
  {
    key: "wood_packaging_used",
    label: "Wood packaging used",
    group: "handling",
    kind: "boolean",
    hint: "True if any wooden pallets, crates or dunnage are used — it triggers the ISPM-15 fumigation requirement.",
  },

  // ------------------------------------------------ the enquiry's own columns
  //
  // Read out of the mail by classify-enquiry and written by the automatic
  // fill, which drops any value whose key has no entry here. `cargo`,
  // `ready_date` and `pickup_location` were read correctly for months and
  // never written for exactly that reason.
  {
    key: "cargo",
    label: "Commodity",
    group: "booking",
    kind: "text",
    hint: "What is being shipped, as the sender describes it.",
  },
  {
    key: "ready_date",
    label: "Cargo ready date",
    group: "booking",
    kind: "date",
    hint: "When the cargo is ready for collection or delivery into the CFS. Not the sailing date.",
  },
  {
    key: "pickup_location",
    label: "Pickup address",
    group: "booking",
    kind: "text",
    hint: "Where the cargo is collected from, if a pickup is asked for.",
  },
  {
    key: "trade_direction",
    label: "Trade",
    group: "booking",
    kind: "enum",
    options: ["export", "import", "cross_trade"],
    hint: "Seen from India: export leaves India, import arrives, cross trade touches neither end.",
  },
  {
    key: "pickup_required",
    label: "Pickup",
    group: "booking",
    kind: "boolean",
    hint: "Whether we collect from the shipper. Only where asked; never inferred from the Incoterm.",
  },
  {
    key: "delivery_required",
    label: "Delivery",
    group: "booking",
    kind: "boolean",
    hint: "Whether we deliver to a door at destination. A consignee address alone is not a request.",
  },
  {
    key: "delivery_location",
    label: "Delivery address",
    group: "booking",
    kind: "text",
    hint: "Where to deliver at destination, when a door delivery is asked for.",
  },
  {
    key: "customer_reference",
    label: "Customer ref",
    group: "booking",
    kind: "text",
    hint: "The customer's own PO or order number for this shipment, copied exactly.",
  },
  {
    key: "expected_delivery_date",
    label: "Expected delivery date",
    group: "booking",
    kind: "date",
    hint: "When the cargo must reach destination. Not the ready date, not a quote deadline.",
  },
  {
    key: "transit_days",
    label: "Transit days",
    group: "booking",
    kind: "number",
    unit: "days",
    hint: "The transit time asked for, in whole days.",
  },
  {
    key: "hazardous",
    label: "Hazardous",
    group: "booking",
    kind: "boolean",
    hint: "Dangerous goods. True when stated or when a UN number or IMO class is given.",
  },
];

export const FIELD_KEYS = REQUEST_FIELDS.map((f) => f.key);

const BY_KEY = new Map(REQUEST_FIELDS.map((f) => [f.key, f]));
export const fieldDef = (key: string): FieldDef | undefined => BY_KEY.get(key);

/** Every field, plus the language metadata the extractor reports about the call. */
export type SourceLanguage = "en" | "ta" | "mixed" | "unknown";

export interface RequestDetails {
  [key: string]: string | number | boolean | null | undefined;
}

export interface RequestDetailsEnvelope {
  fields: RequestDetails;
  source_language: SourceLanguage;
  translated: boolean;
  extracted_by: "llm" | "regex" | "llm+regex";
  extracted_at: string;
}

/** The description the model sees for one field — label, unit, and what counts as stated. */
export function fieldDescription(f: FieldDef): string {
  return f.unit ? `${f.label} (${f.unit}). ${f.hint}` : `${f.label}. ${f.hint}`;
}

/**
 * Coerces one extracted value to the field's declared shape, or drops it.
 *
 * The model is schema-constrained, so this is a backstop rather than the main defence —
 * it matters most for the regex fallback path, which has no schema at all.
 */
export function coerceField(key: string, value: unknown): string | number | boolean | null {
  const def = BY_KEY.get(key);
  if (!def || value === null || value === undefined || value === "") return null;

  if (def.kind === "number") {
    const n = typeof value === "number" ? value : Number(String(value).replace(/[, ]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (def.kind === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).toLowerCase();
    if (["true", "yes", "1"].includes(s)) return true;
    if (["false", "no", "0"].includes(s)) return false;
    return null;
  }
  if (def.kind === "enum") {
    const s = String(value).trim();
    const hit = def.options?.find((o) => o.toLowerCase() === s.toLowerCase());
    return hit ?? null;
  }

  const s = String(value).trim();
  return s ? s : null;
}

/**
 * The value a reading proposes for a field, made safe to write — or null.
 *
 * One bad value in a patch fails the whole update: a date the database cannot
 * parse or a 400-day transit that breaks its check constraint, and none of the
 * other twelve good values land either. So each value is shaped to its field
 * here, and one that cannot be is dropped rather than sent. The model is
 * schema-constrained, which makes this rare; rare is not never.
 */
export function saneValue(key: string, value: unknown): unknown {
  const def = BY_KEY.get(key);
  if (!def) return null;
  const v = coerceField(key, value);
  if (v === null) return null;
  if (def.kind === "date") {
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
  }
  if (key === "transit_days") {
    const n = Math.round(Number(v));
    return n >= 0 && n <= 365 ? n : null;
  }
  // Counts and measurements the database requires to be positive.
  if (def.kind === "number" && typeof v === "number" && v < 0) return null;
  return v;
}

/** Drops unknown keys and coerces the rest. Returns only fields that actually have a value. */
export function normaliseDetails(raw: Record<string, unknown>): RequestDetails {
  const out: RequestDetails = {};
  for (const key of FIELD_KEYS) {
    const v = coerceField(key, raw[key]);
    if (v !== null) out[key] = v;
  }
  return out;
}

/**
 * Fields the regex pass owns outright.
 *
 * These are lifted verbatim from the transcript by pattern, which is strictly better
 * than the same value recalled through a model — there is no paraphrase step that could
 * round a figure or drop a digit.
 *
 * Money is deliberately absent. The regex reads amounts across the whole transcript and
 * cannot tell the agent's quote from the customer's asking price; the model can, and
 * letting a pattern match overwrite that distinction would put the wrong number in front
 * of whoever negotiates next.
 */
const REGEX_WINS = new Set(["volume_cbm", "container_type"]);

/**
 * Combines the LLM and regex passes.
 *
 * Neither side may overwrite a value with null: a field one pass found and the other
 * missed is still a field we know. Only a real value replaces a real value, and only
 * where REGEX_WINS says the pattern match is the better authority.
 */
export function mergeExtractions(llm: RequestDetails, regex: RequestDetails): RequestDetails {
  const out: RequestDetails = { ...llm };

  for (const key of FIELD_KEYS) {
    const r = regex[key];
    if (r === null || r === undefined) continue;
    if (out[key] === null || out[key] === undefined || REGEX_WINS.has(key)) out[key] = r;
  }

  return out;
}

/**
 * Whether the documentation fields needed to issue an invoice are all present.
 *
 * letter_of_credit is deliberately not required: an LC either applies or it does not, and
 * treating "never mentioned" as an outstanding item would leave every ordinary shipment
 * looking permanently incomplete.
 */
export function invoiceReadiness(details: RequestDetails): {
  ready: boolean;
  missing: FieldDef[];
  have: number;
  need: number;
} {
  const required = REQUEST_FIELDS.filter((f) => f.requiredForInvoice);
  const missing = required.filter((f) => details[f.key] === null || details[f.key] === undefined);
  return { ready: missing.length === 0, missing, have: required.length - missing.length, need: required.length };
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Turns a spoken sailing date into a real one, using the date of the call.
 *
 * Callers say "August 30th" or "the 30th", never "2026-08-30", and the year is almost
 * never spoken because it is obvious to both people on the phone. Asking the model to
 * resolve it was tried first and it kept returning the words back; this is arithmetic,
 * so it belongs in code where it is deterministic and testable.
 *
 * The year is chosen as the one that puts the sailing in the future relative to the call,
 * because nobody books a sailing into the past. Anything that is genuinely a window
 * rather than a day is left exactly as the customer said it — a vague answer should stay
 * visibly vague rather than be sharpened into a date nobody committed to.
 */
export function resolveSailingDate(value: unknown, callDate?: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const base = callDate && /^\d{4}-\d{2}-\d{2}$/.test(callDate) ? new Date(callDate + "T00:00:00Z") : null;
  if (!base) return null;

  const lower = raw.toLowerCase();
  const named = MONTHS.findIndex((m) => lower.includes(m));
  const dayMatch = lower.match(/(?:^|[^0-9])([0-9]{1,2})(?:st|nd|rd|th)?(?![0-9])/);
  if (!dayMatch) return null;
  const day = Number(dayMatch[1]);
  if (day < 1 || day > 31) return null;

  const month = named >= 0 ? named : base.getUTCMonth();
  let year = base.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month, day));
  // A day already past on the call date means they meant the next occurrence.
  if (candidate < base) candidate = new Date(Date.UTC(++year, month, day));
  if (candidate.getUTCDate() !== day) return null; // e.g. "31st" of a 30-day month

  return candidate.toISOString().slice(0, 10);
}

/** How complete a request is, for the progress bar on the record. */
export function completeness(details: RequestDetails): { filled: number; total: number } {
  const filled = FIELD_KEYS.filter((k) => details[k] !== null && details[k] !== undefined).length;
  return { filled, total: FIELD_KEYS.length };
}

/** One field by key, or undefined when nothing in the catalogue has it. */
export const byKey = (key: string): FieldDef | undefined =>
  REQUEST_FIELDS.find((f) => f.key === key);
