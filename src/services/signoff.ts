import { supabase } from "../lib/supabase";
import type { Shipment, SignOffItem } from "./enquiries";

/**
 * Closing a job (070). The checklist is the database's own, so what the tab
 * shows and what signing off enforces are the same list.
 */

export async function signOffChecklist(shipmentId: string): Promise<SignOffItem[]> {
  const { data, error } = await supabase.rpc("shipment_signoff_checklist", { p_id: shipmentId });
  if (error) throw new Error(error.message);
  return (data ?? []) as SignOffItem[];
}

export async function signOff(shipmentId: string, note: string): Promise<Shipment> {
  const { data, error } = await supabase.rpc("sign_off_shipment", { p_id: shipmentId, p_note: note });
  if (error) throw new Error(error.message);
  return data as Shipment;
}

export async function reopenSignOff(shipmentId: string, reason: string): Promise<Shipment> {
  const { data, error } = await supabase.rpc("reopen_signoff", { p_id: shipmentId, p_reason: reason });
  if (error) throw new Error(error.message);
  return data as Shipment;
}
