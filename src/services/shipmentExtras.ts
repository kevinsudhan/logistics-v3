import { supabase } from "../lib/supabase";

/**
 * The parts of an in-process shipment that are the shipment's alone (065):
 * the legs it travels and the parties beyond the three a B/L prints.
 */

// ---------------------------------------------------------------------------
// Routings
// ---------------------------------------------------------------------------

export type RoutingMove = "road" | "air" | "sea" | "rail";
export type RoutingStatus = "planned" | "in_transit" | "completed" | "cancelled";

export interface Routing {
  id: string;
  shipment_id: string;
  position: number;
  move: RoutingMove;
  from_place: string | null;
  to_place: string | null;
  etd: string | null;
  eta: string | null;
  carrier: string | null;
  voyage_flight: string | null;
  vehicle_number: string | null;
  driver_name: string | null;
  status: RoutingStatus;
}

export const MOVE_LABEL: Record<RoutingMove, string> = {
  road: "Road",
  air: "Air",
  sea: "Sea",
  rail: "Rail",
};

export const ROUTING_STATUS_LABEL: Record<RoutingStatus, string> = {
  planned: "Planned",
  in_transit: "In transit",
  completed: "Completed",
  cancelled: "Cancelled",
};

export async function routingsFor(shipmentId: string): Promise<Routing[]> {
  const { data, error } = await supabase
    .from("shipment_routings")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("position")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Routing[];
}

export async function addRouting(
  shipmentId: string,
  position: number,
  seed: Partial<Routing> = {}
): Promise<Routing> {
  const { data, error } = await supabase
    .from("shipment_routings")
    .insert({ shipment_id: shipmentId, position, ...seed })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Routing;
}

export async function updateRouting(id: string, patch: Partial<Routing>): Promise<void> {
  const { error } = await supabase.from("shipment_routings").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeRouting(id: string): Promise<void> {
  const { error } = await supabase.from("shipment_routings").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// The parties beyond shipper, consignee and notify
// ---------------------------------------------------------------------------

export type ExtraPartyRole =
  | "destination_agent"
  | "origin_agent"
  | "billing_customer"
  | "notify_2"
  | "forwarder"
  | "customs_house_agent";

export interface ExtraParty {
  id: string;
  shipment_id: string;
  role: ExtraPartyRole;
  partner_id: string | null;
  customer_id: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  notes: string | null;
}

export async function extraPartiesFor(shipmentId: string): Promise<ExtraParty[]> {
  const { data, error } = await supabase
    .from("shipment_parties")
    .select("*")
    .eq("shipment_id", shipmentId);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExtraParty[];
}

/**
 * Write one party's fields, creating its row the first time.
 *
 * An upsert on (shipment, role): a party is one box on the job, and saving the
 * first field of an empty box should not be a separate "create" step somebody
 * has to remember.
 */
export async function saveExtraParty(
  shipmentId: string,
  role: ExtraPartyRole,
  patch: Partial<ExtraParty>
): Promise<void> {
  const { error } = await supabase
    .from("shipment_parties")
    .upsert(
      { shipment_id: shipmentId, role, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "shipment_id,role" }
    );
  if (error) throw new Error(error.message);
}

export async function clearExtraParty(shipmentId: string, role: ExtraPartyRole): Promise<void> {
  const { error } = await supabase
    .from("shipment_parties")
    .delete()
    .eq("shipment_id", shipmentId)
    .eq("role", role);
  if (error) throw new Error(error.message);
}
