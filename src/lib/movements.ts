/**
 * Pickups and deliveries (067, 079): where each stands, the e-way bill's
 * life, and what the handover showed.
 *
 * ---------------------------------------------------------------------------
 * WHERE A MOVE STANDS
 *
 * Worked out from what is filled, never chosen: planned (a date), requested
 * (the transport order went), vehicle assigned (a truck number), done (when
 * it happened). A failed attempt stands until the move is planned again for a
 * later day.
 *
 * THE E-WAY BILL (GST Rule 138)
 *
 * Road movement of goods worth more than ₹50,000 needs one. It is valid for
 * one day per 200 km, or per 20 km for over-dimensional cargo, counted from
 * when it was generated with the vehicle (Part B); each day ends at midnight
 * of the day after — so a bill generated at 10:00 on the 4th, for 150 km,
 * runs until the end of the 5th. India's clock, whatever the reader's.
 * ---------------------------------------------------------------------------
 */

export type MovementStatus = "not_arranged" | "planned" | "requested" | "assigned" | "failed" | "done";

export interface MoveLike {
  planned_date: string | null;
  requested_at: string | null;
  vehicle_number: string | null;
  actual_at: string | null;
  attempts: Array<{ at: string; reason: string }>;
}

export const STATUS_WORDS: Record<MovementStatus, string> = {
  not_arranged: "Not arranged",
  planned: "Planned",
  requested: "Requested",
  assigned: "Vehicle assigned",
  failed: "Attempt failed",
  done: "Done",
};

const dayOf = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function movementStatus(m: MoveLike): MovementStatus {
  if (m.actual_at) return "done";
  const last = [...(m.attempts ?? [])].sort((a, b) => (a.at < b.at ? -1 : 1)).pop();
  // A failed attempt stands until the move is planned for a later day.
  if (last && !(m.planned_date && m.planned_date > dayOf(last.at))) return "failed";
  if (m.vehicle_number?.trim()) return "assigned";
  if (m.requested_at) return "requested";
  if (m.planned_date) return "planned";
  return "not_arranged";
}

/** The strip on the card: which of the four stages are passed. */
export function statusStrip(m: MoveLike): Array<{ label: string; done: boolean }> {
  const s = movementStatus(m);
  const rank: Record<MovementStatus, number> = { not_arranged: 0, planned: 1, failed: 1, requested: 2, assigned: 3, done: 4 };
  const r = rank[s];
  return [
    { label: "Planned", done: r >= 1 || Boolean(m.planned_date) },
    { label: "Requested", done: r >= 2 || Boolean(m.requested_at) },
    { label: "Vehicle", done: r >= 3 || Boolean(m.vehicle_number?.trim()) },
    { label: "Done", done: r >= 4 },
  ];
}

// ---------------------------------------------------------------------------
// The e-way bill
// ---------------------------------------------------------------------------

export const EWAY_THRESHOLD_INR = 50_000;

/** "1234 5678 9012" → "123456789012"; twelve digits or a reason. */
export function readEwayBill(raw: string): { value: string | null; error: string | null } {
  const t = raw.replace(/^(ewb|e-?way ?bill)\s*(no\.?|number|#)?\s*[:.]?\s*/i, "").replace(/[\s\-/.]/g, "");
  if (!t) return { value: null, error: null };
  if (!/^\d+$/.test(t)) return { value: null, error: "An e-way bill number is digits only." };
  if (t.length !== 12) return { value: null, error: `An e-way bill number has twelve digits; this has ${t.length}.` };
  return { value: t, error: null };
}

/** How many days a bill covers for a distance. */
export function ewayDays(distanceKm: number, odc: boolean): number {
  return Math.max(1, Math.ceil(distanceKm / (odc ? 20 : 200)));
}

/** When it runs out: the end of (the day it started + days), India's day, as an instant. */
export function ewayExpiry(startedAt: string, distanceKm: number, odc: boolean): string {
  const start = dayOf(startedAt);
  const [y, mo, d] = start.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, mo - 1, d + ewayDays(distanceKm, odc)));
  // 23:59:59 IST of the last day is 18:29:59 UTC.
  return new Date(lastDay.getTime() + (23 * 3600 + 59 * 60 + 59) * 1000 - 5.5 * 3_600_000).toISOString();
}

export type EwayState =
  | { state: "not_needed" }
  | { state: "needed"; why: string }
  | { state: "incomplete"; why: string }
  | { state: "valid"; expires: string; days: number }
  | { state: "expiring"; expires: string; days: number }
  | { state: "expired"; expires: string; days: number }
  | { state: "lapsed"; expires: string; days: number };

export function ewayState(
  m: { eway_bill_no: string | null; eway_bill_at: string | null; eway_distance_km: number | null; eway_odc: boolean; actual_at: string | null },
  cargoValueInr: number | null,
  now: Date
): EwayState {
  if (!m.eway_bill_no) {
    if (cargoValueInr !== null && cargoValueInr > EWAY_THRESHOLD_INR && !m.actual_at) {
      return { state: "needed", why: `Goods worth ₹${Math.round(cargoValueInr).toLocaleString("en-IN")} move by road: an e-way bill is needed above ₹50,000.` };
    }
    return { state: "not_needed" };
  }
  if (!m.eway_bill_at || !m.eway_distance_km) {
    return { state: "incomplete", why: "Add when it was generated and the distance to see how long it is valid." };
  }
  const days = ewayDays(m.eway_distance_km, m.eway_odc);
  const expires = ewayExpiry(m.eway_bill_at, m.eway_distance_km, m.eway_odc);
  if (m.actual_at) return m.actual_at > expires ? { state: "lapsed", expires, days } : { state: "valid", expires, days };
  const left = Date.parse(expires) - now.getTime();
  if (left < 0) return { state: "expired", expires, days };
  if (left < 12 * 3_600_000) return { state: "expiring", expires, days };
  return { state: "valid", expires, days };
}

// ---------------------------------------------------------------------------
// The handover
// ---------------------------------------------------------------------------

/** What does not match the booking, in words; empty when all is well or nothing is counted yet. */
export function handoverIssues(
  m: { pieces: number | null; gross_weight_kg: number | string | null; condition: string | null; exception_note: string | null },
  booked: { pieces: number | null; grossKg: number | null },
  share = 1
): string[] {
  const out: string[] = [];
  // A split move carries part of the cargo; only a single move is held to the whole booking.
  if (share === 1 && m.pieces !== null && booked.pieces && m.pieces !== booked.pieces) {
    out.push(`${m.pieces} pieces against ${booked.pieces} booked`);
  }
  const kg = m.gross_weight_kg === null ? null : Number(m.gross_weight_kg);
  if (share === 1 && kg !== null && booked.grossKg && Math.abs(kg - booked.grossKg) / booked.grossKg > 0.05) {
    out.push(`${kg.toLocaleString("en-IN")} kg against ${booked.grossKg.toLocaleString("en-IN")} kg booked`);
  }
  if (m.condition === "damaged") out.push(`Damaged${m.exception_note ? `: ${m.exception_note}` : ""}`);
  if (m.condition === "short") out.push(`Short${m.exception_note ? `: ${m.exception_note}` : ""}`);
  return out;
}

/** "Pickup", or "Pickup 2 of 3" when there are several. */
export function moveTitle(kind: "pickup" | "delivery", seq: number, count: number): string {
  const word = kind === "pickup" ? "Pickup" : "Delivery";
  return count > 1 ? `${word} ${seq} of ${count}` : word;
}
