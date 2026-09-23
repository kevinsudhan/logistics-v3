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
  planned_date: string | null;
  planned_time: string | null;
  actual_at: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  transporter_partner_id: string | null;
  transporter: string | null;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  pieces: number | null;
  received_by: string | null;
  pod_file_id: string | null;
  notes: string | null;
}

export async function movementsFor(shipmentId: string): Promise<Movement[]> {
  const { data, error } = await supabase
    .from("shipment_movements")
    .select("*")
    .eq("shipment_id", shipmentId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Movement[];
}

/** Write fields on one movement, creating it the first time. */
export async function saveMovement(
  shipmentId: string,
  kind: MovementKind,
  patch: Partial<Movement>
): Promise<void> {
  const { error } = await supabase
    .from("shipment_movements")
    .upsert(
      { shipment_id: shipmentId, kind, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "shipment_id,kind" }
    );
  if (error) throw new Error(error.message);
}
