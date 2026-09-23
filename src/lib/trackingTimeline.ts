/**
 * Everything that has happened to a shipment, in the order it happened.
 *
 * ---------------------------------------------------------------------------
 * Six records say something happened — steps ticked, the pickup and the
 * delivery, warehouse receipts, the legs of the journey, and what the
 * airline, carrier or ship reported (072) — and the job's events say what the
 * desk did about it (who was told, what was asked for).
 * This merges them into one line so "what has happened on this job" is one
 * read, not five tabs.
 *
 * Stage changes are left out: every one of them is a milestone step being
 * ticked, which is already on the line, and saying it twice makes the
 * timeline twice as long without saying more. For the same reason a
 * tracking report that ticked a step is left out — the step carries it in
 * its note — and only the reports that tick nothing (loaded, transhipped,
 * delayed, gated out) are lines of their own. Offers still waiting for a
 * person, and estimates, are not history.
 * ---------------------------------------------------------------------------
 */

export type EntryKind = "step" | "pickup" | "delivery" | "receipt" | "leg" | "event" | "tracking";

export interface Entry {
  at: string;
  kind: EntryKind;
  title: string;
  detail?: string;
  /** A milestone, or a problem worth the eye. */
  tone?: "milestone" | "warning";
}

interface Step {
  label: string;
  done_at: string | null;
  due_on: string | null;
  stage: string | null;
  note: string;
}
interface Move {
  kind: "pickup" | "delivery";
  actual_at: string | null;
  vehicle_number: string | null;
  transporter: string | null;
  pieces: number | null;
  received_by: string | null;
}
interface ReceiptIn {
  receipt_no: string;
  received_at: string;
  location: string | null;
  pieces: number | null;
  gross_weight_kg: number | null;
  condition: string;
}
interface Leg {
  move: string;
  from_place: string | null;
  to_place: string | null;
  etd: string | null;
  eta: string | null;
  carrier: string | null;
  voyage_flight: string | null;
  status: string;
}
interface TrackIn {
  source: string;
  kind: string;
  occurred_at: string | null;
  estimated: boolean;
  detail: string;
  status: string;
}
const TRACK_SOURCE: Record<string, string> = {
  aerodatabox: "AeroDataBox",
  adsb: "adsb.lol",
  hapag_lloyd: "Hapag-Lloyd",
  aisstream: "AIS",
  mail: "from mail",
};
const TRACK_WARNING = new Set(["delayed", "rolled_over", "cancelled"]);

interface EventIn {
  at: string;
  kind: string;
  summary: string;
}

/** The job's events worth a line on the shipment's timeline. */
const EVENTS: Record<string, "warning" | undefined> = {
  promoted: undefined,
  party_notified: undefined,
  pickup_requested: undefined,
  delivery_requested: undefined,
  warehouse_discrepancy: "warning",
  confirmation_sent: undefined,
  tracking_link_sent: undefined,
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildTimeline(input: {
  steps: Step[];
  moves: Move[];
  receipts: ReceiptIn[];
  legs: Leg[];
  events: EventIn[];
  tracking?: TrackIn[];
}): Entry[] {
  const out: Entry[] = [];

  for (const s of input.steps) {
    if (!s.done_at) continue;
    out.push({
      at: s.done_at,
      kind: "step",
      title: s.label,
      detail: s.note || undefined,
      tone: s.stage ? "milestone" : undefined,
    });
  }

  for (const m of input.moves) {
    if (!m.actual_at) continue;
    const pickup = m.kind === "pickup";
    out.push({
      at: m.actual_at,
      kind: m.kind,
      title: pickup ? "Picked up" : "Delivered",
      detail:
        [
          m.pieces !== null ? `${m.pieces} pcs` : null,
          m.transporter,
          m.vehicle_number,
          !pickup && m.received_by ? `received by ${m.received_by}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
      tone: pickup ? undefined : "milestone",
    });
  }

  for (const r of input.receipts) {
    out.push({
      at: r.received_at,
      kind: "receipt",
      title: `Received at the warehouse (${r.receipt_no})`,
      detail:
        [
          r.location,
          r.pieces !== null ? `${r.pieces} pcs` : null,
          r.gross_weight_kg !== null ? `${Number(r.gross_weight_kg).toLocaleString("en-IN")} kg` : null,
          r.condition !== "good" ? r.condition : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
      tone: r.condition !== "good" ? "warning" : undefined,
    });
  }

  for (const l of input.legs) {
    // A leg is on the line when it has started: its ETD for a departure, its
    // ETA once it is complete.
    if (l.status !== "in_transit" && l.status !== "completed") continue;
    const when = l.status === "completed" ? (l.eta ?? l.etd) : l.etd;
    if (!when) continue;
    out.push({
      at: `${when.slice(0, 10)}T00:00:00`,
      kind: "leg",
      title: `${cap(l.move)} leg ${l.status === "completed" ? "completed" : "under way"}: ${[l.from_place, l.to_place].filter(Boolean).join(" → ")}`,
      detail: [l.carrier, l.voyage_flight].filter(Boolean).join(" · ") || undefined,
    });
  }

  for (const e of input.events) {
    if (!(e.kind in EVENTS)) continue;
    out.push({ at: e.at, kind: "event", title: e.summary, tone: EVENTS[e.kind] });
  }

  for (const t of input.tracking ?? []) {
    if (t.status !== "info" || t.estimated || !t.occurred_at) continue;
    out.push({
      at: t.occurred_at,
      kind: "tracking",
      title: t.detail,
      detail: TRACK_SOURCE[t.source] ?? t.source,
      tone: TRACK_WARNING.has(t.kind) ? "warning" : undefined,
    });
  }

  // Newest first: the question is "what happened last".
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** The open steps that have a date, soonest first — what happens next. */
export function upcoming(steps: Step[]): Array<{ label: string; due_on: string; milestone: boolean }> {
  return steps
    .filter((s) => !s.done_at && s.due_on)
    .map((s) => ({ label: s.label, due_on: s.due_on!, milestone: Boolean(s.stage) }))
    .sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : 0));
}
