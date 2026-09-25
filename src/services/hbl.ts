import { supabase } from "../lib/supabase";
import { hblFromJob, normaliseHbl, type HblData, type JobForHbl, type ReleaseMode } from "../lib/hbl";
import { getConsole } from "./consoles";
import type { Shipment } from "./enquiries";
import { listPartners, type Partner } from "./partners";
import { listShipmentContainers } from "./shipmentContainers";

/**
 * The house bill of lading on a shipment (085).
 *
 * One per shipment. Saved as the boxes of the form; numbered on the first
 * save that names a consignee; locked once issued; every save and every print
 * on its history. The same shape as the HAWB (services/hawb.ts).
 */

export interface HblRow {
  shipment_id: string;
  hbl_no: string | null;
  status: "draft" | "issued";
  release_mode: ReleaseMode;
  originals: number;
  mto_partner_id: string | null;
  data: HblData;
  issued_at: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface HblHistory {
  id: string;
  at: string;
  actor: string | null;
  action: "created" | "updated" | "numbered" | "issued" | "reopened" | "printed";
  changes: Array<{ field: string; from: unknown; to: unknown }>;
  note: string;
}

const failure = (e: { message: string; hint?: string | null }) => new Error(e.hint ? `${e.message}. ${e.hint}` : e.message);

export async function getHbl(shipmentId: string): Promise<HblRow | null> {
  const { data, error } = await supabase.from("house_bills").select("*").eq("shipment_id", shipmentId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? ({ ...data, data: normaliseHbl(data.data) } as HblRow) : null;
}

/**
 * Save the form, and number it the first time.
 *
 * A draft saved without a consignee is kept unnumbered and says why, rather
 * than failing the save.
 */
export async function saveHbl(
  shipmentId: string,
  input: { release_mode: ReleaseMode; originals: number; mto_partner_id: string | null; data: HblData },
  exists: boolean
): Promise<{ row: HblRow; numberError: string | null }> {
  const values = {
    release_mode: input.release_mode,
    originals: input.release_mode === "express" ? 0 : Math.min(3, Math.max(1, input.originals || 3)),
    mto_partner_id: input.mto_partner_id,
    data: input.data,
  };
  const { error } = exists
    ? await supabase.from("house_bills").update(values).eq("shipment_id", shipmentId)
    : await supabase.from("house_bills").insert({ shipment_id: shipmentId, ...values });
  if (error) throw failure(error);

  let numberError: string | null = null;
  const current = await getHbl(shipmentId);
  if (current && !current.hbl_no) {
    const { error: e2 } = await supabase.rpc("number_hbl", { p_shipment_id: shipmentId });
    if (e2) numberError = failure(e2).message;
  }
  return { row: (await getHbl(shipmentId))!, numberError };
}

export async function setHblIssued(shipmentId: string, issued: boolean): Promise<void> {
  const { error } = await supabase
    .from("house_bills")
    .update({ status: issued ? "issued" : "draft" })
    .eq("shipment_id", shipmentId);
  if (error) throw failure(error);
}

export async function hblHistory(shipmentId: string): Promise<HblHistory[]> {
  const { data, error } = await supabase
    .from("house_bill_history")
    .select("id, at, actor, action, changes, note")
    .eq("shipment_id", shipmentId)
    .order("at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as HblHistory[];
}

export async function logHblPrint(shipmentId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("log_hbl_print", { p_shipment_id: shipmentId, p_note: note });
  if (error) throw new Error(error.message);
}

/** The partners a house B/L can be issued under: the ones with an MTO registration recorded. */
export async function mtoPartners(): Promise<Partner[]> {
  return (await listPartners()).filter((p) => p.mto_registration?.trim());
}

const contactOf = (p: Partner) => [p.name, ...(p.phones ?? []), ...(p.emails ?? [])].filter(Boolean).join(" · ");

/**
 * Everything "Fetch details" reads: the shipment, its boxes, the agent who
 * delivers it — the console's where it is on one, the job's own otherwise —
 * and the MTO it is issued under.
 */
export async function jobForHbl(shipment: Shipment, mtoPartnerId: string | null): Promise<JobForHbl> {
  const [boxes, partners, con] = await Promise.all([
    listShipmentContainers(shipment.id).catch(() => []),
    listPartners(true).catch(() => [] as Partner[]),
    shipment.console_id ? getConsole(shipment.console_id).catch(() => null) : Promise.resolve(null),
  ]);
  const byId = (id: string | null | undefined) => (id ? partners.find((p) => p.id === id) : undefined);
  const agent = byId(con?.agent_id) ?? byId(shipment.routed_agent_id);
  const mto = byId(mtoPartnerId);
  return {
    shipment,
    containers: boxes,
    agent: agent ? { name: agent.organisation || agent.name, address: agent.address ?? "", contact: contactOf(agent) } : null,
    mto: mto ? { name: mto.organisation || mto.name, registration: mto.mto_registration } : null,
    place: "Chennai",
    today: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10),
  };
}

export { hblFromJob };
