import { supabase } from "../lib/supabase";
import type { BoxDates } from "../lib/freeTime";
import { whereIn } from "./paging";

// The pure half lives in lib/ so a test can load it without Vite's
// import.meta.env — the same split as applyPlan.ts next to intake.ts.
export {
  SIZE_TYPES,
  SEAL_TYPES,
  PACKAGE_TYPES,
  isoFor,
  checkContainerNo,
} from "../lib/containerNo";
export type { ContainerNoCheck } from "../lib/containerNo";

/**
 * The physical boxes a shipment travels in.
 *
 * ---------------------------------------------------------------------------
 * ONE ROW PER BOX, NOT ONE COLUMN PER BOOKING
 *
 * `shipments.container_number` held exactly one, which meant an FCL job with
 * three boxes had two of them nowhere, and a VGM declaration — which is per
 * container by law — printed whichever one happened to be typed in.
 *
 * `shipments.container_number` still exists and still feeds the nine document
 * specs that print a single number. It is maintained by a trigger from the
 * first row here and is not written by anything else.
 * ---------------------------------------------------------------------------
 */

export interface ShipmentContainer {
  id: string;
  shipment_id: string;
  sailing_id: string | null;
  position: number;

  container_no: string;
  size_type: string;
  iso_code: string;
  seal_type: string;
  seal_no: string;

  package_count: number | null;
  package_type: string;
  weight_kg: number | null;
  volume_cbm: number | null;
  marks_numbers: string;

  cfs: string;
  godown_no: string;

  is_soc: boolean;
  is_empty: boolean;
  is_coload: boolean;

  // Free time (083): the dates that start and stop each box's clocks.
  discharged_on: string | null;
  gate_out_on: string | null;
  empty_returned_on: string | null;
  empty_picked_on: string | null;
  gate_in_on: string | null;
  loaded_on: string | null;

  created_at: string;
  updated_at: string;
}

export const FREE_TIME_DATES = "shipment_id, is_soc, discharged_on, gate_out_on, empty_returned_on, empty_picked_on, gate_in_on, loaded_on";

/** Each job's boxes, with only what the free-time clock reads — for the worklist. */
export async function freeTimeBoxes(shipmentIds: string[]): Promise<Array<BoxDates & { shipment_id: string }>> {
  if (!shipmentIds.length) return [];
  return (await whereIn("shipment_containers", FREE_TIME_DATES, "shipment_id", shipmentIds)) as unknown as Array<
    BoxDates & { shipment_id: string }
  >;
}

export async function listShipmentContainers(shipmentId: string): Promise<ShipmentContainer[]> {
  const { data, error } = await supabase
    .from("shipment_containers")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ShipmentContainer[];
}

export async function addShipmentContainer(
  shipmentId: string,
  input: Partial<ShipmentContainer> = {}
): Promise<ShipmentContainer> {
  const { data, error } = await supabase
    .from("shipment_containers")
    .insert({ shipment_id: shipmentId, ...input })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as ShipmentContainer;
}

export async function updateShipmentContainer(
  id: string,
  patch: Partial<ShipmentContainer>
): Promise<ShipmentContainer> {
  const { data, error } = await supabase
    .from("shipment_containers")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as ShipmentContainer;
}

export async function removeShipmentContainer(id: string): Promise<void> {
  const { error } = await supabase.from("shipment_containers").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export interface ContainerTotals {
  container_count: number;
  package_total: number;
  weight_total_kg: number;
  volume_total_cbm: number;
  any_coload: boolean;
}

export async function containerTotals(shipmentId: string): Promise<ContainerTotals | null> {
  const { data, error } = await supabase
    .from("shipment_container_totals")
    .select("container_count, package_total, weight_total_kg, volume_total_cbm, any_coload")
    .eq("shipment_id", shipmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ContainerTotals) ?? null;
}
