/**
 * The house bill of lading: every box on it, filling it from the job, and what
 * it must say before it can be issued (085).
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE
 *
 * One record of the boxes as a bill of lading lays them out — parties,
 * routing, the containers, the particulars the shipper furnished, freight,
 * where and when it was issued — kept as the `data` of house_bills. Figures
 * are held as the text typed, as on the HAWB, so a half-typed number is never
 * turned into 0 under somebody's fingers.
 *
 * How it is released (originals, telex, express) and how many originals are
 * signed are columns on house_bills, not boxes here: they decide whether it
 * can be printed as an original and what its title is, so the database checks
 * them.
 *
 * FILLING FROM THE JOB
 *
 * `hblFromJob` is "Fetch details": the parties from the Party tab, the ports
 * and vessel from the booking, the boxes and seals from the Containers tab,
 * the goods and marks from Cargo details, and the destination agent the
 * cargo is delivered through. What the desk writes for the document — the
 * wording of the description once edited, remarks, the issue details — is not
 * the job's, and a second fetch leaves it alone (`refetch`).
 * ---------------------------------------------------------------------------
 */

export type ReleaseMode = "original" | "telex" | "express";
export type ConsigneeMode = "named" | "to_order";

export const RELEASE_LABEL: Record<ReleaseMode, string> = {
  original: "Original B/Ls",
  telex: "Telex release",
  express: "Express release (sea waybill)",
};

export const RELEASE_HINT: Record<ReleaseMode, string> = {
  original: "Originals are issued; the consignee surrenders one at destination to take the cargo.",
  telex: "Originals are issued, then surrendered back at origin; our agent releases on our message.",
  express: "No originals. A non-negotiable sea waybill; the consignee collects against identity.",
};

export interface HblContainer {
  container_no: string;
  seal_no: string;
  size_type: string;
  packages: string;
  package_type: string;
  gross_kg: string;
  cbm: string;
}

/** One line of the freight table: OCEAN FREIGHT … AS ARRANGED. Text, as typed. */
export interface HblCharge {
  charge: string;
  revenue_tons: string;
  rate: string;
  prepaid: string;
  collect: string;
}

export type Insurance = "" | "not_covered" | "covered";

export const INSURANCE_LABEL: Record<Exclude<Insurance, "">, string> = {
  not_covered: "Not covered",
  covered: "Covered according to attached policy",
};

export interface HblData {
  booking_ref: string;
  export_refs: string;

  shipper_name: string;
  shipper_address: string;
  consignee_mode: ConsigneeMode;
  consignee_name: string;
  consignee_address: string;
  /**
   * India's importer identifiers, printed under the consignee: customs and the
   * line want the IEC and GSTIN on any B/L for cargo into India, and the
   * person to call with their number.
   */
  consignee_iec: string;
  consignee_gstin: string;
  consignee_contact: string;
  notify_name: string;
  notify_address: string;
  notify_iec: string;
  notify_gstin: string;
  also_notify: string;
  /** "For delivery please apply to": our agent at destination, with how to reach them. */
  delivery_agent: string;

  pre_carriage_by: string;
  place_of_receipt: string;
  vessel: string;
  voyage: string;
  port_of_loading: string;
  port_of_discharge: string;
  place_of_delivery: string;
  final_destination: string;
  /** FCL/FCL, LCL/LCL and the like. */
  service_type: string;

  containers: HblContainer[];
  marks_numbers: string;
  packages: string;
  package_type: string;
  description: string;
  hs_code: string;
  gross_weight_kg: string;
  measurement_cbm: string;
  /** "Shipper's load, stow, count and seal": the carrier did not see a full box packed. */
  shippers_load: boolean;
  /** "SAID TO CONTAIN" above the goods: they are described as declared, not as seen. */
  said_to_contain: boolean;

  freight_terms: "prepaid" | "collect";
  freight_payable_at: string;
  /** The freight table; usually one line, OCEAN FREIGHT … AS ARRANGED. */
  charges: HblCharge[];
  /** "Cargo insurance through the undersigned": blank prints neither box ticked. */
  insurance: Insurance;

  place_of_issue: string;
  date_of_issue: string;
  on_board_date: string;

  /** The operator it is issued under, copied from the partner when filled (085). */
  mto_name: string;
  mto_registration: string;

  remarks: string;
}

export const emptyContainer = (): HblContainer => ({
  container_no: "",
  seal_no: "",
  size_type: "",
  packages: "",
  package_type: "",
  gross_kg: "",
  cbm: "",
});

export const emptyCharge = (): HblCharge => ({ charge: "", revenue_tons: "", rate: "", prepaid: "", collect: "" });

/** The usual table: ocean freight, "as arranged", in the column the terms say. */
export function defaultCharges(terms: "prepaid" | "collect"): HblCharge[] {
  return [{ ...emptyCharge(), charge: "OCEAN FREIGHT", [terms]: "AS ARRANGED" }];
}

export function emptyHbl(): HblData {
  return {
    booking_ref: "",
    export_refs: "",
    shipper_name: "",
    shipper_address: "",
    consignee_mode: "named",
    consignee_name: "",
    consignee_address: "",
    consignee_iec: "",
    consignee_gstin: "",
    consignee_contact: "",
    notify_name: "",
    notify_address: "",
    notify_iec: "",
    notify_gstin: "",
    also_notify: "",
    delivery_agent: "",
    pre_carriage_by: "",
    place_of_receipt: "",
    vessel: "",
    voyage: "",
    port_of_loading: "",
    port_of_discharge: "",
    place_of_delivery: "",
    final_destination: "",
    service_type: "",
    containers: [],
    marks_numbers: "",
    packages: "",
    package_type: "",
    description: "",
    hs_code: "",
    gross_weight_kg: "",
    measurement_cbm: "",
    shippers_load: false,
    said_to_contain: true,
    freight_terms: "prepaid",
    freight_payable_at: "",
    charges: defaultCharges("prepaid"),
    insurance: "",
    place_of_issue: "",
    date_of_issue: "",
    on_board_date: "",
    mto_name: "",
    mto_registration: "",
    remarks: "",
  };
}

/** A saved record with any box it lacks filled blank, so an older save still opens. */
export function normaliseHbl(raw: Partial<HblData> | null | undefined): HblData {
  const d = { ...emptyHbl(), ...(raw ?? {}) } as HblData;
  d.containers = (raw?.containers ?? []).map((c) => ({ ...emptyContainer(), ...c }));
  // Saved before the freight table existed: the line its terms imply.
  d.charges = raw?.charges ? raw.charges.map((c) => ({ ...emptyCharge(), ...c })) : defaultCharges(d.freight_terms);
  return d;
}

// ---------------------------------------------------------------------------
// Filling from the job
// ---------------------------------------------------------------------------

export interface JobForHbl {
  shipment: {
    enquiry_ref: string;
    transport_mode: string | null;
    shipper_name: string | null;
    shipper_address: string | null;
    shipper_city: string | null;
    shipper_state: string | null;
    shipper_pincode: string | null;
    shipper_country: string | null;
    consignee_name: string | null;
    consignee_address: string | null;
    consignee_city: string | null;
    consignee_state: string | null;
    consignee_pincode: string | null;
    consignee_country: string | null;
    consignee_iec?: string | null;
    consignee_gstin?: string | null;
    consignee_email?: string | null;
    notify_name: string | null;
    notify_address: string | null;
    notify_city: string | null;
    notify_country: string | null;
    notify_iec?: string | null;
    notify_gstin?: string | null;
    vessel: string | null;
    voyage: string | null;
    port_of_loading: string | null;
    port_of_discharge: string | null;
    origin: string | null;
    destination: string | null;
    etd: string | null;
    sailing_date: string | null;
    cargo: string | null;
    package_count: number | null;
    package_type: string | null;
    piece_count: number | null;
    gross_weight_kg: number | string | null;
    volume_cbm: number | string | null;
    marks_and_numbers: string | null;
    hs_code: string | null;
    freight_terms: "prepaid" | "collect" | null;
    un_number: string | null;
    imo_class: string | null;
  };
  containers: Array<{
    container_no: string;
    seal_no: string;
    size_type: string;
    package_count: number | null;
    package_type: string;
    weight_kg: number | null;
    volume_cbm: number | null;
  }>;
  /** Who delivers it at the other end: the console's agent, or the job's. */
  agent: { name: string; address: string; contact: string } | null;
  mto: { name: string; registration: string } | null;
  /** Where we issue from, as the B/L writes it: CHENNAI. */
  place: string;
  today: string;
}

const lines = (...parts: Array<string | null | undefined>) =>
  parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join("\n");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const trim3 = (n: number) => String(Math.round(n * 1000) / 1000);
const upper = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

export function hblFromJob(j: JobForHbl): HblData {
  const s = j.shipment;
  const d = emptyHbl();
  const fcl = s.transport_mode === "sea_fcl";

  d.booking_ref = s.enquiry_ref;

  d.shipper_name = upper(s.shipper_name);
  d.shipper_address = lines(s.shipper_address, [s.shipper_city, s.shipper_state, s.shipper_pincode].filter(Boolean).join(", "), s.shipper_country).toUpperCase();
  d.consignee_name = upper(s.consignee_name);
  d.consignee_address = lines(
    s.consignee_address,
    [s.consignee_city, s.consignee_state, s.consignee_pincode].filter(Boolean).join(", "),
    s.consignee_country
  ).toUpperCase();
  d.consignee_iec = upper(s.consignee_iec);
  d.consignee_gstin = upper(s.consignee_gstin);
  d.consignee_contact = (s.consignee_email ?? "").trim().toUpperCase();
  // With no notify party of its own, a B/L notifies the consignee.
  d.notify_name = s.notify_name ? upper(s.notify_name) : "SAME AS CONSIGNEE";
  d.notify_address = s.notify_name ? lines(s.notify_address, [s.notify_city, s.notify_country].filter(Boolean).join(", ")).toUpperCase() : "";
  d.notify_iec = s.notify_name ? upper(s.notify_iec) : "";
  d.notify_gstin = s.notify_name ? upper(s.notify_gstin) : "";
  d.delivery_agent = j.agent ? lines(j.agent.name, j.agent.address, j.agent.contact).toUpperCase() : "";

  d.vessel = upper(s.vessel);
  d.voyage = upper(s.voyage);
  d.port_of_loading = upper(s.port_of_loading ?? s.origin);
  d.port_of_discharge = upper(s.port_of_discharge ?? s.destination);
  d.place_of_receipt = d.port_of_loading;
  d.place_of_delivery = d.port_of_discharge;
  d.service_type = fcl ? "FCL/FCL" : s.transport_mode === "sea_lcl" ? "LCL/LCL" : "";
  d.shippers_load = fcl;

  d.containers = j.containers.map((c) => ({
    container_no: upper(c.container_no),
    seal_no: upper(c.seal_no),
    size_type: c.size_type,
    packages: c.package_count ? String(c.package_count) : "",
    package_type: upper(c.package_type),
    gross_kg: c.weight_kg ? trim3(c.weight_kg) : "",
    cbm: c.volume_cbm ? trim3(c.volume_cbm) : "",
  }));

  const pkgs = s.package_count ?? s.piece_count;
  const gross = num(s.gross_weight_kg);
  const cbm = num(s.volume_cbm);
  d.packages = pkgs ? String(pkgs) : "";
  d.package_type = upper(s.package_type) || "PACKAGES";
  d.gross_weight_kg = gross !== null ? trim3(gross) : "";
  d.measurement_cbm = cbm !== null ? trim3(cbm) : "";
  d.marks_numbers = upper(s.marks_and_numbers);
  d.hs_code = upper(s.hs_code);
  d.description = lines(
    upper(s.cargo),
    s.un_number ? `DANGEROUS GOODS ${upper(s.un_number)}${s.imo_class ? ` CLASS ${upper(s.imo_class)}` : ""}` : null
  );

  const collect = s.freight_terms === "collect";
  d.freight_terms = collect ? "collect" : "prepaid";
  d.freight_payable_at = collect ? d.port_of_discharge : j.place.toUpperCase();
  d.charges = defaultCharges(d.freight_terms);

  d.place_of_issue = j.place.toUpperCase();
  d.date_of_issue = j.today;
  d.on_board_date = s.sailing_date ?? s.etd ?? "";

  if (j.mto) {
    d.mto_name = upper(j.mto.name);
    d.mto_registration = j.mto.registration.trim().toUpperCase();
  }
  return d;
}

/** The boxes "Fetch details" refreshes; the rest are the document's own. */
export const JOB_KEYS: Array<keyof HblData> = [
  "booking_ref",
  "shipper_name",
  "shipper_address",
  "consignee_name",
  "consignee_address",
  "consignee_iec",
  "consignee_gstin",
  "notify_name",
  "notify_address",
  "notify_iec",
  "notify_gstin",
  "delivery_agent",
  "vessel",
  "voyage",
  "port_of_loading",
  "port_of_discharge",
  "service_type",
  "marks_numbers",
  "packages",
  "package_type",
  "hs_code",
  "gross_weight_kg",
  "measurement_cbm",
  "on_board_date",
];

/**
 * Fetch details over a saved B/L: the job's boxes and containers from the job,
 * the rest as the desk left them. A box the job has nothing for keeps what was
 * typed — an empty job field is not an instruction to clear the document. The
 * description is the desk's once written: the goods as the B/L must describe
 * them are rarely the cargo line of the enquiry word for word.
 */
export function refetch(current: HblData, fresh: HblData): HblData {
  const out: HblData = { ...current, containers: current.containers.map((c) => ({ ...c })) };
  for (const k of JOB_KEYS) {
    const v = fresh[k];
    if (typeof v === "string" && v.trim()) (out[k] as string) = v;
  }
  if (fresh.containers.length) out.containers = fresh.containers.map((c) => ({ ...c }));
  if (!out.description.trim()) out.description = fresh.description;
  return out;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const ONES = [
  "ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
  "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN",
];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

/** 1250 → "ONE THOUSAND TWO HUNDRED AND FIFTY": how a B/L spells a count so it cannot be altered. */
export function numberInWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} HUNDRED${n % 100 ? ` AND ${numberInWords(n % 100)}` : ""}`;
  if (n < 1_000_000) {
    const rest = n % 1000;
    return `${numberInWords(Math.floor(n / 1000))} THOUSAND${rest ? (rest < 100 ? " AND " : " ") + numberInWords(rest) : ""}`;
  }
  const rest = n % 1_000_000;
  return `${numberInWords(Math.floor(n / 1_000_000))} MILLION${rest ? (rest < 100 ? " AND " : " ") + numberInWords(rest) : ""}`;
}

const plural = (word: string, n: number) => (n === 1 || /S$/.test(word) ? word : /(X|CH|SH)$/.test(word) ? `${word}ES` : `${word}S`);

/**
 * The total the B/L states in words.
 *
 * A full-container B/L counts the boxes — "SAY TWO (2) X 40' HC CONTAINERS
 * ONLY" — because that is what the carrier received; a groupage one counts the
 * packages, because the box is not the shipper's. Empty when there is nothing
 * to count.
 */
export function totalInWords(d: HblData): string {
  if (d.service_type.startsWith("FCL") && d.containers.length) {
    const bySize = new Map<string, number>();
    for (const c of d.containers) {
      const size = c.size_type.trim().toUpperCase() || "";
      bySize.set(size, (bySize.get(size) ?? 0) + 1);
    }
    const parts = [...bySize].map(([size, n]) => `${numberInWords(n)} (${n}) X ${size ? `${size} ` : ""}${n === 1 ? "CONTAINER" : "CONTAINERS"}`);
    return `SAY ${parts.join(" AND ")} ONLY`;
  }
  const n = num(d.packages);
  if (!n) return "";
  const kind = d.package_type.trim().toUpperCase() || "PACKAGES";
  return `SAY ${numberInWords(n)} (${n}) ${plural(kind, n)} ONLY`;
}

/** "THREE (3)" — the number of originals as the box states it. */
export const originalsInWords = (n: number) => (n > 0 ? `${numberInWords(n)} (${n})` : "NIL");

/** What the document is called: an express release has no originals, so it is not a bill of lading. */
export function titleOf(release: ReleaseMode): { title: string; subtitle: string } {
  return release === "express"
    ? { title: "SEA WAYBILL", subtitle: "NON-NEGOTIABLE · NO ORIGINALS ISSUED" }
    : { title: "BILL OF LADING", subtitle: "MULTIMODAL TRANSPORT DOCUMENT" };
}

/**
 * A party's address as printed, with the contact and India's identifiers
 * under it: "IEC CODE: 0409012564  GSTIN: 33AALFA7975R1ZJ".
 */
export function partyLines(address: string, contact: string, iec: string, gstin: string): string {
  const ids = [iec.trim() && `IEC CODE: ${iec.trim()}`, gstin.trim() && `GSTIN: ${gstin.trim()}`].filter(Boolean).join("   ");
  return [address.trim(), contact.trim(), ids].filter(Boolean).join("\n");
}

/** The consignee box as printed: a named party, or the order clause. */
export function consigneeText(d: HblData): { name: string; address: string } {
  if (d.consignee_mode === "to_order") {
    const whose = d.consignee_name.trim();
    return { name: whose ? `TO ORDER OF ${whose.replace(/^TO ORDER( OF)?\s*/i, "")}` : "TO ORDER", address: d.consignee_address };
  }
  return { name: d.consignee_name, address: d.consignee_address };
}

// ---------------------------------------------------------------------------
// Before it is issued
// ---------------------------------------------------------------------------

/** The boxes an issued B/L cannot leave blank, by name. Empty when it is ready. */
export function missingForIssue(d: HblData, release: ReleaseMode, originals: number): string[] {
  const out: string[] = [];
  const need = (ok: boolean, what: string) => {
    if (!ok) out.push(what);
  };
  need(Boolean(d.shipper_name.trim()), "the shipper");
  need(d.consignee_mode === "to_order" || Boolean(d.consignee_name.trim()), "the consignee");
  need(Boolean(d.port_of_loading.trim()), "the port of loading");
  need(Boolean(d.port_of_discharge.trim()), "the port of discharge");
  need(Boolean(d.vessel.trim()), "the vessel");
  need(Boolean(d.description.trim()), "the description of goods");
  need(Boolean(num(d.packages)) || d.containers.length > 0, "the number of packages");
  need(Boolean(num(d.gross_weight_kg)), "the gross weight");
  need(Boolean(d.place_of_issue.trim()) && Boolean(d.date_of_issue.trim()), "the place and date of issue");
  need(Boolean(d.on_board_date.trim()), "the shipped on board date");
  need(Boolean(d.mto_registration.trim()), "the MTO registration it is issued under");
  if (release !== "express") need(originals >= 1 && originals <= 3, "how many originals");
  return out;
}

export const FIELD_LABEL: Record<string, string> = {
  booking_ref: "Booking reference",
  export_refs: "Export references",
  shipper_name: "Shipper",
  shipper_address: "Shipper's address",
  consignee_mode: "Consignee: named or to order",
  consignee_name: "Consignee",
  consignee_address: "Consignee's address",
  consignee_iec: "Consignee's IEC",
  consignee_gstin: "Consignee's GSTIN",
  consignee_contact: "Consignee's contact",
  notify_name: "Notify party",
  notify_address: "Notify party's address",
  notify_iec: "Notify party's IEC",
  notify_gstin: "Notify party's GSTIN",
  also_notify: "Also notify",
  delivery_agent: "Delivery agent",
  pre_carriage_by: "Pre-carriage by",
  place_of_receipt: "Place of receipt",
  vessel: "Vessel",
  voyage: "Voyage",
  port_of_loading: "Port of loading",
  port_of_discharge: "Port of discharge",
  place_of_delivery: "Place of delivery",
  final_destination: "Final destination",
  service_type: "Service type",
  containers: "Containers",
  marks_numbers: "Marks and numbers",
  packages: "Packages",
  package_type: "Kind of packages",
  description: "Description of goods",
  hs_code: "HS code",
  gross_weight_kg: "Gross weight",
  measurement_cbm: "Measurement",
  shippers_load: "Shipper's load, stow, count and seal",
  said_to_contain: "Said to contain",
  charges: "Freight table",
  insurance: "Cargo insurance",
  freight_terms: "Freight",
  freight_payable_at: "Freight payable at",
  place_of_issue: "Place of issue",
  date_of_issue: "Date of issue",
  on_board_date: "Shipped on board",
  mto_name: "Issued under (MTO)",
  mto_registration: "MTO registration",
  remarks: "Remarks",
  release_mode: "Release",
  originals: "Originals",
  mto_partner_id: "MTO partner",
};
