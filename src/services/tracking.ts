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
  steps?: Array<{ label: string; done_at: string | null; due_on: string | null; milestone: boolean; stage?: string | null }>;
  delivered_to?: string | null;
  /** What the airline or carrier reported (072). Never a line read from mail. */
  updates?: Array<{ at: string; what: string; where: string | null }>;
  /** The latest position a flight or ship gave, while it is moving and under three days old. */
  position?: { lat: number; lon: number; at: string; what: string | null } | null;

  /* The rest of the page (074). */
  /** The airline's or carrier's latest arrival estimate, where it differs from the booking. */
  latest_eta?: { eta: string; source: "airline" | "carrier"; at: string } | null;
  /** The latest thing that moved on the job. */
  updated_at?: string | null;
  movements?: Array<{
    kind: "pickup" | "delivery";
    planned_date: string | null;
    planned_time: string | null;
    actual_at: string | null;
    pieces: number | null;
    received_by: string | null;
  }>;
  received?: { first_at: string; receipts: number; pieces: number | null; gross_weight_kg: number | null; volume_cbm: number | null } | null;
  legs?: Array<{
    move: string;
    from: string | null;
    to: string | null;
    etd: string | null;
    eta: string | null;
    carrier: string | null;
    voyage_flight: string | null;
    status: string;
  }>;
  containers?: Array<{ number: string; type: string | null }>;
}

export interface TrackLink {
  token: string;
  created_at: string;
  opened_at: string | null;
  /** The last time the customer's page was loaded (074). */
  last_opened_at: string | null;
}

export async function currentTrackLink(shipmentId: string): Promise<TrackLink | null> {
  const { data, error } = await supabase
    .from("shipment_track_links")
    .select("token, created_at, opened_at, last_opened_at")
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

/** Where the flight or ship has reported from, for the customer's route map (076). */
export async function trackPointsByToken(token: string): Promise<Array<{ lat: number; lon: number; at: string; source: string }>> {
  const { data, error } = await supabase.rpc("shipment_track_points", { p_token: token });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ lat: number; lon: number; at: string; source: string }>;
}

/** The page a customer opens — on the public address, like the quote link. */
export function trackUrl(token: string): string {
  const base = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, "");
  return `${base}/t/${encodeURIComponent(token)}`;
}
