/**
 * Customs clearance (077): where a clearance stands, and reading the numbers.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT STANDS
 *
 * Worked out from the record, never set by hand, so it cannot disagree with
 * the dates. Export: not started → checklist approved → shipping bill filed →
 * (examination) → Let Export Order. Import: not started → manifested (IGM) →
 * bill of entry filed → duty paid → out of charge. A hold, while one is
 * noted, is the status whatever else is filled.
 *
 * THE NUMBERS
 *
 * ICEGATE numbers shipping bills and bills of entry with seven digits. People
 * type them with spaces, a "SB No." in front, or copied from a PDF with a
 * stray dash; those are read to the digits. Anything that is not seven digits
 * afterwards is refused with the reason, before the database refuses it.
 * ---------------------------------------------------------------------------
 */

export type CustomsSide = "export" | "import";
export type HandledBy = "us" | "broker" | "customer" | "agent";

export interface CustomsRecord {
  id: string;
  shipment_id: string;
  side: CustomsSide;
  handled_by: HandledBy;
  broker_partner_id: string | null;
  broker_name: string | null;
  port_code: string | null;
  checklist_approved_on: string | null;
  sb_number: string | null;
  sb_date: string | null;
  examination: "not_required" | "required" | "done" | null;
  examination_on: string | null;
  leo_date: string | null;
  egm_number: string | null;
  egm_date: string | null;
  igm_number: string | null;
  igm_date: string | null;
  igm_item: string | null;
  /** The house bill's sub-line under the master's IGM line, from our CSN (088). */
  igm_subline: string | null;
  /** The house-level manifest we file as consol agent (088). */
  csn_no: string | null;
  csn_filed_on: string | null;
  cfs_code: string | null;
  /** The cargo identification number Customs gave the house line, from ICEGATE's reply to our CSN (100). */
  cin_type?: string | null;
  cin_no?: string | null;
  be_number: string | null;
  be_date: string | null;
  be_type: "home" | "warehouse" | "ex_bond" | null;
  duty_inr: number | null;
  duty_paid_on: string | null;
  ooc_date: string | null;
  hold_reason: string | null;
  remarks: string;
  updated_at: string;
}

export type CustomsStatus =
  | "not_started"
  | "checklist"
  | "filed"
  | "examination"
  | "cleared"
  | "manifested"
  | "duty_paid"
  | "on_hold";

export const STATUS_LABEL: Record<CustomsStatus, string> = {
  not_started: "Not started",
  checklist: "Checklist approved",
  filed: "Filed",
  examination: "Under examination",
  cleared: "Cleared",
  manifested: "Manifested",
  duty_paid: "Duty paid",
  on_hold: "On hold",
};

export type CustomsStatusInput = Pick<
  CustomsRecord,
  "side" | "hold_reason" | "checklist_approved_on" | "sb_number" | "examination" | "leo_date" | "igm_number" | "be_number" | "duty_paid_on" | "ooc_date"
>;

export function customsStatus(r: CustomsStatusInput): CustomsStatus {
  if (r.hold_reason?.trim()) return "on_hold";
  if (r.side === "export") {
    if (r.leo_date) return "cleared";
    if (r.sb_number && r.examination === "required") return "examination";
    if (r.sb_number) return "filed";
    if (r.checklist_approved_on) return "checklist";
    return "not_started";
  }
  if (r.ooc_date) return "cleared";
  if (r.duty_paid_on) return "duty_paid";
  if (r.be_number) return "filed";
  if (r.igm_number) return "manifested";
  return "not_started";
}

/** The steps a clearance goes through, and which it has passed — for the progress strip. */
export function customsSteps(r: CustomsStatusInput & Pick<CustomsRecord, "sb_date" | "be_date" | "checklist_approved_on" | "igm_date">): Array<{ label: string; done: boolean }> {
  if (r.side === "export") {
    return [
      { label: "Checklist", done: Boolean(r.checklist_approved_on || r.sb_number) },
      { label: "Shipping bill", done: Boolean(r.sb_number) },
      { label: "Examination", done: Boolean(r.leo_date) || r.examination === "done" || r.examination === "not_required" },
      { label: "LEO", done: Boolean(r.leo_date) },
    ];
  }
  return [
    { label: "IGM", done: Boolean(r.igm_number || r.be_number) },
    { label: "Bill of entry", done: Boolean(r.be_number) },
    { label: "Duty", done: Boolean(r.duty_paid_on || r.ooc_date) },
    { label: "Out of charge", done: Boolean(r.ooc_date) },
  ];
}

/** "SB No. 123 4567" → "1234567"; null when it is not seven digits, with why. */
export function readIcegateNumber(raw: string, what: string): { value: string | null; error: string | null } {
  const t = raw.trim();
  if (!t) return { value: null, error: null };
  const digits = t.replace(/^(sb|be|bill of entry|shipping bill)\s*(no\.?|number|#)?\s*[:.]?\s*/i, "").replace(/[\s\-/.]/g, "");
  if (!/^\d+$/.test(digits)) return { value: null, error: `A ${what} number is digits only.` };
  if (digits.length !== 7) return { value: null, error: `A ${what} number has seven digits; this has ${digits.length}.` };
  return { value: digits, error: null };
}

/** A customs station code: INMAA4 (Chennai air cargo), INMAA1 (Chennai sea). */
export function readPortCode(raw: string): { value: string | null; error: string | null } {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!t) return { value: null, error: null };
  return /^[A-Z]{5}[0-9A-Z]?$/.test(t) ? { value: t, error: null } : { value: null, error: "A customs station code is five letters and an optional digit, e.g. INMAA4." };
}

/** The database's refusals, in the desk's words. */
export function customsError(message: string): string {
  if (/customs_leo_after_sb/.test(message)) return "The LEO date cannot be before the shipping bill date.";
  if (/customs_ooc_after_be/.test(message)) return "The out-of-charge date cannot be before the bill of entry date.";
  if (/customs_egm_after_leo/.test(message)) return "The EGM date cannot be before the LEO date.";
  if (/sb_number_check/.test(message)) return "A shipping bill number has seven digits.";
  if (/be_number_check/.test(message)) return "A bill of entry number has seven digits.";
  if (/port_code_check/.test(message)) return "A customs station code is five letters and an optional digit, e.g. INMAA4.";
  if (/signed off/.test(message)) return "This job is signed off; its customs record is closed with it.";
  return message;
}

/** Which clearances a job needs by default, from the way it goes. */
export function sidesFor(direction: string | null | undefined): CustomsSide[] {
  return direction === "export" ? ["export"] : direction === "import" ? ["import"] : [];
}
