import { supabase } from "../lib/supabase";
import type { DimensionLine } from "../lib/dimensions";

/**
 * The dimension lines on an enquiry (063).
 *
 * Plain reads and writes. Every total that matters — pieces, volume, gross
 * weight — is recomputed by the database on each write, so nothing here adds
 * anything up; the caller reloads the enquiry to see the new totals.
 */

const COLUMNS = "id, position, pieces, length, width, height, weight_per_piece, gross_weight";

/** numeric columns arrive as strings from PostgREST. */
const toLine = (r: Record<string, unknown>): DimensionLine => {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id),
    position: Number(r.position ?? 0),
    pieces: n(r.pieces),
    length: n(r.length),
    width: n(r.width),
    height: n(r.height),
    weight_per_piece: n(r.weight_per_piece),
    gross_weight: n(r.gross_weight),
  };
};

export async function listDimensions(ref: string): Promise<DimensionLine[]> {
  const { data, error } = await supabase
    .from("enquiry_dimensions")
    .select(COLUMNS)
    .eq("enquiry_ref", ref)
    .order("position")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toLine(r as Record<string, unknown>));
}

export async function addDimension(ref: string, position: number): Promise<DimensionLine> {
  const { data, error } = await supabase
    .from("enquiry_dimensions")
    .insert({ enquiry_ref: ref, position })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toLine(data as Record<string, unknown>);
}

export type DimensionPatch = Partial<Omit<DimensionLine, "id" | "position">>;

export async function updateDimension(id: string, patch: DimensionPatch): Promise<void> {
  const { error } = await supabase.from("enquiry_dimensions").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeDimension(id: string): Promise<void> {
  const { error } = await supabase.from("enquiry_dimensions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Several lines at once, after whatever is already there — what the mail
 * reader adds. One insert, so the table never shows half of a set of sizes.
 */
export async function addDimensions(
  ref: string,
  afterPosition: number,
  lines: DimensionPatch[]
): Promise<void> {
  if (!lines.length) return;
  const { error } = await supabase
    .from("enquiry_dimensions")
    .insert(lines.map((l, i) => ({ ...l, enquiry_ref: ref, position: afterPosition + i + 1 })));
  if (error) throw new Error(error.message);
}
