import { supabase } from "../lib/supabase";
import { COMPANY } from "../lib/documents/letterhead";
import { finalDestination, hawbFromJob, normaliseHawb, type HawbData, type JobForHawb } from "../lib/hawb";
import type { Enquiry, Shipment } from "./enquiries";
import { listDimensions } from "./enquiryDimensions";
import { routingsFor } from "./shipmentExtras";

/**
 * The house air waybill on a shipment (075).
 *
 * One per shipment. Saved as the boxes of the form; numbered on the first
 * save from its own series; locked once the original is issued; every save
 * and every print on its history.
 */

export interface HawbRow {
  shipment_id: string;
  hawb_no: string | null;
  hawb_date: string | null;
  awb_kind: "draft" | "original";
  original_issued: boolean;
  data: HawbData;
  updated_at: string;
  updated_by: string | null;
}

export interface HawbHistory {
  id: string;
  at: string;
  actor: string | null;
  action: "created" | "updated" | "numbered" | "issued" | "reopened" | "printed";
  changes: Array<{ field: string; from: unknown; to: unknown }>;
  note: string;
}

export async function getHawb(shipmentId: string): Promise<HawbRow | null> {
  const { data, error } = await supabase.from("house_airwaybills").select("*").eq("shipment_id", shipmentId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? ({ ...data, data: normaliseHawb(data.data) } as HawbRow) : null;
}

/**
 * Save the form, and number it the first time.
 *
 * The number needs the departure and destination airport codes; a draft
 * saved without them is kept unnumbered and says why, rather than failing
 * the save.
 */
export async function saveHawb(
  shipmentId: string,
  input: { hawb_date: string | null; awb_kind: "draft" | "original"; data: HawbData },
  exists: boolean
): Promise<{ row: HawbRow; numberError: string | null }> {
  const values = { hawb_date: input.hawb_date || null, awb_kind: input.awb_kind, data: input.data };
  const { error } = exists
    ? await supabase.from("house_airwaybills").update(values).eq("shipment_id", shipmentId)
    : await supabase.from("house_airwaybills").insert({ shipment_id: shipmentId, ...values });
  if (error) throw new Error(error.hint ? `${error.message}. ${error.hint}` : error.message);

  let numberError: string | null = null;
  const current = await getHawb(shipmentId);
  if (current && !current.hawb_no) {
    const { error: e2 } = await supabase.rpc("number_hawb", {
      p_shipment_id: shipmentId,
      p_from: input.data.departure_code,
      p_to: finalDestination(input.data),
    });
    if (e2) numberError = e2.hint ? `${e2.message}. ${e2.hint}` : e2.message;
  }
  return { row: (await getHawb(shipmentId))!, numberError };
}

export async function setOriginalIssued(shipmentId: string, issued: boolean): Promise<void> {
  const { error } = await supabase
    .from("house_airwaybills")
    .update(issued ? { original_issued: true, awb_kind: "original" } : { original_issued: false })
    .eq("shipment_id", shipmentId);
  if (error) throw new Error(error.hint ? `${error.message}. ${error.hint}` : error.message);
}

export async function hawbHistory(shipmentId: string): Promise<HawbHistory[]> {
  const { data, error } = await supabase
    .from("house_airwaybill_history")
    .select("id, at, actor, action, changes, note")
    .eq("shipment_id", shipmentId)
    .order("at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as HawbHistory[];
}

export async function logHawbPrint(shipmentId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("log_hawb_print", { p_shipment_id: shipmentId, p_note: note });
  if (error) throw new Error(error.message);
}

/** Everything "Fetch details" reads: the shipment, its air legs, its sizes. */
export async function jobForHawb(
  shipment: Shipment,
  enquiry: Pick<Enquiry, "dimension_unit"> | null,
  userName: string | null
): Promise<JobForHawb> {
  const [legs, dims] = await Promise.all([
    routingsFor(shipment.id).catch(() => []),
    listDimensions(shipment.enquiry_ref).catch(() => []),
  ]);
  return {
    shipment,
    airLegs: legs
      .filter((l) => l.move === "air" && l.status !== "cancelled")
      .map((l) => ({ to_place: l.to_place, voyage_flight: l.voyage_flight, etd: l.etd, carrier: l.carrier })),
    dims,
    unit: enquiry?.dimension_unit ?? "cm_kg",
    company: { name: COMPANY.name, address: COMPANY.address, city: "Chennai" },
    userName,
    today: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10),
  };
}

export { hawbFromJob };
