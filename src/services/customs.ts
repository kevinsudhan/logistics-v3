import { supabase } from "../lib/supabase";
import { customsError, type CustomsRecord, type CustomsSide } from "../lib/customs";

/**
 * The customs record on a shipment (077): one for export, one for import.
 *
 * The database checks the numbers and the order of the dates, ticks the
 * workflow step from the LEO or out-of-charge date, and refuses a signed-off
 * job; its refusals come back here in the desk's words (src/lib/customs.ts).
 */

export async function customsFor(shipmentId: string): Promise<CustomsRecord[]> {
  const { data, error } = await supabase.from("shipment_customs").select("*").eq("shipment_id", shipmentId).order("side", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomsRecord[];
}

/** Every customs record on a set of jobs, for the worklist. */
export async function customsForShipments(ids: string[]): Promise<CustomsRecord[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("shipment_customs").select("*").in("shipment_id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomsRecord[];
}

export async function startCustoms(shipmentId: string, side: CustomsSide): Promise<CustomsRecord> {
  const { data, error } = await supabase.from("shipment_customs").insert({ shipment_id: shipmentId, side }).select().single();
  if (error) throw new Error(customsError(error.message));
  return data as CustomsRecord;
}

export async function updateCustoms(id: string, patch: Partial<CustomsRecord>): Promise<CustomsRecord> {
  const { data, error } = await supabase.from("shipment_customs").update(patch).eq("id", id).select().single();
  if (error) throw new Error(customsError(error.message));
  return data as CustomsRecord;
}

export async function removeCustoms(id: string): Promise<void> {
  const { error } = await supabase.from("shipment_customs").delete().eq("id", id);
  if (error) throw new Error(customsError(error.message));
}

/** The customer's page: numbers, dates and where it stands (077). */
export interface PublicCustoms {
  side: CustomsSide;
  status: "cleared" | "filed" | "in_progress";
  sb_number: string | null;
  sb_date: string | null;
  leo_date: string | null;
  be_number: string | null;
  be_date: string | null;
  ooc_date: string | null;
  port_code: string | null;
}

export async function customsByToken(token: string): Promise<PublicCustoms[]> {
  const { data, error } = await supabase.rpc("shipment_customs_public", { p_token: token });
  if (error) throw new Error(error.message);
  return (data ?? []) as PublicCustoms[];
}
