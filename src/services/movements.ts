import { supabase } from "../lib/supabase";

/**
 * The first and last mile of a shipment (067).
 *
 * Whether there is a pickup or a delivery, and the address, are on the
 * enquiry; this is what arranging it adds. The database ticks the matching
 * workflow step when `actual_at` is set and makes `planned_date` its due date.
 */

export type MovementKind = "pickup" | "delivery";

export interface Movement {
  id: string;
  shipment_id: string;
  kind: MovementKind;
  /** 1, 2, … — a job can collect from several suppliers or deliver in parts (079). */
  seq: number;
  planned_date: string | null;
  planned_time: string | null;
  /** The end of the window that starts at planned_time. */
  window_end: string | null;
  actual_at: string | null;
  /** The door. Pickup 1's is the enquiry's pickup address (Service details). */
  place: string | null;
  /** Where it goes (a pickup: CFS, terminal, our warehouse) or comes from (a delivery). */
  drop_point: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  requested_at: string | null;
  transporter_partner_id: string | null;
  transporter: string | null;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  lr_number: string | null;
  lr_date: string | null;
  eway_bill_no: string | null;
  eway_bill_at: string | null;
  eway_distance_km: number | null;
  eway_odc: boolean;
  container_number: string | null;
  seal_number: string | null;
  pieces: number | null;
  gross_weight_kg: number | null;
  condition: "good" | "damaged" | "short" | null;
  exception_note: string | null;
  attempts: Array<{ at: string; reason: string }>;
  received_by: string | null;
  /** The signed proof: the LR or collection receipt for a pickup, the POD for a delivery. */
  pod_file_id: string | null;
  cost_inr: number | null;
  /** The draft vendor bill the cost became (Costs tab). */
  bill_id: string | null;
  notes: string | null;
  updated_at: string;
}

/** Every pickup and delivery on a job, pickups first, each in order. */
export async function movementsFor(shipmentId: string): Promise<Movement[]> {
  const { data, error } = await supabase
    .from("shipment_movements")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("kind", { ascending: false })
    .order("seq");
  if (error) throw new Error(error.message);
  return (data ?? []) as Movement[];
}

const friendly = (message: string) =>
  /eway_bill_no_check/.test(message)
    ? "An e-way bill number has twelve digits."
    : /eway_distance_km_check/.test(message)
      ? "The distance is in kilometres, 1 to 4,000."
      : /signed off/.test(message)
        ? "This job is signed off; its pickups and deliveries are closed with it."
        : message;

/** Another pickup or delivery on the job, numbered after the last. */
export async function addMovement(shipmentId: string, kind: MovementKind, existing: Movement[]): Promise<Movement> {
  const seq = Math.max(0, ...existing.filter((m) => m.kind === kind).map((m) => m.seq)) + 1;
  const { data, error } = await supabase.from("shipment_movements").insert({ shipment_id: shipmentId, kind, seq }).select().single();
  if (error) throw new Error(friendly(error.message));
  return data as Movement;
}

export async function updateMovement(id: string, patch: Partial<Movement>): Promise<void> {
  const { error } = await supabase
    .from("shipment_movements")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

export async function removeMovement(id: string): Promise<void> {
  const { error } = await supabase.from("shipment_movements").delete().eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

/** A failed attempt, and optionally the day it goes again. */
export async function recordAttempt(m: Movement, reason: string, again: string | null): Promise<void> {
  await updateMovement(m.id, {
    attempts: [...(m.attempts ?? []), { at: new Date().toISOString(), reason }],
    ...(again ? { planned_date: again } : {}),
  });
}

/** The transporter's charge as a draft bill on the Costs tab (079). Returns the bill's id. */
export async function recordMovementCost(id: string): Promise<string> {
  const { data, error } = await supabase.rpc("record_movement_cost", { p_movement_id: id });
  if (error) throw new Error(error.hint ? `${error.message}. ${error.hint}` : error.message);
  return data as string;
}
