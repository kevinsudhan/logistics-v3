/**
 * The CSN (Cargo Summary Notification) for ICEGATE, for an import console.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS
 *
 * As consol agent the desk tells Customs, before the vessel arrives, what is
 * in its consolidated master B/L: one master line (consolidated, "C") and a
 * house line ("H") for every house B/L under it. Customs answers with a CSN
 * number, an MCIN for the master line and a PCIN for each house.
 *
 * The format is CBIC's (docs/icegate-csn: "Message Implementation Guideline –
 * Notified Sea Carriers other than ASC/ASA", SACHM22, v1.6, 14 Aug 2026):
 * message SACHM22, reporting event SCE (entry), version SCE1102, submitted as
 * JSON. Per the guide's trade-scenario table an import consol is
 *
 *   master  IM / C / N   objects MC_Reference, Location, Transport Document,
 *                        Transport Equipment, Itinerary, Measures
 *   house   IM / H / N   HC_Declaration Reference, Transport Document, Item
 *                        Details, Location, Transport Equipment, Itinerary,
 *                        Measures
 *
 * The file this makes has no `digSign` block: ICEGATE's signing utility adds
 * it from the filer's Class III certificate, which lives on a token on their
 * PC and never comes near the CRM.
 *
 * THREE STEPS, ALL PURE
 *
 *   draftFor      what the CRM already knows, laid out as the form (the
 *                 console, each house B/L as saved, its containers, the CFS)
 *   buildCsn      the form as ICEGATE's JSON
 *   csnProblems   everything that would make ICEGATE refuse it: the official
 *                 schema itself (csnSchema.json, checked field by field by
 *                 `schemaErrors`) and the business rules the guide states in
 *                 words — the consignee's IEC on an import, UN/LOCODEs, HS
 *                 codes, "ZZZZZ" for cargo that is not hazardous
 * ---------------------------------------------------------------------------
 */
import schemaJson from "./icegate/csnSchema.json";

export const CSN_SCHEMA = schemaJson as unknown as SchemaNode;

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export interface CsnSettings {
  icegate_id: string;
  pan: string;
  authorised_pan: string;
  port_of_reporting: string;
}

export type CodeType = "" | "IEC" | "PAN" | "GSN";

export interface CsnParty {
  name: string;
  street: string;
  city: string;
  subdivision: string;
  /** ISO 3166 two letters. */
  country: string;
  postcode: string;
  /** The consignee's IEC (or PAN) on an import. */
  code: string;
  codeType: CodeType;
  /** The block it was read from, shown beside the fields. */
  source: string;
}

export interface CsnContainer {
  no: string;
  /** ISO 6346 size-type, four characters: 22G1, 45G1. */
  size: string;
  load: "FCL" | "LCL";
  sealType: "BTSL" | "ESEAL";
  seal: string;
  soc: boolean;
  weightKg: string;
  packages: string;
}

export interface CsnItem {
  hs: string;
  desc: string;
  /** UN number, "ZZZZZ" when not hazardous. */
  un: string;
  /** IMDG class, "ZZZ" when not hazardous. */
  imdg: string;
  packages: string;
}

export interface CsnPlace {
  code: string;
  name: string;
}

export interface CsnHouse {
  shipmentId: string;
  /** The job reference, for the screen. */
  ref: string;
  hblNo: string;
  /** yyyy-mm-dd */
  hblDate: string;
  /** The custodian code of the CFS or ICD where it is cleared. */
  destPort: string;
  acceptance: CsnPlace;
  receipt: CsnPlace;
  consignor: CsnParty;
  consignee: CsnParty;
  notify: CsnParty;
  description: string;
  marks: string;
  packages: string;
  grossKg: string;
  netKg: string;
  cbm: string;
  items: CsnItem[];
  containers: CsnContainer[];
}

export interface CsnDraft {
  version: 1;
  /** P: a live filing. T: a test file, when ICEGATE asks for one. */
  indicator: "P" | "T";
  vesselImo: string;
  /** The voyage call number the port gives the call (from the shipping line). */
  vcn: string;
  mblNo: string;
  mblDate: string;
  lineNo: string;
  firstPort: string;
  destPort: string;
  nextPort: string;
  movement: "LC" | "DT" | "TI";
  acceptance: CsnPlace;
  receipt: CsnPlace;
  consignor: CsnParty;
  consignee: CsnParty;
  notify: CsnParty;
  description: string;
  marks: string;
  packages: string;
  grossKg: string;
  cbm: string;
  containers: CsnContainer[];
  itinerary: { from: CsnPlace; to: CsnPlace };
  houses: CsnHouse[];
}

// ---------------------------------------------------------------------------
// Reading what the CRM has
// ---------------------------------------------------------------------------

export const emptyParty = (): CsnParty => ({ name: "", street: "", city: "", subdivision: "", country: "", postcode: "", code: "", codeType: "", source: "" });

/** Country names and codes the desk's trade lanes meet, to ISO 3166 alpha-2. */
const COUNTRIES: Array<[RegExp, string]> = [
  [/\b(P\.?\s?R\.?\s?)?CHINA\b|\bPRC\b/i, "CN"],
  [/\bHONG\s?KONG\b|\bH\.?K\.?\b/i, "HK"],
  [/\bSINGAPORE\b/i, "SG"],
  [/\bU\.?A\.?E\.?\b|UNITED ARAB EMIRATES|\bDUBAI\b|\bSHARJAH\b|\bABU DHABI\b|\bJEBEL ALI\b/i, "AE"],
  [/\bU\.?S\.?A\.?\b|UNITED STATES/i, "US"],
  [/\bU\.?K\.?\b|UNITED KINGDOM|\bENGLAND\b|GREAT BRITAIN/i, "GB"],
  [/\bGERMANY\b|DEUTSCHLAND/i, "DE"],
  [/\bITALY\b|\bITALIA\b/i, "IT"],
  [/\bFRANCE\b/i, "FR"],
  [/\bSPAIN\b|ESPA[NÑ]A/i, "ES"],
  [/\bNETHERLANDS\b|\bHOLLAND\b/i, "NL"],
  [/\bBELGIUM\b/i, "BE"],
  [/\bTURKEY\b|T[UÜ]RKIYE/i, "TR"],
  [/\bMALAYSIA\b/i, "MY"],
  [/\bTHAILAND\b/i, "TH"],
  [/\bVIET\s?NAM\b/i, "VN"],
  [/\bINDONESIA\b/i, "ID"],
  [/\b(SOUTH\s)?KOREA\b/i, "KR"],
  [/\bJAPAN\b/i, "JP"],
  [/\bTAIWAN\b/i, "TW"],
  [/\bSRI\s?LANKA\b/i, "LK"],
  [/\bBANGLADESH\b/i, "BD"],
  [/\bSAUDI ARABIA\b|\bK\.?S\.?A\.?\b/i, "SA"],
  [/\bOMAN\b/i, "OM"],
  [/\bQATAR\b/i, "QA"],
  [/\bKUWAIT\b/i, "KW"],
  [/\bBAHRAIN\b/i, "BH"],
  [/\bINDIA\b/i, "IN"],
];

/** States and provinces an address line may end with: India's, China's, and two-letter codes (NJ, CA). */
const REGIONS = new Set(
  [
    "ANDHRA PRADESH", "ARUNACHAL PRADESH", "ASSAM", "BIHAR", "CHHATTISGARH", "GOA", "GUJARAT", "HARYANA", "HIMACHAL PRADESH",
    "JHARKHAND", "KARNATAKA", "KERALA", "MADHYA PRADESH", "MAHARASHTRA", "MANIPUR", "MEGHALAYA", "MIZORAM", "NAGALAND",
    "ODISHA", "ORISSA", "PUNJAB", "RAJASTHAN", "SIKKIM", "TAMIL NADU", "TAMILNADU", "TELANGANA", "TRIPURA", "UTTAR PRADESH",
    "UTTARAKHAND", "WEST BENGAL", "DELHI", "PUDUCHERRY", "PONDICHERRY",
    "GUANGDONG", "ZHEJIANG", "JIANGSU", "SHANDONG", "FUJIAN", "HEBEI", "HENAN", "HUBEI", "HUNAN", "ANHUI", "JIANGXI",
    "SICHUAN", "LIAONING", "SHAANXI", "SHANXI", "YUNNAN", "GUANGXI", "JILIN", "HEILONGJIANG", "HAINAN", "GUIZHOU", "GANSU",
  ].map((s) => s.replace(/\s/g, ""))
);
const isRegion = (s: string) => {
  const k = s.toUpperCase().replace(/\s|PROVINCE|STATE/g, "");
  return REGIONS.has(k) || /^[A-Z]{2}$/.test(s.trim());
};

/** The country a block of address names, if it names one it knows. */
export function countryIn(text: string): string {
  return COUNTRIES.find(([re]) => re.test(text))?.[1] ?? "";
}

/**
 * A party's name and address block, laid out as Customs asks for it: street,
 * city, country, postcode. A guess from free text — the screen shows the block
 * beside the fields so the desk can correct it.
 */
export function partyFrom(name: string, address: string, fallbackCountry = ""): CsnParty {
  const source = [name, address].filter((s) => s.trim()).join("\n");
  let lines = address
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (lines.length === 1 && lines[0].includes(",")) lines = lines[0].split(/,\s*/).filter(Boolean);

  const country = countryIn(lines.slice(-2).join(" ")) || fallbackCountry;
  // The last line that is only the country goes; the country is its own field.
  if (lines.length && countryIn(lines[lines.length - 1]) && lines[lines.length - 1].replace(/[^A-Za-z]/g, "").length <= 22) lines.pop();

  let postcode = "";
  let city = "";
  let subdivision = "";
  if (lines.length) {
    const last = lines[lines.length - 1];
    const pc = last.match(/\b([A-Z]{0,2}\d{4,6}(?:-\d{3,4})?)\b/i);
    if (pc) postcode = pc[1].toUpperCase().replace(/-/g, "").slice(0, 9);
    const parts = last
      .replace(pc?.[0] ?? "", "")
      .split(",")
      // Trailing dashes and colons ("Chennai -"). Written without a bracketed
      // character class: Tailwind scans this file and reads one as a CSS property.
      .map((s) => s.replace(/(-|:|–)+$/, "").trim())
      .filter((s) => /[A-Za-z]{2,}/.test(s));
    // "Ningbo, Zhejiang 315040", "Newark, NJ 07102": a state or province last,
    // with the city before it. "Anna Nagar, Chennai 600040": the city last, and
    // what comes before it is still the street.
    if (lines.length > 1 && parts.length) {
      const lastIsRegion = parts.length >= 2 && isRegion(parts[parts.length - 1]);
      const take = lastIsRegion ? 2 : 1;
      city = parts[parts.length - take];
      subdivision = lastIsRegion ? parts[parts.length - 1] : "";
      lines = lines.slice(0, -1).concat(parts.slice(0, parts.length - take));
    }
  }
  return {
    name: name.trim().replace(/\s+/g, " ").toUpperCase(),
    street: lines.join(", ").toUpperCase(),
    city: city.toUpperCase(),
    subdivision: subdivision.toUpperCase().slice(0, 35),
    country,
    postcode,
    code: "",
    codeType: "",
    source,
  };
}

/** A date as ICEGATE writes it (yyyymmdd), from what the desk types: 2026-09-25, 25/09/2026, 25 Sep 2026. */
export function ymd(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}${m[2].padStart(2, "0")}${m[1].padStart(2, "0")}`;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  m = v.toUpperCase().match(/^(\d{1,2})[\s-]*([A-Z]{3})[A-Z]*[\s,-]*(\d{4})$/);
  if (m && months.includes(m[2])) return `${m[3]}${String(months.indexOf(m[2]) + 1).padStart(2, "0")}${m[1].padStart(2, "0")}`;
  return "";
}

/** A date for the form's date fields (yyyy-mm-dd), from anything `ymd` reads. */
export function isoDate(value: string | null | undefined): string {
  const d = ymd(value);
  return d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : "";
}

/** ISO 6346 size-type from what a job or B/L says: "40HC" → "45G1". */
export function isoSize(sizeType: string | null | undefined, iso?: string | null): string {
  const given = (iso ?? "").trim().toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(given)) return given;
  const s = (sizeType ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z0-9]{2}[A-Z]\d$/.test(s)) return s;
  const size = s.startsWith("45") ? "L5" : s.startsWith("40") ? (/(HC|HQ|HIGH)/.test(s) ? "45" : "42") : s.startsWith("20") ? "22" : "";
  if (!size) return "";
  if (/RF|RH|REEF/.test(s)) return size === "42" ? "45R1" : `${size}R1`;
  if (/OT|OPEN/.test(s)) return `${size === "45" ? "42" : size}U1`;
  if (/FR|FLAT/.test(s)) return `${size === "45" ? "42" : size}P1`;
  if (/TK|TANK/.test(s)) return `${size}T1`;
  return `${size}G1`;
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const numText = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : "";
};

/** What `draftFor` reads: the console, and per job its bill, customs record and containers. */
export interface CsnSource {
  console: {
    mbl_number: string | null;
    mbl_date: string | null;
    pol: string;
    pol_code: string;
    pod: string;
    pod_code: string;
    place_of_delivery: string;
    delivery_code: string;
  };
  jobs: Array<{
    id: string;
    ref: string;
    /** The house B/L the job travels under (received on an import), or null. */
    bill: { hbl_no: string | null; data: Partial<BillData> } | null;
    cfs_code: string;
    containers: Array<{ container_no: string; size_type: string; iso_code: string; seal_type: string; seal_no: string; package_count: number | null; weight_kg: number | null; is_soc: boolean }>;
  }>;
  /** The master line's boxes: the console's own containers. */
  containers: Array<{ container_no: string; size_type: string; iso_code: string; seal_type: string; seal_no: string; package_count: number | null; weight_kg: number | null; is_soc: boolean }>;
  /** Who the carrier's master B/L names: the origin agent ships, the desk receives. */
  mblShipper: { name: string; address: string } | null;
  /** The desk: its address in Customs' parts when known (COMPANY.postal), else a block to read. */
  desk: { name: string; address: string; pan: string; postal?: { street: string; city: string; state: string; postcode: string; country: string } };
}

/** The fields of a house B/L this reads (lib/hbl.ts HblData). */
export interface BillData {
  shipper_name: string;
  shipper_address: string;
  consignee_name: string;
  consignee_address: string;
  consignee_iec: string;
  consignee_gstin: string;
  notify_name: string;
  notify_address: string;
  notify_iec: string;
  port_of_loading: string;
  place_of_delivery: string;
  port_of_discharge: string;
  containers: Array<{ container_no: string; seal_no: string; size_type: string; packages: string; package_type: string; gross_kg: string; cbm: string }>;
  marks_numbers: string;
  packages: string;
  description: string;
  hs_code: string;
  gross_weight_kg: string;
  measurement_cbm: string;
  date_of_issue: string;
  on_board_date: string;
}

const box = (c: CsnSource["containers"][number], load: "FCL" | "LCL"): CsnContainer => ({
  no: (c.container_no ?? "").toUpperCase().replace(/\s/g, ""),
  size: isoSize(c.size_type, c.iso_code),
  load,
  sealType: /E-?SEAL/i.test(c.seal_type ?? "") ? "ESEAL" : "BTSL",
  seal: (c.seal_no ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
  soc: Boolean(c.is_soc),
  weightKg: numText(c.weight_kg),
  packages: numText(c.package_count),
});

/**
 * The form as far as the CRM can fill it. Everything the desk still has to
 * supply — the vessel's IMO number, the voyage call number, the CFS custodian
 * code, anything a B/L did not say — is left blank for `csnProblems` to ask for.
 */
export function draftFor(src: CsnSource, settings: CsnSettings): CsnDraft {
  const c = src.console;
  const pod = (c.pod_code || "").toUpperCase();
  const pol = (c.pol_code || "").toUpperCase();
  const receipt = { code: (c.delivery_code || c.pod_code || "").toUpperCase(), name: c.place_of_delivery || c.pod };
  const originCountry = /^[A-Z]{2}/.test(pol) ? pol.slice(0, 2) : "";
  const cfs = src.jobs.find((j) => j.cfs_code)?.cfs_code ?? "";

  const postal = src.desk.postal;
  const desk: CsnParty = {
    ...(postal
      ? {
          ...emptyParty(),
          name: src.desk.name.toUpperCase(),
          street: postal.street,
          city: postal.city,
          subdivision: postal.state,
          country: postal.country,
          postcode: postal.postcode,
          source: [src.desk.name, src.desk.address].join("\n"),
        }
      : partyFrom(src.desk.name, src.desk.address, "IN")),
    code: settings.pan || src.desk.pan,
    codeType: "PAN",
  };

  const houses: CsnHouse[] = src.jobs.map((j) => {
    const b = j.bill?.data ?? {};
    const consignee = partyFrom(b.consignee_name ?? "", b.consignee_address ?? "", "IN");
    const iec = (b.consignee_iec ?? "").toUpperCase().replace(/\s/g, "");
    consignee.code = iec;
    consignee.codeType = iec ? (/^[A-Z]{5}\d{4}[A-Z]$/.test(iec) ? "PAN" : "IEC") : "";
    const sameAsConsignee = !(b.notify_name ?? "").trim() || /SAME AS CONSIGNEE/i.test(b.notify_name ?? "");
    const notify = sameAsConsignee ? { ...consignee, source: "Same as consignee" } : partyFrom(b.notify_name ?? "", b.notify_address ?? "", "IN");
    const billBoxes = (b.containers ?? []).filter((x) => x.container_no?.trim());
    const jobBoxes = new Map(j.containers.map((x) => [x.container_no.toUpperCase().replace(/\s/g, ""), x]));
    const masterBoxes = new Map(src.containers.map((x) => [x.container_no.toUpperCase().replace(/\s/g, ""), x]));
    const containers: CsnContainer[] = billBoxes.length
      ? billBoxes.map((x) => {
          const no = x.container_no.toUpperCase().replace(/\s/g, "");
          const known = jobBoxes.get(no) ?? masterBoxes.get(no);
          return {
            no,
            size: isoSize(x.size_type || known?.size_type, known?.iso_code),
            load: "LCL",
            sealType: /E-?SEAL/i.test(known?.seal_type ?? "") ? "ESEAL" : "BTSL",
            seal: (x.seal_no || known?.seal_no || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
            soc: Boolean(known?.is_soc),
            weightKg: numText(x.gross_kg) || numText(b.gross_weight_kg),
            packages: numText(x.packages) || numText(b.packages),
          };
        })
      : j.containers.map((x) => box(x, "LCL"));
    const description = (b.description ?? "").trim().replace(/\s+/g, " ").toUpperCase();
    return {
      shipmentId: j.id,
      ref: j.ref,
      hblNo: (j.bill?.hbl_no ?? "").toUpperCase().replace(/\s/g, ""),
      hblDate: isoDate(b.date_of_issue || b.on_board_date),
      destPort: (j.cfs_code || cfs).toUpperCase(),
      acceptance: { code: pol, name: b.port_of_loading || c.pol },
      receipt: { code: receipt.code, name: b.place_of_delivery || receipt.name },
      consignor: partyFrom(b.shipper_name ?? "", b.shipper_address ?? "", originCountry),
      consignee,
      notify,
      description,
      marks: (b.marks_numbers ?? "").trim().replace(/\s+/g, " ").toUpperCase() || "N/M",
      packages: numText(b.packages),
      grossKg: numText(b.gross_weight_kg),
      netKg: "",
      cbm: numText(b.measurement_cbm),
      items: [{ hs: digits(b.hs_code).slice(0, 8), desc: description.slice(0, 256), un: "ZZZZZ", imdg: "ZZZ", packages: numText(b.packages) }],
      containers,
    };
  });

  const sum = (f: (h: CsnHouse) => string) => {
    const t = houses.reduce((n, h) => n + (parseFloat(f(h)) || 0), 0);
    return t ? String(Math.round(t * 1000) / 1000) : "";
  };

  return {
    version: 1,
    indicator: "P",
    vesselImo: "",
    vcn: "",
    mblNo: (c.mbl_number ?? "").toUpperCase().replace(/\s/g, ""),
    mblDate: isoDate(c.mbl_date),
    lineNo: "1",
    firstPort: pod,
    destPort: cfs.toUpperCase(),
    nextPort: pod,
    movement: "LC",
    acceptance: { code: pol, name: c.pol },
    receipt,
    consignor: src.mblShipper ? partyFrom(src.mblShipper.name, src.mblShipper.address, originCountry) : emptyParty(),
    consignee: desk,
    notify: { ...desk, source: "The desk" },
    description: "CONSOLIDATED CARGO AS PER HOUSE BILLS OF LADING",
    marks: "AS PER HOUSE BILLS OF LADING",
    packages: sum((h) => h.packages),
    grossKg: sum((h) => h.grossKg),
    cbm: sum((h) => h.cbm),
    containers: src.containers.map((x) => box(x, "FCL")),
    itinerary: { from: { code: pol, name: c.pol }, to: { code: pod, name: c.pod } },
    houses,
  };
}

/**
 * The draft as saved, brought up to date with the console: what the desk typed
 * stays, a house B/L added since is filled from the CRM, one taken off goes.
 */
export function mergeDraft(saved: CsnDraft | null | undefined, fresh: CsnDraft): CsnDraft {
  if (!saved || saved.version !== 1) return fresh;
  const kept = new Map(saved.houses.map((h) => [h.shipmentId, h]));
  return { ...fresh, ...saved, houses: fresh.houses.map((h) => kept.get(h.shipmentId) ?? h) };
}

// ---------------------------------------------------------------------------
// ICEGATE's JSON
// ---------------------------------------------------------------------------

export interface CsnFile {
  jobNo: number;
  /** yyyymmdd, India's date. */
  date: string;
  /** "T14:05" */
  time: string;
}

const n = (s: string) => {
  const v = parseFloat(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
};
const opt = <T>(value: T, keep: boolean) => (keep ? value : undefined);
const clean = (s: string) => (s ?? "").trim().replace(/\s+/g, " ");

function transportDoc(acceptance: CsnPlace, receipt: CsnPlace, consignor: CsnParty, consignee: CsnParty, notify: CsnParty, description: string) {
  return {
    prtOfAcptCdd: clean(acceptance.code).toUpperCase(),
    prtOfAcptName: opt(clean(acceptance.name), !!clean(acceptance.name)),
    prtOfReceiptCdd: clean(receipt.code).toUpperCase(),
    prtOfReceiptName: opt(clean(receipt.name), !!clean(receipt.name)),
    cnsgnrsName: clean(consignor.name),
    cnsgnrsCd: opt(clean(consignor.code), !!clean(consignor.code)),
    cnsgnrCdTyp: opt(consignor.codeType, !!consignor.codeType && !!clean(consignor.code)),
    cnsgnrStreetAddress: clean(consignor.street),
    cnsgnrCity: clean(consignor.city),
    cnsgnrCntrySubDivName: opt(clean(consignor.subdivision), !!clean(consignor.subdivision)),
    cnsgnrCntryCd: clean(consignor.country).toUpperCase(),
    cnsgnrPstcd: opt(clean(consignor.postcode), !!clean(consignor.postcode)),
    cnsgnesName: clean(consignee.name),
    cnsgnesCd: opt(clean(consignee.code), !!clean(consignee.code)),
    typOfCd: opt(consignee.codeType, !!consignee.codeType && !!clean(consignee.code)),
    cnsgneStreetAddress: clean(consignee.street),
    cnsgneCity: clean(consignee.city),
    cnsgneCntrySubDivName: opt(clean(consignee.subdivision), !!clean(consignee.subdivision)),
    cnsgneCntryCd: clean(consignee.country).toUpperCase(),
    cnsgnePstcd: opt(clean(consignee.postcode), !!clean(consignee.postcode)),
    nameOfAnyOtherNotfdParty: clean(notify.name),
    panOfNotfdParty: opt(clean(notify.code), !!clean(notify.code)),
    typOfNotfdPartyCd: opt(notify.codeType, !!notify.codeType && !!clean(notify.code)),
    notfdPartyStreetAddress: clean(notify.street),
    notfdPartyCity: clean(notify.city),
    notfdPartyCntrySubDivName: opt(clean(notify.subdivision), !!clean(notify.subdivision)),
    notfdPartyCntryCd: opt(clean(notify.country).toUpperCase(), !!clean(notify.country)),
    notfdPartyPstcd: opt(clean(notify.postcode), !!clean(notify.postcode)),
    goodsDescAsPerBl: clean(description),
  };
}

const equipment = (list: CsnContainer[]) =>
  list.map((c, i) => ({
    eqmtSeqNo: i + 1,
    eqmtId: clean(c.no).toUpperCase(),
    eqmtTyp: "CN",
    eqmtSize: clean(c.size).toUpperCase(),
    eqmtLoadStatus: c.load,
    eqmtSealTyp: opt(c.sealType, !!clean(c.seal)),
    eqmtSealNmbr: opt(clean(c.seal).toUpperCase(), !!clean(c.seal)),
    socFlag: c.soc ? "Y" : "N",
    cntrWeight: opt(n(c.weightKg), !!clean(c.weightKg)),
    totalNmbrOfPkgs: Math.round(n(c.packages)),
  }));

const measures = (packages: string, marks: string, grossKg: string, netKg: string, cbm: string) => ({
  nmbrOfPkgs: Math.round(n(packages)),
  typsOfPkgs: "PKG",
  marksNoOnPkgs: clean(marks) || "N/M",
  grossWeight: opt(n(grossKg), !!clean(grossKg)),
  netWeight: opt(n(netKg), !!clean(netKg)),
  unitOfWeight: opt("KGS", !!clean(grossKg) || !!clean(netKg)),
});

const itinerary = (d: CsnDraft) => [
  {
    prtOfCallSeqNmbr: 1,
    prtOfCallCdd: clean(d.itinerary.from.code).toUpperCase(),
    prtOfCallName: opt(clean(d.itinerary.from.name), !!clean(d.itinerary.from.name)),
    nxtPrtOfCallCdd: clean(d.itinerary.to.code).toUpperCase(),
    nxtPrtOfCallName: opt(clean(d.itinerary.to.name), !!clean(d.itinerary.to.name)),
    modeOfTrnsprt: "1",
  },
];

const location = (d: CsnDraft, destPort: string) => ({
  firstPrtOfEntry: clean(d.firstPort).toUpperCase(),
  destPrt: clean(destPort || d.destPort).toUpperCase(),
  nxtPrtOfUnlading: clean(d.nextPort).toUpperCase(),
  typOfCrgo: "IM",
  itemTyp: "OT",
  crgoMvmt: d.movement,
  natrOfCrgo: "C",
});

/** Undefined values out, so the file carries only what was given. */
function prune<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The declaration, without `digSign` (ICEGATE's signing utility adds it). */
export function buildCsn(d: CsnDraft, settings: CsnSettings, file: CsnFile): Record<string, unknown> {
  const pan = clean(settings.pan).toUpperCase();
  const port = clean(settings.port_of_reporting).toUpperCase();
  const boxes = new Set([...d.containers.map((c) => clean(c.no).toUpperCase()), ...d.houses.flatMap((h) => h.containers.map((c) => clean(c.no).toUpperCase()))]);
  return prune({
    headerField: {
      senderID: clean(settings.icegate_id).toUpperCase(),
      receiverID: port,
      versionNo: "SCE1102",
      indicator: d.indicator,
      messageID: "SACHM22",
      sequenceOrControlNumber: file.jobNo,
      date: file.date,
      time: file.time,
      reportingEvent: "SCE",
    },
    master: {
      decRef: { msgTyp: "F", prtofRptng: port, jobNo: file.jobNo, jobDt: file.date, rptngEvent: "SCE" },
      authPrsn: { sbmtrTyp: "ANC", sbmtrCd: pan, authReprsntvCd: clean(settings.authorised_pan).toUpperCase() },
      vesselDtls: { modeOfTrnsprt: "1", typOfTrnsprtMeans: "10", trnsprtMeansId: clean(d.vesselImo) },
      voyageDtls: {
        cnvnceRefNmbr: clean(d.vcn).toUpperCase(),
        totalNoOfTrnsprtEqmtMnfsted: [...boxes].filter(Boolean).length,
        totalNmbrOfLines: 1,
      },
      mastrCnsgmtDec: [
        {
          MCRef: {
            lineNo: Math.round(n(d.lineNo)) || 1,
            mstrBlNo: clean(d.mblNo).toUpperCase(),
            mstrBlDt: ymd(d.mblDate),
            consolidatedIndctr: "C",
            prevDec: "N",
            consolidatorPan: `PAN:${pan}`,
          },
          locCstm: location(d, d.destPort),
          trnsprtDoc: transportDoc(d.acceptance, d.receipt, d.consignor, d.consignee, d.notify, d.description),
          trnsprtDocMsr: measures(d.packages, d.marks, d.grossKg, "", d.cbm),
          trnsprtEqmt: equipment(d.containers),
          itnry: itinerary(d),
          houseCargoDec: d.houses.map((h, i) => ({
            HCRef: {
              subLineNo: i + 1,
              blNo: clean(h.hblNo).toUpperCase(),
              blDt: ymd(h.hblDate),
              consolidatedIndctr: "H",
              consolidatorPan: `PAN:${pan}`,
              prevDec: "N",
            },
            locCstm: location(d, h.destPort),
            trnsprtDoc: transportDoc(h.acceptance, h.receipt, h.consignor, h.consignee, h.notify, h.description),
            trnsprtDocMsr: measures(h.packages, h.marks, h.grossKg, h.netKg, h.cbm),
            itemDtls: h.items.map((it, k) => ({
              crgoItemSeqNmbr: k + 1,
              hsCd: digits(it.hs),
              crgoItemDesc: opt(clean(it.desc).slice(0, 256), !!clean(it.desc)),
              unoCd: clean(it.un).toUpperCase() || "ZZZZZ",
              imdgCd: clean(it.imdg).toUpperCase() || "ZZZ",
              nmbrOfPkgs: opt(Math.round(n(it.packages)), !!clean(it.packages)),
              typOfPkgs: opt("PKG", !!clean(it.packages)),
            })),
            trnsprtEqmt: equipment(h.containers),
            itnry: itinerary(d),
          })),
        },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// The official schema, checked
// ---------------------------------------------------------------------------

export interface SchemaNode {
  type?: string;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface SchemaError {
  path: string;
  message: string;
}

/**
 * The schema's rules, checked the way ICEGATE's structural validation does
 * (the SFL reply): type, required, length, range and pattern, which is every
 * keyword CBIC's CSN schema uses. `unsigned` leaves out the digSign block,
 * which the signing utility adds after this file is made.
 */
export function schemaErrors(value: unknown, schema: SchemaNode = CSN_SCHEMA, opts: { unsigned?: boolean } = {}): SchemaError[] {
  const out: SchemaError[] = [];
  const walk = (v: unknown, s: SchemaNode, path: string, root: boolean) => {
    if (!s) return;
    const t = s.type;
    if (t === "object" || s.properties) {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        out.push({ path, message: "should be an object" });
        return;
      }
      const obj = v as Record<string, unknown>;
      for (const key of s.required ?? []) {
        if (root && opts.unsigned && key === "digSign") continue;
        if (obj[key] === undefined) out.push({ path: path ? `${path}.${key}` : key, message: "is required" });
      }
      for (const [key, sub] of Object.entries(s.properties ?? {})) {
        if (obj[key] !== undefined) walk(obj[key], sub, path ? `${path}.${key}` : key, false);
      }
      return;
    }
    if (t === "array" || s.items) {
      if (!Array.isArray(v)) {
        out.push({ path, message: "should be a list" });
        return;
      }
      v.forEach((item, i) => walk(item, s.items as SchemaNode, `${path}[${i}]`, false));
      return;
    }
    if (t === "string") {
      if (typeof v !== "string") {
        out.push({ path, message: "should be text" });
        return;
      }
      if (s.minLength !== undefined && v.length < s.minLength) out.push({ path, message: v.length ? `is shorter than ${s.minLength} characters` : "is empty" });
      if (s.maxLength !== undefined && v.length > s.maxLength) out.push({ path, message: `is ${v.length} characters; the most is ${s.maxLength}` });
      if (s.pattern && v !== "" && !new RegExp(s.pattern).test(v)) out.push({ path, message: "is not in the format ICEGATE expects" });
      return;
    }
    if (t === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        out.push({ path, message: "should be a number" });
        return;
      }
      if (s.minimum !== undefined && v < s.minimum) out.push({ path, message: `is below ${s.minimum}` });
      if (s.maximum !== undefined && v > s.maximum) out.push({ path, message: `is above ${s.maximum}` });
    }
  };
  walk(value, schema, "", true);
  return out;
}

// ---------------------------------------------------------------------------
// What stands between the form and an accepted file
// ---------------------------------------------------------------------------

export interface CsnProblem {
  /** "Settings", "Master", or the house B/L's job reference. */
  where: string;
  field: string;
  message: string;
  /** Warnings do not stop the file; errors do. */
  level: "error" | "warning";
}

const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const LOCODE = /^[A-Z]{2}[A-Z0-9]{3}$/;
const CONTAINER = /^[A-Z]{4}\d{7}$/;

const FIELD: Record<string, string> = {
  senderID: "ICEGATE ID",
  receiverID: "Port of reporting",
  prtofRptng: "Port of reporting",
  sbmtrCd: "Desk PAN",
  authReprsntvCd: "Authorised person's PAN",
  trnsprtMeansId: "Vessel IMO number",
  cnvnceRefNmbr: "Voyage call number (VCN)",
  mstrBlNo: "Master B/L number",
  mstrBlDt: "Master B/L date",
  blNo: "House B/L number",
  blDt: "House B/L date",
  firstPrtOfEntry: "First port of entry",
  destPrt: "CFS / ICD custodian code",
  nxtPrtOfUnlading: "Next port of unlading",
  prtOfAcptCdd: "Port of acceptance code",
  prtOfReceiptCdd: "Port of receipt code",
  cnsgnrsName: "Shipper's name",
  cnsgnrStreetAddress: "Shipper's street address",
  cnsgnrCity: "Shipper's city",
  cnsgnrCntryCd: "Shipper's country",
  cnsgnesName: "Consignee's name",
  cnsgnesCd: "Consignee's IEC / PAN",
  cnsgneStreetAddress: "Consignee's street address",
  cnsgneCity: "Consignee's city",
  cnsgneCntryCd: "Consignee's country",
  nameOfAnyOtherNotfdParty: "Notify party's name",
  notfdPartyStreetAddress: "Notify party's street address",
  notfdPartyCity: "Notify party's city",
  goodsDescAsPerBl: "Description of goods",
  nmbrOfPkgs: "Number of packages",
  marksNoOnPkgs: "Marks and numbers",
  hsCd: "HS code",
  unoCd: "UN number",
  imdgCd: "IMDG class",
  eqmtId: "Container number",
  eqmtSize: "Container size-type (ISO)",
  eqmtSealNmbr: "Seal number",
  totalNmbrOfPkgs: "Packages in the container",
  prtOfCallCdd: "Itinerary: port of call",
  nxtPrtOfCallCdd: "Itinerary: next port",
};

/** Where in the form a schema path points: Settings, Master, or a house. */
function place(path: string, d: CsnDraft): string {
  const h = path.match(/houseCargoDec\[(\d+)\]/);
  if (h) return d.houses[Number(h[1])]?.ref || `House ${Number(h[1]) + 1}`;
  if (/^headerField|decRef|authPrsn/.test(path.replace(/^master\./, ""))) return "Settings";
  return "Master";
}

/**
 * Every reason ICEGATE would turn the file away, in the desk's words: the
 * official schema run over the file this form makes, then the rules the guide
 * states in words, which a schema cannot.
 */
export function csnProblems(d: CsnDraft, settings: CsnSettings): CsnProblem[] {
  const out: CsnProblem[] = [];
  const add = (where: string, field: string, message: string, level: CsnProblem["level"] = "error") => out.push({ where, field, message, level });

  // The desk.
  if (!clean(settings.icegate_id)) add("Settings", "ICEGATE ID", "is not set");
  if (!PAN.test(clean(settings.pan).toUpperCase())) add("Settings", "Desk PAN", settings.pan ? "is not a PAN (five letters, four digits, a letter)" : "is not set");
  if (!PAN.test(clean(settings.authorised_pan).toUpperCase())) add("Settings", "Authorised person's PAN", settings.authorised_pan ? "is not a PAN" : "is not set");
  if (!/^IN[A-Z0-9]{4}$/.test(clean(settings.port_of_reporting).toUpperCase())) add("Settings", "Port of reporting", settings.port_of_reporting ? "should look like INMAA1" : "is not set");

  // The call and the master line.
  if (!/^\d{7}$/.test(clean(d.vesselImo))) add("Master", "Vessel IMO number", d.vesselImo ? "should be the ship's seven-digit IMO number" : "is needed (seven digits, from the shipping line)");
  if (!clean(d.vcn)) add("Master", "Voyage call number (VCN)", "is needed (from the shipping line's agent)");
  if (!clean(d.mblNo)) add("Master", "Master B/L number", "is needed");
  if (!ymd(d.mblDate)) add("Master", "Master B/L date", "is needed");
  const codes: Array<[string, string, string]> = [
    ["Master", "First port of entry", d.firstPort],
    ["Master", "Next port of unlading", d.nextPort],
    ["Master", "Port of acceptance code", d.acceptance.code],
    ["Master", "Port of receipt code", d.receipt.code],
    ["Master", "Itinerary: port of call", d.itinerary.from.code],
    ["Master", "Itinerary: next port", d.itinerary.to.code],
  ];
  for (const [where, field, code] of codes) {
    if (!LOCODE.test(clean(code).toUpperCase())) add(where, field, code ? `"${code}" is not a UN/LOCODE (five letters, like INMAA)` : "is needed (a UN/LOCODE, like INMAA)");
  }
  if (!/^[A-Z0-9]{5,10}$/.test(clean(d.destPort).toUpperCase())) add("Master", "CFS / ICD custodian code", d.destPort ? "should be 5 to 10 letters and digits" : "is needed (the custodian code of the CFS where it will be cleared)");
  if (!d.containers.length) add("Master", "Containers", "the master line needs its containers");
  checkBoxes("Master", d.containers, add);

  // Each house B/L.
  if (!d.houses.length) add("Master", "House B/Ls", "there are no jobs on this console to declare");
  const seen = new Set<string>();
  for (const h of d.houses) {
    const w = h.ref || h.hblNo || "House";
    if (!clean(h.hblNo)) add(w, "House B/L number", "is needed");
    else if (seen.has(clean(h.hblNo).toUpperCase())) add(w, "House B/L number", "appears twice on this console");
    seen.add(clean(h.hblNo).toUpperCase());
    if (!ymd(h.hblDate)) add(w, "House B/L date", "is needed");
    if (h.destPort && !/^[A-Z0-9]{5,10}$/.test(clean(h.destPort).toUpperCase())) add(w, "CFS / ICD custodian code", "should be 5 to 10 letters and digits");
    for (const [field, code] of [["Port of acceptance code", h.acceptance.code], ["Port of receipt code", h.receipt.code]] as const) {
      if (!LOCODE.test(clean(code).toUpperCase())) add(w, field, code ? `"${code}" is not a UN/LOCODE` : "is needed (a UN/LOCODE)");
    }
    const iec = clean(h.consignee.code).toUpperCase();
    if (!iec) add(w, "Consignee's IEC / PAN", "is needed on an import (the importer's IEC, or PAN if they have none)");
    else if (h.consignee.codeType === "IEC" && !/^[A-Z0-9]{10}$/.test(iec)) add(w, "Consignee's IEC / PAN", "an IEC is ten characters");
    else if (h.consignee.codeType === "PAN" && !PAN.test(iec)) add(w, "Consignee's IEC / PAN", "is not a PAN");
    if (!(n(h.packages) > 0)) add(w, "Number of packages", "is needed");
    if (!(n(h.grossKg) > 0)) add(w, "Gross weight", "is needed", "warning");
    if (!h.items.length) add(w, "Items", "needs at least one cargo item with its HS code");
    h.items.forEach((it, k) => {
      const hs = digits(it.hs);
      if (!/^\d{4,8}$/.test(hs)) add(w, `Item ${k + 1}: HS code`, hs ? "should be 4 to 8 digits" : "is needed");
      else if (hs.length < 8) add(w, `Item ${k + 1}: HS code`, "Customs prefers the full eight-digit code", "warning");
    });
    if (!h.containers.length) add(w, "Containers", "which container is this house B/L in?");
    checkBoxes(w, h.containers, add);
    const inBoxes = h.containers.reduce((s, c) => s + n(c.packages), 0);
    if (h.containers.length && n(h.packages) && inBoxes && Math.round(inBoxes) !== Math.round(n(h.packages))) {
      add(w, "Packages in the container", `the containers hold ${inBoxes} and the bill says ${n(h.packages)}`, "warning");
    }
  }
  const housePkgs = d.houses.reduce((s, h) => s + n(h.packages), 0);
  if (housePkgs && n(d.packages) && Math.round(housePkgs) !== Math.round(n(d.packages))) {
    add("Master", "Number of packages", `the house B/Ls add up to ${housePkgs}, the master line says ${n(d.packages)}`, "warning");
  }

  // Then the official schema over the file itself, for anything the rules
  // above did not already name (lengths above all: 70 for an address line).
  const said = new Set(out.map((p) => `${p.where}|${p.field}`));
  for (const e of schemaErrors(buildCsn(d, settings, { jobNo: 1, date: "20260101", time: "T00:00" }), CSN_SCHEMA, { unsigned: true })) {
    const key = e.path.split(".").pop()!.replace(/\[\d+\]$/, "");
    const where = place(e.path, d);
    const field = FIELD[key] ?? key;
    if (said.has(`${where}|${field}`)) continue;
    said.add(`${where}|${field}`);
    add(where, field, e.message);
  }
  return out;
}

function checkBoxes(where: string, list: CsnContainer[], add: (where: string, field: string, message: string, level?: CsnProblem["level"]) => void) {
  list.forEach((c) => {
    const label = c.no || "A container";
    if (!CONTAINER.test(clean(c.no).toUpperCase())) add(where, `Container ${label}`, c.no ? "is not a container number (four letters, seven digits)" : "needs its number");
    if (!/^[A-Z0-9]{4}$/.test(clean(c.size).toUpperCase())) add(where, `Container ${label}: size-type`, "needs its ISO code, like 22G1 or 45G1");
    if (!clean(c.seal)) add(where, `Container ${label}: seal`, "has no seal number", "warning");
  });
}

/** The file's contents, as ICEGATE reads them. */
export const csnJson = (doc: Record<string, unknown>) => JSON.stringify(doc, null, 2);
