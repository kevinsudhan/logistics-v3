import type { jsPDF } from "jspdf";

/**
 * The form language of the Manual documents page.
 *
 * ---------------------------------------------------------------------------
 * WHY A DOCUMENT IS DECLARED HERE AS A FORM
 *
 * The same reason the registry declares a document as rows (types.ts): twenty
 * hand-built forms would each need their own inputs, their own number parsing
 * and their own idea of what "empty" means, and they would drift apart within
 * a week. A manual document is a declaration — its sections, its fields, the
 * tables it has lines in — and one renderer on the page draws all of them.
 *
 * Everything typed is held as text, exactly as typed, and only turned into a
 * number or a date when the PDF is drawn. A half-typed "1,2" is not a value a
 * form should silently round, and the page says which fields will not read as
 * a number rather than printing nothing for them.
 * ---------------------------------------------------------------------------
 */

/** "segmented": the options as a row of buttons, one pressed — a choice of two or three, seen at once. */
export type ManualInput = "text" | "textarea" | "number" | "date" | "select" | "segmented" | "yesno" | "check";

export interface ManualOption {
  value: string;
  label: string;
}

export interface ManualField {
  key: string;
  label: string;
  /** Text when not given. */
  input?: ManualInput;
  options?: ManualOption[];
  /** Named in what the document still needs while it is empty. */
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** Takes the whole row of the grid: an address, a description. */
  wide?: boolean;
  /** Offered as it is typed (a text field): anything else can still be typed. */
  suggestions?: string[];
  /** Shown only while this holds: a rate of exchange only once a line is in that currency. */
  when?: (v: ManualValues) => boolean;
  /** A table's column: what a new line starts with, when not blank — the usual GST rate. */
  default?: string;
}

/** Lines of something — the boxes, the house bills — typed as a table. */
export interface ManualTable {
  key: string;
  label: string;
  /** What one line is called, numbered on its card: "House 2". */
  lineLabel: string;
  columns: ManualField[];
  addLabel: string;
  hint?: string;
  /** Sets of lines added in one go, as a starting point to fill in: "LCL export". */
  presets?: Array<{ label: string; rows: ManualRow[] }>;
}

export interface ManualSection {
  title: string;
  fields?: ManualField[];
  table?: ManualTable;
  /** One line under the title, for what the section is for. */
  note?: string;
}

export type ManualRow = Record<string, string>;
/** A store's values: a field's text, or a table's lines. */
export type ManualValues = Record<string, string | ManualRow[]>;

/** Where a document sits in the list. */
export type ManualGroup = "shipment" | "bills" | "console";

export const MANUAL_GROUP_LABEL: Record<ManualGroup, string> = {
  shipment: "Shipment documents",
  bills: "House bills",
  console: "Console documents",
};

/**
 * Which typed details a document reads.
 *
 * Documents in one store share them: the consignee typed for the arrival
 * notice is the consignee on the delivery order. The two house bills each
 * have their own, because they are different forms of a different shape.
 */
export type ManualStore = "shipment" | "console" | "hbl" | "hawb";

interface ManualDocBase {
  id: string;
  shortName: string;
  /** What the desk also calls it, and what the list can be searched by: CAN, DO, POD. */
  alias?: string;
  purpose: string;
  group: ManualGroup;
  store: ManualStore;
  /**
   * True where the PDF itself is stamped DRAFT while `missing` is not empty.
   * Elsewhere `missing` is advice: the document prints whatever is typed.
   */
  stampsDraft: boolean;
}

/** A document typed into the generic form. */
export interface FormDoc extends ManualDocBase {
  editor: "form";
  sections: ManualSection[];
  render: (v: ManualValues) => jsPDF;
  fileName: (v: ManualValues) => string;
  /** What it still needs, by name. */
  missing: (v: ManualValues) => string[];
  /** The number it prints under, shown above the form. */
  documentNo?: (v: ManualValues) => string;
}

// ---------------------------------------------------------------------------
// Reading what was typed
// ---------------------------------------------------------------------------

/** The fields of a section that are on the form now: those with no `when`, and those whose `when` holds. */
export const shownFields = (s: ManualSection, v: ManualValues) => (s.fields ?? []).filter((f) => !f.when || f.when(v));

/** A field's text, trimmed; "" when it is a table or was never typed. */
export function text(v: ManualValues, key: string): string {
  const x = v[key];
  return typeof x === "string" ? x.trim() : "";
}

/** A table's lines, leaving out any line with nothing typed in it. */
export function lines(v: ManualValues, key: string): ManualRow[] {
  const x = v[key];
  return Array.isArray(x) ? x.filter((r) => Object.values(r).some((c) => c.trim())) : [];
}

/**
 * A typed number, or undefined.
 *
 * Commas are thousands separators, as the desk writes them ("12,500" or the
 * Indian "1,25,000"); anything else that is not a number is not one, rather
 * than the leading digits of one.
 */
export function parseNumber(s: string | undefined | null): number | undefined {
  const t = (s ?? "").replace(/[,\s]/g, "");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** "Yes", "No" or not said. */
export function parseYesNo(s: string | undefined | null): boolean | undefined {
  return s === "yes" ? true : s === "no" ? false : undefined;
}

/**
 * Every number field (and number column) whose text does not read as one, by
 * label: printed as nothing, so the page says so instead.
 */
export function unreadableNumbers(sections: ManualSection[], v: ManualValues): string[] {
  const bad: string[] = [];
  for (const s of sections) {
    for (const f of shownFields(s, v)) {
      if (f.input === "number" && text(v, f.key) && parseNumber(text(v, f.key)) === undefined) bad.push(f.label);
    }
    if (s.table) {
      const numeric = s.table.columns.filter((c) => c.input === "number");
      lines(v, s.table.key).forEach((r, i) => {
        for (const c of numeric) {
          const t = (r[c.key] ?? "").trim();
          if (t && parseNumber(t) === undefined) bad.push(`${s.table!.lineLabel} ${i + 1}: ${c.label}`);
        }
      });
    }
  }
  return bad;
}

/** The required fields of a form with nothing in them, by label. */
export function emptyRequired(sections: ManualSection[], v: ManualValues): string[] {
  return sections.flatMap((s) => shownFields(s, v).filter((f) => f.required && !text(v, f.key)).map((f) => f.label));
}

/** A blank line for a table: every column empty. */
export const blankRow = (t: ManualTable): ManualRow => Object.fromEntries(t.columns.map((c) => [c.key, c.default ?? ""]));

/** A safe file name: what no file system or mail attachment accepts becomes a hyphen. */
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-");
