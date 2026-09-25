import { defaultCharges, emptyContainer, emptyHbl, type HblData, type ReleaseMode } from "./hbl";

/**
 * A house B/L somebody else issued, received on our job (088).
 *
 * ---------------------------------------------------------------------------
 * WHEN THIS IS THE BILL
 *
 * On an import the origin agent — World Jaguar in Qingdao, say — issues the
 * house B/L and names us as the party to apply to for delivery. We do not
 * issue anything; we receive their draft, check it against our job, confirm
 * it or send corrections, file the house-level manifest (CSN) as the consol
 * agent, and release the cargo against it with our delivery order.
 *
 * The boxes are the same as on our own B/L (lib/hbl.ts), so the same form
 * shows them; this file is what is different about receiving one: comparing
 * it with the job, the release checklist, the CSN deadline, filling the job's
 * blanks from it, and reading an AI reading of the PDF into boxes.
 *
 * Pure, so it is tested under Node (scripts/tests/receivedHbl.test.ts).
 * ---------------------------------------------------------------------------
 */

/** draft: their draft is in, for us to check · confirmed: we told them it is right · final: the issued bill is in. */
export type ReceivedStage = "draft" | "confirmed" | "final";

export const STAGE_LABEL: Record<ReceivedStage, string> = {
  draft: "Draft received — to check",
  confirmed: "Draft confirmed to the agent",
  final: "Final B/L received",
};

// ---------------------------------------------------------------------------
// Checking their draft against our job
// ---------------------------------------------------------------------------

/** What the comparison reads off the job. */
export interface JobForCheck {
  shipper_name: string | null;
  consignee_name: string | null;
  consignee_iec: string | null;
  consignee_gstin: string | null;
  notify_name: string | null;
  port_of_loading: string | null;
  origin: string | null;
  port_of_discharge: string | null;
  destination: string | null;
  vessel: string | null;
  voyage: string | null;
  package_count: number | null;
  piece_count: number | null;
  gross_weight_kg: number | string | null;
  volume_cbm: number | string | null;
  freight_terms: "prepaid" | "collect" | null;
  hs_code: string | null;
}

export type CheckState = "same" | "differs" | "missing_on_bill" | "not_on_job";

export interface CheckRow {
  key: string;
  label: string;
  theirs: string;
  ours: string;
  state: CheckState;
}

const clean = (s: string | null | undefined) =>
  (s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Words that say what kind of company it is, not which one. */
const FORM_WORDS = new Set(["PVT", "PRIVATE", "LTD", "LIMITED", "CO", "COMPANY", "INC", "LLC", "LLP", "CORP", "CORPORATION", "THE", "M", "S", "MS"]);
const nameKey = (s: string | null | undefined) =>
  clean(s)
    .split(" ")
    .filter((w) => w && !FORM_WORDS.has(w))
    .join(" ");

/** Same company, however the suffix or punctuation is written: one name inside the other. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
}

/** "QINGDAO" and "Qingdao, China" are the same port; so are "CHENNAI" and "INMAA CHENNAI". */
export function samePlace(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const wx = new Set(x.split(" ").filter((w) => w.length > 2));
  return y.split(" ").some((w) => w.length > 2 && wx.has(w));
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, "").replace(/[^0-9.]+/g, " ").trim().split(" ")[0]);
  return Number.isFinite(n) ? n : null;
};

/** Within half a per cent, or a kilo: a rounding on one side is not a discrepancy. */
const closeKg = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.max(a, b) * 0.005);
const closeCbm = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.max(a, b) * 0.02);

const idKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Their draft against our job, box by box.
 *
 * A row for each box either side has; "same" where they agree the way a
 * person checking would call it (names without their Pvt Ltd, weights to a
 * rounding), "differs" where they do not, and a blank on either side said
 * as such. `ourName` is who the bill should send the consignee to for
 * delivery, on an import.
 */
export function checkAgainstJob(bill: HblData, job: JobForCheck, ourName?: string): CheckRow[] {
  const rows: CheckRow[] = [];
  const add = (key: string, label: string, theirs: string, ours: string, same: (a: string, b: string) => boolean) => {
    const t = theirs.trim();
    const o = ours.trim();
    if (!t && !o) return;
    rows.push({ key, label, theirs: t, ours: o, state: !t ? "missing_on_bill" : !o ? "not_on_job" : same(t, o) ? "same" : "differs" });
  };
  const text = (a: string, b: string) => clean(a) === clean(b);
  const numeric = (close: (a: number, b: number) => boolean) => (a: string, b: string) => {
    const x = num(a);
    const y = num(b);
    return x !== null && y !== null && close(x, y);
  };

  add("shipper_name", "Shipper", bill.shipper_name, job.shipper_name ?? "", sameName);
  add("consignee_name", "Consignee", bill.consignee_name, job.consignee_name ?? "", sameName);
  add("consignee_iec", "Consignee IEC", bill.consignee_iec, job.consignee_iec ?? "", (a, b) => idKey(a) === idKey(b));
  add("consignee_gstin", "Consignee GSTIN", bill.consignee_gstin, job.consignee_gstin ?? "", (a, b) => idKey(a) === idKey(b));
  // "Same as consignee" on the bill, and a job with no notify party of its
  // own, both notify the consignee.
  const notifyTheirs = /^SAME AS CONSIGNEE/i.test(bill.notify_name.trim()) ? bill.consignee_name : bill.notify_name;
  add("notify_name", "Notify party", notifyTheirs, job.notify_name || job.consignee_name || "", sameName);
  add("port_of_loading", "Port of loading", bill.port_of_loading, job.port_of_loading ?? job.origin ?? "", samePlace);
  add("port_of_discharge", "Port of discharge", bill.port_of_discharge, job.port_of_discharge ?? job.destination ?? "", samePlace);
  add("vessel", "Vessel", bill.vessel, job.vessel ?? "", sameName);
  add("voyage", "Voyage", bill.voyage, job.voyage ?? "", (a, b) => idKey(a) === idKey(b));
  const pkgs = job.package_count ?? job.piece_count;
  add("packages", "Packages", bill.packages, pkgs ? String(pkgs) : "", numeric((a, b) => a === b));
  add("gross_weight_kg", "Gross weight (kg)", bill.gross_weight_kg, job.gross_weight_kg != null ? String(job.gross_weight_kg) : "", numeric(closeKg));
  add("measurement_cbm", "Measurement (CBM)", bill.measurement_cbm, job.volume_cbm != null ? String(job.volume_cbm) : "", numeric(closeCbm));
  add("freight_terms", "Freight", bill.freight_terms.toUpperCase(), (job.freight_terms ?? "").toUpperCase(), text);
  add("hs_code", "HS code", bill.hs_code, job.hs_code ?? "", (a, b) => {
    const x = idKey(a);
    const y = idKey(b);
    return x.startsWith(y) || y.startsWith(x);
  });
  if (ourName) {
    add("delivery_agent", "Apply to for delivery", bill.delivery_agent.split("\n")[0] ?? "", ourName, sameName);
  }
  return rows;
}

/** The corrections to send back, one line per box that is wrong or missing. Empty when the draft is right. */
export function correctionsText(rows: CheckRow[], billNo: string): string {
  const wrong = rows.filter((r) => r.state === "differs" || r.state === "missing_on_bill");
  if (!wrong.length) return "";
  return [
    `Please amend the draft B/L${billNo ? ` ${billNo}` : ""} as follows:`,
    ...wrong.map((r) => (r.state === "differs" ? `- ${r.label}: shows "${r.theirs}", should read "${r.ours}"` : `- ${r.label}: missing, should read "${r.ours}"`)),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Filling the job from their bill
// ---------------------------------------------------------------------------

export interface JobBlanks extends JobForCheck {
  shipper_address: string | null;
  consignee_address: string | null;
  notify_address: string | null;
  package_type: string | null;
  marks_and_numbers: string | null;
  cargo: string | null;
}

/**
 * The job's empty boxes, filled from the bill.
 *
 * On an import the agent's B/L is often the first full statement of the
 * cargo we get. Only blanks: anything the job already says was said by
 * somebody on purpose, and a difference is for `checkAgainstJob` to show, not
 * for this to overwrite. Returns the patch and what it filled, in words.
 */
export function jobBlanksFromBill(bill: HblData, job: JobBlanks): { patch: Record<string, string | number>; filled: string[] } {
  const patch: Record<string, string | number> = {};
  const filled: string[] = [];
  const fill = (col: keyof JobBlanks, value: string | number | null, label: string) => {
    const now = job[col];
    const empty = now === null || now === undefined || String(now).trim() === "";
    if (!empty || value === null || value === "") return;
    patch[col] = value;
    filled.push(label);
  };
  const t = (s: string) => s.trim() || null;
  fill("shipper_name", t(bill.shipper_name), "shipper");
  fill("shipper_address", t(bill.shipper_address), "shipper's address");
  fill("consignee_name", t(bill.consignee_name), "consignee");
  fill("consignee_address", t(bill.consignee_address), "consignee's address");
  fill("consignee_iec", t(bill.consignee_iec), "consignee IEC");
  fill("consignee_gstin", t(bill.consignee_gstin), "consignee GSTIN");
  // A notify party that is the consignee again is no notify party of its own.
  if (!/^SAME AS CONSIGNEE/i.test(bill.notify_name.trim()) && !sameName(bill.notify_name, bill.consignee_name)) {
    fill("notify_name", t(bill.notify_name), "notify party");
    fill("notify_address", t(bill.notify_address), "notify party's address");
  }
  fill("vessel", t(bill.vessel), "vessel");
  fill("voyage", t(bill.voyage), "voyage");
  fill("port_of_loading", t(bill.port_of_loading), "port of loading");
  fill("port_of_discharge", t(bill.port_of_discharge), "port of discharge");
  const pkgs = num(bill.packages);
  if (job.piece_count == null) fill("package_count", pkgs !== null ? Math.round(pkgs) : null, "packages");
  fill("package_type", t(bill.package_type), "kind of packages");
  const kg = num(bill.gross_weight_kg);
  fill("gross_weight_kg", kg, "gross weight");
  const cbm = num(bill.measurement_cbm);
  fill("volume_cbm", cbm, "measurement");
  fill("marks_and_numbers", t(bill.marks_numbers), "marks");
  fill("hs_code", t(bill.hs_code), "HS code");
  fill("cargo", t(bill.description), "description");
  if (!job.freight_terms) {
    patch.freight_terms = bill.freight_terms;
    filled.push("freight terms");
  }
  return { patch, filled };
}

// ---------------------------------------------------------------------------
// Release: what has to be true before our delivery order goes out
// ---------------------------------------------------------------------------

export interface ReleaseInput {
  stage: ReceivedStage;
  release_mode: ReleaseMode;
  issuer_name: string;
  freight_terms: "prepaid" | "collect";
  originals_surrendered_on: string | null;
  telex_received_on: string | null;
  charges_cleared_on: string | null;
}

export interface ReleaseItem {
  key: "final" | "originals_surrendered_on" | "telex_received_on" | "charges_cleared_on";
  label: string;
  done: boolean;
  /** The date it was ticked, when it is a dated tick. */
  on: string | null;
}

/**
 * The checklist for releasing the cargo.
 *
 * The final bill in; the title given up the way its release mode says —
 * one original surrendered by the consignee, the telex release from the
 * issuer, or nothing for a sea waybill; and the money paid. The DO is issued
 * when every line is done. Customs clearance is the terminal's condition,
 * printed on the DO, not ours to wait for.
 */
export function releaseChecklist(r: ReleaseInput): { items: ReleaseItem[]; ready: boolean } {
  const items: ReleaseItem[] = [{ key: "final", label: "Final B/L received from the agent", done: r.stage === "final", on: null }];
  if (r.release_mode === "original") {
    items.push({ key: "originals_surrendered_on", label: "An original B/L surrendered by the consignee", done: Boolean(r.originals_surrendered_on), on: r.originals_surrendered_on });
  } else if (r.release_mode === "telex") {
    items.push({ key: "telex_received_on", label: `Telex release received from ${r.issuer_name.trim() || "the agent"}`, done: Boolean(r.telex_received_on), on: r.telex_received_on });
  }
  items.push({
    key: "charges_cleared_on",
    label: r.freight_terms === "collect" ? "Freight (collect) and local charges paid" : "Local charges paid",
    done: Boolean(r.charges_cleared_on),
    on: r.charges_cleared_on,
  });
  return { items, ready: items.every((i) => i.done) };
}

// ---------------------------------------------------------------------------
// The CSN: the house-level manifest we file as consol agent
// ---------------------------------------------------------------------------

/** The desk's rule: the CSN goes in 72 hours before the vessel's ETA. */
export const CSN_LEAD_HOURS = 72;

export type CsnState = "filed" | "no_eta" | "ok" | "soon" | "overdue";

/**
 * When the CSN is due and how that stands now.
 *
 * The ETA is a date (and sometimes a time) at the port, in India: read as
 * IST, midnight when there is no time. "Soon" is inside a day.
 */
export function csnDue(eta: string | null, etaTime: string | null, filedOn: string | null, now: Date = new Date()): { state: CsnState; due: Date | null; hoursLeft: number | null } {
  if (!eta) return { state: filedOn ? "filed" : "no_eta", due: null, hoursLeft: null };
  const time = /^\d{1,2}:\d{2}/.test(etaTime ?? "") ? (etaTime as string).slice(0, 5).padStart(5, "0") : "00:00";
  const arrival = new Date(`${eta.slice(0, 10)}T${time}:00+05:30`);
  const due = new Date(arrival.getTime() - CSN_LEAD_HOURS * 3_600_000);
  const hoursLeft = Math.round((due.getTime() - now.getTime()) / 3_600_000);
  if (filedOn) return { state: "filed", due, hoursLeft };
  return { state: hoursLeft < 0 ? "overdue" : hoursLeft <= 24 ? "soon" : "ok", due, hoursLeft };
}

// ---------------------------------------------------------------------------
// Reading an AI reading of their PDF into boxes
// ---------------------------------------------------------------------------

/** What classify-enquiry's "hbl" mode returns: every box as text, null when not on the page. */
export interface BillReading {
  is_bill_of_lading?: boolean | null;
  issuer?: string | null;
  bl_no?: string | null;
  other_reference?: string | null;
  draft_or_copy?: boolean | null;
  shipper_name?: string | null;
  shipper_address?: string | null;
  consignee_name?: string | null;
  consignee_address?: string | null;
  consignee_contact?: string | null;
  consignee_iec?: string | null;
  consignee_gstin?: string | null;
  notify_name?: string | null;
  notify_address?: string | null;
  notify_iec?: string | null;
  notify_gstin?: string | null;
  delivery_agent?: string | null;
  place_of_receipt?: string | null;
  vessel?: string | null;
  voyage?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  place_of_delivery?: string | null;
  service_type?: string | null;
  containers?: Array<{ container_no?: string | null; seal_no?: string | null; size_type?: string | null; packages?: string | null; package_type?: string | null; gross_kg?: string | null; cbm?: string | null }> | null;
  marks_numbers?: string | null;
  packages?: string | null;
  package_type?: string | null;
  description?: string | null;
  hs_code?: string | null;
  gross_weight_kg?: string | null;
  measurement_cbm?: string | null;
  freight_terms?: string | null;
  freight_payable_at?: string | null;
  place_of_issue?: string | null;
  date_of_issue?: string | null;
  on_board_date?: string | null;
  originals?: string | null;
}

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
/** A reference as printed, without the spaces a reading can put in it: "HBL/26-27/0001" keeps its slashes. */
const ref = (s: string | null | undefined) => up(s).replace(/\s+/g, "");
const isoDate = (s: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}/.test(s ?? "") ? (s as string).slice(0, 10) : "");
/** "330KGS" → "330"; "0.4CBM" → "0.4": the figure, without the unit the box already says. */
const figure = (s: string | null | undefined) => {
  const n = num(s);
  return n === null ? "" : String(n);
};

/** "SAID TO CONTAIN" is a clause, not part of the goods: lifted off the description into its tick. */
function splitSaidToContain(description: string): { said: boolean; goods: string } {
  const m = description.match(/^\s*(S\.?T\.?C\.?|SAID TO CONTAIN(?:S)?)\s*:?\s*/i);
  return m ? { said: true, goods: description.slice(m[0].length).trim() } : { said: false, goods: description.trim() };
}

/**
 * The reading as the boxes of the form, and the bill's own particulars.
 * Upper case throughout, as a B/L is written; dates only when read as dates.
 */
export function billFromReading(r: BillReading): { data: HblData; issuer: string; blNo: string; otherRef: string; originals: number | null; draft: boolean } {
  const d = emptyHbl();
  d.shipper_name = up(r.shipper_name);
  d.shipper_address = up(r.shipper_address);
  d.consignee_name = up(r.consignee_name);
  d.consignee_address = up(r.consignee_address);
  d.consignee_contact = up(r.consignee_contact);
  d.consignee_iec = idKey(r.consignee_iec);
  d.consignee_gstin = idKey(r.consignee_gstin);
  d.notify_name = up(r.notify_name);
  d.notify_address = up(r.notify_address);
  d.notify_iec = idKey(r.notify_iec);
  d.notify_gstin = idKey(r.notify_gstin);
  d.delivery_agent = up(r.delivery_agent);
  d.place_of_receipt = up(r.place_of_receipt);
  d.vessel = up(r.vessel);
  d.voyage = up(r.voyage);
  d.port_of_loading = up(r.port_of_loading);
  d.port_of_discharge = up(r.port_of_discharge);
  d.place_of_delivery = up(r.place_of_delivery);
  d.service_type = up(r.service_type);
  d.containers = (r.containers ?? []).map((c) => ({
    ...emptyContainer(),
    container_no: idKey(c.container_no),
    seal_no: up(c.seal_no),
    size_type: up(c.size_type),
    packages: figure(c.packages),
    package_type: up(c.package_type),
    gross_kg: figure(c.gross_kg),
    cbm: figure(c.cbm),
  }));
  d.marks_numbers = up(r.marks_numbers);
  d.packages = figure(r.packages);
  d.package_type = up(r.package_type);
  const said = splitSaidToContain(up(r.description));
  d.said_to_contain = said.said;
  d.description = said.goods;
  d.hs_code = up(r.hs_code);
  d.gross_weight_kg = figure(r.gross_weight_kg);
  d.measurement_cbm = figure(r.measurement_cbm);
  d.freight_terms = /COLLECT/i.test(r.freight_terms ?? "") ? "collect" : "prepaid";
  d.charges = defaultCharges(d.freight_terms);
  d.freight_payable_at = up(r.freight_payable_at);
  d.place_of_issue = up(r.place_of_issue);
  d.date_of_issue = isoDate(r.date_of_issue);
  d.on_board_date = isoDate(r.on_board_date);
  const originals = num(r.originals);
  return {
    data: d,
    issuer: up(r.issuer),
    blNo: ref(r.bl_no),
    otherRef: ref(r.other_reference),
    originals: originals !== null && originals >= 0 && originals <= 3 ? Math.round(originals) : null,
    draft: Boolean(r.draft_or_copy),
  };
}
