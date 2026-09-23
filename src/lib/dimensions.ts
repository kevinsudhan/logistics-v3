/**
 * The arithmetic behind the dimension table.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE TOTALS COME FROM
 *
 * Not from here. The enquiry's piece count, volume and gross weight are worked
 * out in the database from the stored lines (063), because the chargeable
 * weight, the quotation and the booking all read those columns and they must
 * agree with each other whichever screen wrote last. This file only does what
 * the table shows per line while somebody is typing: the line's volume, its
 * volume weight and its gross — the same formulas, so the row and the total
 * under it cannot disagree.
 *
 * UNITS
 *
 * A line is stored in the unit it was entered in — the customer's packing list
 * is in inches and pounds or it is not. Everything is converted to
 * centimetres and kilos before any freight arithmetic.
 * ---------------------------------------------------------------------------
 */

export type DimensionUnit = "cm_kg" | "in_lb";

export interface DimensionLine {
  id: string;
  position: number;
  pieces: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  weight_per_piece: number | null;
  gross_weight: number | null;
}

export const CM_PER: Record<DimensionUnit, number> = { cm_kg: 1, in_lb: 2.54 };
export const KG_PER: Record<DimensionUnit, number> = { cm_kg: 1, in_lb: 0.45359237 };

export const UNIT_LABEL: Record<DimensionUnit, { length: string; weight: string }> = {
  cm_kg: { length: "cm", weight: "kg" },
  in_lb: { length: "in", weight: "lb" },
};

/** Nothing typed on it at all — an empty row, not a half-measured one. */
export function isEmptyLine(l: Omit<DimensionLine, "id" | "position">): boolean {
  return [l.pieces, l.length, l.width, l.height, l.weight_per_piece, l.gross_weight].every(
    (v) => v === null || v === undefined
  );
}

/** The line's volume in CBM, or null until every measurement is there. */
export function lineVolumeCbm(
  l: Pick<DimensionLine, "pieces" | "length" | "width" | "height">,
  unit: DimensionUnit
): number | null {
  const { pieces, length, width, height } = l;
  if (!pieces || !length || !width || !height) return null;
  // cm³ to m³ is a million, not a thousand.
  return (pieces * length * width * height * CM_PER[unit] ** 3) / 1_000_000;
}

/**
 * The line's gross weight, in the line's own unit.
 *
 * The figure typed for the line wins over pieces × per-piece: a shipper who
 * writes both usually rounded one of them, and the total is what the scale
 * said.
 */
export function lineGross(
  l: Pick<DimensionLine, "pieces" | "weight_per_piece" | "gross_weight">
): number | null {
  if (l.gross_weight !== null && l.gross_weight !== undefined) return l.gross_weight;
  if (l.weight_per_piece === null || l.weight_per_piece === undefined || !l.pieces) return null;
  return l.weight_per_piece * l.pieces;
}

/**
 * Kilos of volume weight per CBM, by mode — the other half of the chargeable
 * comparison. Null where the mode is not charged on it (FCL is bought by the
 * box; "other" has no standard ratio).
 *
 * The same ratios as lib/chargeableWeight.ts: air 6000 cm³/kg, sea LCL
 * 1 CBM = 1 t, road 1 CBM = 333 kg.
 */
export function kgPerCbm(mode: string | null | undefined): number | null {
  switch (mode) {
    case "air":
      return 1_000_000 / 6000;
    case "sea_lcl":
      return 1000;
    case "road":
      return 333;
    default:
      return null;
  }
}

/** The line's volume weight, in the line's own weight unit. */
export function lineVolumeWeight(
  l: Pick<DimensionLine, "pieces" | "length" | "width" | "height">,
  unit: DimensionUnit,
  mode: string | null | undefined
): number | null {
  const cbm = lineVolumeCbm(l, unit);
  const ratio = kgPerCbm(mode);
  if (cbm === null || ratio === null) return null;
  return (cbm * ratio) / KG_PER[unit];
}

/** "1,234.5" — at most `dp` decimals, no trailing zeros, grouped the Indian way. */
export function fmt(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-IN", { maximumFractionDigits: dp });
}

/**
 * The enquiry fields a reading of the mail must leave alone, given the lines.
 *
 * Once dimension lines exist the database treats them as the source (063):
 * the single-piece size always, and each total the lines actually give. A
 * reading that proposed "length 120 cm" for an enquiry with three sizes would
 * be ignored by the database and still reported as filled on screen — so it is
 * not proposed. A total the lines do not give (a stated 850 kg, say) stays
 * fillable.
 */
export function ownedByLines(
  lines: Array<Omit<DimensionLine, "id" | "position">>
): string[] {
  const real = lines.filter((l) => !isEmptyLine(l));
  if (!real.length) return [];
  const owned = ["piece_length_cm", "piece_width_cm", "piece_height_cm", "weight_per_piece_kg"];
  if (real.some((l) => l.pieces !== null)) owned.push("piece_count");
  if (real.some((l) => l.length !== null || l.width !== null || l.height !== null))
    owned.push("volume_cbm");
  if (real.some((l) => l.weight_per_piece !== null || l.gross_weight !== null))
    owned.push("gross_weight_kg");
  return owned;
}

/**
 * A size as the mail reader returns it: always centimetres and kilograms,
 * whatever unit the mail was written in (classify-enquiry converts).
 */
export interface ReadSize {
  pieces: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  weight_per_piece_kg: number | null;
  gross_weight_kg: number | null;
}

/**
 * The reader's `dimension_lines`, made safe: positive finite numbers only,
 * whole pieces, and only sizes with a count or a measurement. A line of nothing
 * but a weight is not a size.
 */
export function readSizes(raw: unknown): ReadSize[] {
  if (!Array.isArray(raw)) return [];
  const pos = (v: unknown, dp: number): number | null => {
    const n = typeof v === "number" ? v : Number(v);
    return v !== null && v !== undefined && v !== "" && Number.isFinite(n) && n > 0
      ? Math.round(n * 10 ** dp) / 10 ** dp
      : null;
  };
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const pieces = pos(r.pieces, 0);
      return {
        pieces: pieces && pieces >= 1 ? pieces : null,
        length_cm: pos(r.length_cm, 2),
        width_cm: pos(r.width_cm, 2),
        height_cm: pos(r.height_cm, 2),
        weight_per_piece_kg: pos(r.weight_per_piece_kg, 3),
        gross_weight_kg: pos(r.gross_weight_kg, 2),
      };
    })
    .filter((s) => s.pieces !== null || s.length_cm !== null || s.width_cm !== null || s.height_cm !== null);
}

/** A read size as a line in the table's unit. */
export function sizeToLine(
  s: ReadSize,
  unit: DimensionUnit
): Omit<DimensionLine, "id" | "position"> {
  const len = (v: number | null) => (v === null ? null : Math.round((v / CM_PER[unit]) * 100) / 100);
  const wt = (v: number | null, dp: number) =>
    v === null ? null : Math.round((v / KG_PER[unit]) * 10 ** dp) / 10 ** dp;
  return {
    pieces: s.pieces,
    length: len(s.length_cm),
    width: len(s.width_cm),
    height: len(s.height_cm),
    weight_per_piece: wt(s.weight_per_piece_kg, 3),
    gross_weight: wt(s.gross_weight_kg, 2),
  };
}

/**
 * Whether a size is already a line in the table.
 *
 * Same count and the same three measurements to within half a centimetre, in
 * any order — "60 x 40 x 50" and "40 x 60 x 50" are the same carton written by
 * two people. Weight is not compared: a size is a size.
 */
export function sameSize(s: ReadSize, line: DimensionLine, unit: DimensionUnit): boolean {
  if (s.pieces !== line.pieces) return false;
  const cm = (v: number | null) => (v === null ? null : v * CM_PER[unit]);
  const a = [s.length_cm, s.width_cm, s.height_cm];
  const b = [cm(line.length), cm(line.width), cm(line.height)];
  if (a.some((v) => v === null) || b.some((v) => v === null)) {
    return a.every((v, i) => (v === null) === (b[i] === null) && (v === null || Math.abs(v - b[i]!) <= 0.5));
  }
  const sa = (a as number[]).slice().sort((x, y) => x - y);
  const sb = (b as number[]).slice().sort((x, y) => x - y);
  return sa.every((v, i) => Math.abs(v - sb[i]) <= 0.5);
}

/** The read sizes that are not already lines in the table. */
export function sizesNotInTable(
  read: ReadSize[],
  lines: DimensionLine[],
  unit: DimensionUnit
): ReadSize[] {
  const real = lines.filter((l) => !isEmptyLine(l));
  return read.filter((s) => !real.some((l) => sameSize(s, l, unit)));
}

/** "12 × 60 × 40 × 50 cm · 18 kg each" — how a proposed size reads on screen. */
export function describeSize(s: ReadSize): string {
  const dims = [s.length_cm, s.width_cm, s.height_cm];
  const size = dims.every((v) => v !== null) ? `${dims.map((v) => fmt(v)).join(" × ")} cm` : null;
  const count = s.pieces !== null ? `${s.pieces}` : "?";
  const weight =
    s.weight_per_piece_kg !== null
      ? `${fmt(s.weight_per_piece_kg)} kg each`
      : s.gross_weight_kg !== null
        ? `${fmt(s.gross_weight_kg)} kg in all`
        : null;
  return [size ? `${count} × ${size}` : `${count} pieces, size not given`, weight]
    .filter(Boolean)
    .join(" · ");
}
