import { supabase } from "../lib/supabase";
import type { MailMessage } from "./backend";
import { stripTags } from "./classify";
import type { Shipment } from "./enquiries";

/**
 * Live tracking (072): what the airline, the carrier, the ship and the mail say.
 *
 * ---------------------------------------------------------------------------
 * The `track-shipment` edge function asks the outside sources and files their
 * answers; this reads what it filed, asks it to look again, and lets a person
 * act on what came back. The mail is read here, in the browser, because the
 * mailbox is only reachable from the signed-in person's session — the model
 * reads it through the same function that reads enquiries.
 * ---------------------------------------------------------------------------
 */

export type TrackSource = "aerodatabox" | "adsb" | "hapag_lloyd" | "aisstream";
export type TrackState = "ok" | "not_found" | "not_configured" | "not_applicable" | "error";

export interface Snapshot {
  shipment_id: string;
  source: TrackSource;
  fetched_at: string;
  state: TrackState;
  message: string;
  summary: Record<string, unknown>;
}

export type EventKind =
  | "cargo_received"
  | "stuffed"
  | "gate_in"
  | "loaded"
  | "departed"
  | "in_transit"
  | "arrived"
  | "discharged"
  | "customs_cleared"
  | "gate_out"
  | "out_for_delivery"
  | "delivered"
  | "delayed"
  | "rolled_over"
  | "schedule_changed"
  | "cancelled"
  | "other";

export interface TrackingEvent {
  id: string;
  shipment_id: string;
  source: TrackSource | "mail";
  kind: EventKind;
  occurred_at: string | null;
  estimated: boolean;
  location: string | null;
  detail: string;
  data: { etd?: string | null; eta?: string | null; evidence?: string; subject?: string };
  external_id: string;
  message_id: string | null;
  status: "new" | "applied" | "info" | "dismissed";
  applied_step: string | null;
  created_at: string;
}

export const SOURCE_NAME: Record<TrackSource | "mail", string> = {
  aerodatabox: "AeroDataBox",
  adsb: "adsb.lol",
  hapag_lloyd: "Hapag-Lloyd",
  aisstream: "AIS",
  mail: "Mail",
};

/** Which milestone an event is evidence for — the same table as tracking_stage() in 072. */
export const EVENT_STAGE: Partial<Record<EventKind, string>> = {
  cargo_received: "cargo_received",
  stuffed: "stuffed",
  gate_in: "gated_in",
  departed: "sailed",
  arrived: "arrived",
  discharged: "arrived",
  delivered: "delivered",
};

export async function snapshotsFor(shipmentId: string): Promise<Snapshot[]> {
  const { data, error } = await supabase.from("tracking_snapshots").select("*").eq("shipment_id", shipmentId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Snapshot[];
}

/** Every position reported for a shipment, oldest first (076). */
export async function positionsFor(shipmentId: string): Promise<Array<{ lat: number; lon: number; at: string; source: string }>> {
  const { data, error } = await supabase
    .from("tracking_positions")
    .select("lat, lon, at, source")
    .eq("shipment_id", shipmentId)
    .order("at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ lat: number; lon: number; at: string; source: string }>;
}

export async function trackingEventsFor(shipmentId: string): Promise<TrackingEvent[]> {
  const { data, error } = await supabase
    .from("tracking_events")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("occurred_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as TrackingEvent[];
}

export interface RefreshOutcome {
  source: TrackSource;
  state: TrackState;
  message: string;
  added?: number;
  ticked?: number;
  cached?: boolean;
}

/** Ask every source that can say something about this shipment. */
export async function refreshTracking(shipmentId: string): Promise<RefreshOutcome[]> {
  const { data, error } = await supabase.functions.invoke("track-shipment", { body: { shipment_id: shipmentId } });
  if (error) {
    // The function's own message, where it sent one, says more than "non-2xx".
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? error.message);
  }
  return ((data as { results?: RefreshOutcome[] })?.results ?? []) as RefreshOutcome[];
}

/** 'applied', 'already' (that step was ticked before) or 'no_step'. */
export async function applyTrackingEvent(id: string): Promise<"applied" | "already" | "no_step" | "dismissed"> {
  const { data, error } = await supabase.rpc("apply_tracking_event", { p_id: id });
  if (error) throw new Error(error.message);
  return data as "applied" | "already" | "no_step" | "dismissed";
}

/** "Not ours" — or, with keep, "true, but it ticks nothing": a line on the timeline. */
export async function dismissTrackingEvent(id: string, keep = false): Promise<void> {
  const { error } = await supabase.rpc("dismiss_tracking_event", { p_id: id, p_keep: keep });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Reading the mail for news
// ---------------------------------------------------------------------------

export async function mailReadFor(shipmentId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("tracking_mail_reads").select("message_id").eq("shipment_id", shipmentId);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.message_id as string));
}

/** The mail worth reading: arrived since the booking was made, and not read before. */
export function unreadForTracking(messages: MailMessage[], shipment: Pick<Shipment, "created_at">, read: Set<string>): MailMessage[] {
  const since = Date.parse(shipment.created_at) - 86_400_000;
  return messages
    .filter((m) => !m.isDraft && Date.parse(m.receivedDateTime) >= since && !read.has(m.id))
    .sort((a, b) => (a.receivedDateTime < b.receivedDateTime ? -1 : 1));
}

/** What the model is told about the shipment, so it can tell our job's mail from another's. */
export function trackingContext(s: Shipment): string {
  const air = s.transport_mode === "air";
  return [
    `Reference: ${s.enquiry_ref} / shipment ${s.id}`,
    `Mode: ${s.transport_mode ?? "not set"}`,
    `Route: ${[s.port_of_loading ?? s.origin, s.port_of_discharge ?? s.destination].filter(Boolean).join(" to ") || "not set"}`,
    air ? `Flight: ${s.flight_number ?? "not set"}` : `Vessel: ${[s.vessel, s.voyage].filter(Boolean).join(" / ") || "not set"}`,
    s.carrier ? `Carrier: ${s.carrier}` : null,
    s.bl_number ? `House bill: ${s.bl_number}` : null,
    s.mainline_no ? `Master bill: ${s.mainline_no}` : null,
    s.booking_number ? `Carrier booking: ${s.booking_number}` : null,
    s.container_number ? `Container: ${s.container_number}` : null,
    `ETD ${s.etd ?? s.sailing_date ?? "not set"}, ETA ${s.eta ?? "not set"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

interface ReadEvent {
  kind: EventKind;
  date: string | null;
  time: string | null;
  location: string | null;
  detail: string;
  evidence: string;
  new_etd: string | null;
  new_eta: string | null;
}

const isDate = (s: string | null | undefined) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)));

/**
 * A reading as the rows 072 files. The time is the desk's (IST) because the
 * mail rarely says whose clock it means; a date with no time is midnight IST,
 * which the timeline shows as the date alone.
 */
export function toSuggestions(events: ReadEvent[], subject: string): Array<Record<string, unknown>> {
  return events
    .filter((e) => e.kind && e.detail)
    .map((e) => {
      const time = e.time && /^\d{1,2}:\d{2}$/.test(e.time) ? e.time.padStart(5, "0") : "00:00";
      return {
        kind: e.kind,
        occurred_at: isDate(e.date) ? `${e.date}T${time}:00+05:30` : null,
        location: e.location,
        detail: e.detail,
        data: {
          etd: isDate(e.new_etd) ? e.new_etd : null,
          eta: isDate(e.new_eta) ? e.new_eta : null,
          evidence: e.evidence?.slice(0, 200),
          subject: subject.slice(0, 200),
        },
      };
    })
    // A schedule change without a date to move to is only a delay.
    .map((e) => (e.kind === "schedule_changed" && !(e.data as { etd: unknown; eta: unknown }).etd && !(e.data as { eta: unknown }).eta ? { ...e, kind: "delayed" } : e));
}

/** Reads one message for news about this shipment and files what it found. Returns how many. */
export async function readMailForTracking(s: Shipment, m: MailMessage): Promise<number> {
  const html = m.body?.contentType === "html";
  const content = m.body?.content ?? m.bodyPreview ?? "";
  const { data, error } = await supabase.functions.invoke("classify-enquiry", {
    body: {
      mode: "tracking",
      subject: m.subject,
      from: m.from?.emailAddress?.address,
      body: html ? stripTags(content) : content,
      context: trackingContext(s),
      sent_at: m.receivedDateTime,
    },
  });
  if (error) throw new Error(error.message);
  const d = data as { events?: ReadEvent[]; error?: string; detail?: string };
  if (d.error) throw new Error(d.error);
  const { data: n, error: e2 } = await supabase.rpc("suggest_tracking_events", {
    p_shipment_id: s.id,
    p_message_id: m.id,
    p_events: toSuggestions(d.events ?? [], m.subject ?? ""),
  });
  if (e2) throw new Error(e2.message);
  return n as number;
}

export async function setVesselIds(shipmentId: string, patch: { vessel_mmsi?: string | null; vessel_imo?: string | null }): Promise<void> {
  const { error } = await supabase.from("shipments").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", shipmentId);
  if (error) {
    if (/vessel_mmsi_check/.test(error.message)) throw new Error("An MMSI is nine digits.");
    if (/vessel_imo_check/.test(error.message)) throw new Error("An IMO number is seven digits.");
    throw new Error(error.message);
  }
}
