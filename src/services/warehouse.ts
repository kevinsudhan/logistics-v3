import { supabase } from "../lib/supabase";

/**
 * Warehouse receipts (068): what actually arrived, one row per delivery in.
 * The first one ticks the cargo-received step on the workflow.
 */

export type Condition = "good" | "damaged" | "short" | "wet";

export const CONDITION_LABEL: Record<Condition, string> = {
  good: "Good",
  damaged: "Damaged",
  short: "Short",
  wet: "Wet",
};

export interface Receipt {
  id: string;
  shipment_id: string;
  receipt_no: string;
  received_at: string;
  location: string | null;
  partner_id: string | null;
  pieces: number | null;
  gross_weight_kg: number | null;
  volume_cbm: number | null;
  condition: Condition;
  bay: string | null;
  remarks: string | null;
  received_by: string | null;
}

/** numeric columns may arrive as strings. */
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function receiptsFor(shipmentId: string): Promise<Receipt[]> {
  const { data, error } = await supabase
    .from("warehouse_receipts")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("received_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    ...(r as Receipt),
    gross_weight_kg: n((r as Receipt).gross_weight_kg),
    volume_cbm: n((r as Receipt).volume_cbm),
  }));
}

export async function addReceipt(
  shipmentId: string,
  r: Omit<Receipt, "id" | "shipment_id" | "receipt_no" | "received_by" | "partner_id">
): Promise<void> {
  const { error } = await supabase.from("warehouse_receipts").insert({
    shipment_id: shipmentId,
    ...r,
    received_by: (await supabase.auth.getUser()).data.user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function updateReceipt(id: string, patch: Partial<Receipt>): Promise<void> {
  const { error } = await supabase.from("warehouse_receipts").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeReceipt(id: string): Promise<void> {
  const { error } = await supabase.from("warehouse_receipts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
