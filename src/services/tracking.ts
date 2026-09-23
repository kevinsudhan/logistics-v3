import { supabase } from "../lib/supabase";

/**
 * The customer's tracking link (069).
 *
 * One live link per shipment; issuing again returns it. The page it opens is
 * built by `shipment_tracking`, column by column — milestones and schedule,
 * never money, notes or people.
 */

export interface PublicTracking {
  state: "open" | "revoked" | "unknown";
  reference?: string;
  shipment?: string;
  customer?: string | null;
  mode?: string | null;
  stage?: string;
  stage_label?: string;
  origin?: string | null;
  destination?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  carrier?: string | null;
  flight_number?: string | null;
  vessel?: string | null;
  voyage?: string | null;
  etd?: string | null;
  etd_time?: string | null;
  eta?: string | null;
  eta_time?: string | null;
  house_bill?: string | null;
  cargo?: string | null;
  pieces?: number | null;
  gross_weight_kg?: number | null;
  volume_cbm?: number | null;
  steps?: Array<{ label: string; done_at: string | null; due_on: string | null; milestone: boolean }>;
  delivered_to?: string | null;
}

export interface TrackLink {
  token: string;
  created_at: string;
  opened_at: string | null;
}

export async function currentTrackLink(shipmentId: string): Promise<TrackLink | null> {
  const { data, error } = await supabase
    .from("shipment_track_links")
    .select("token, created_at, opened_at")
    .eq("shipment_id", shipmentId)
    .eq("revoked", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TrackLink) ?? null;
}

export async function issueTrackLink(shipmentId: string): Promise<TrackLink> {
  const { data, error } = await supabase.rpc("issue_track_link", { p_shipment_id: shipmentId });
  if (error) throw new Error(error.message);
  return data as TrackLink;
}

export async function revokeTrackLink(shipmentId: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_track_link", { p_shipment_id: shipmentId });
  if (error) throw new Error(error.message);
}

export async function trackingByToken(token: string): Promise<PublicTracking> {
  const { data, error } = await supabase.rpc("shipment_tracking", { p_token: token });
  if (error) throw new Error(error.message);
  return data as PublicTracking;
}

/** The page a customer opens — on the public address, like the quote link. */
export function trackUrl(token: string): string {
  const base = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, "");
  return `${base}/t/${encodeURIComponent(token)}`;
}
