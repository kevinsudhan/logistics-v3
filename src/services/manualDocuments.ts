import { supabase } from "../lib/supabase";
import { normaliseBl } from "../lib/documents/manual";

export { normaliseBl };

/**
 * Manual documents kept by B/L number (139).
 *
 * Every document printed on the Manual documents page with a B/L number is
 * saved under it, one row per B/L and document, replaced when it is printed
 * again; typing the number on the page lists what was made for it. The whole
 * desk reads them; whoever saved one, or an administrator, can take it out.
 */

export type SavedStore = "shipment" | "console" | "hbl" | "hawb";

export interface SavedDocument {
  id: string;
  bl_number: string;
  /** The document: 'arrival-notice', 'house-bl', 'freight-invoice', 'proforma-invoice'… */
  doc_key: string;
  title: string;
  document_no: string;
  store: SavedStore;
  values: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = "id, bl_number, doc_key, title, document_no, store, values, created_by, updated_by, created_at, updated_at";

/** The table not there yet (139 not applied) or not reachable: said plainly rather than as PostgREST's words. */
const friendly = (e: { code?: string; message: string }) =>
  new Error(
    e.code === "42P01" || e.code === "PGRST205" || (/manual_documents/.test(e.message) && /does not exist|schema cache/.test(e.message))
      ? "Saving is not switched on yet: the database needs update 139 (manual_documents)."
      : e.message
  );

/** Kept under its B/L number: the row for this B/L and document replaced if there is one. */
export async function saveManualDocument(row: Pick<SavedDocument, "bl_number" | "doc_key" | "title" | "document_no" | "store" | "values">): Promise<SavedDocument> {
  const { data, error } = await supabase
    .from("manual_documents")
    .upsert({ ...row, bl_number: normaliseBl(row.bl_number) }, { onConflict: "bl_number,doc_key" })
    .select(COLS)
    .single();
  if (error) throw friendly(error);
  return data as SavedDocument;
}

/** What is kept under a B/L number, or every B/L it begins: newest first, at most fifty. */
export async function findManualDocuments(bl: string): Promise<SavedDocument[]> {
  const q = normaliseBl(bl);
  if (!q) return [];
  // A prefix, with LIKE's own characters taken as themselves.
  const prefix = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await supabase
    .from("manual_documents")
    .select(COLS)
    .like("bl_number", `${prefix}%`)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw friendly(error);
  return (data ?? []) as SavedDocument[];
}

/** Taken out: refused, as nothing, unless it is yours or you are an administrator. */
export async function removeManualDocument(id: string): Promise<void> {
  const { data, error } = await supabase.from("manual_documents").delete().eq("id", id).select("id");
  if (error) throw friendly(error);
  if (!data?.length) throw new Error("Only whoever saved it, or an administrator, can remove it.");
}
