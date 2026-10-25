import { MONTHS_SHORT } from "./dates";

/**
 * The customer's milestones (102): what the tracking page shows, and what the
 * Tracking tab records.
 *
 * ---------------------------------------------------------------------------
 * ONE LIST, RECORDED BY A PERSON
 *
 * Booking confirmed, picked up, received, customs, sailed, arrived, out for
 * delivery, delivered — per mode, copied onto each job — plus any update the
 * desk writes itself. A milestone is reached when somebody records it: the
 * day, the time if known, where, a note. Nothing else moves it, and the
 * customer's page shows nothing else about progress.
 *
 * THE TIMES ARE AS TOLD
 *
 * "Sailed 27 Sep, 14:30" is the port's time, the way a line or an agent
 * reports it, and is kept and shown as typed — not converted to India's
 * time, which would put a Jebel Ali arrival an hour and a half out.
 *
 * WHAT THE CUSTOMER SEES, IN ORDER
 *
 * What has happened, oldest first by when it happened; then what is still to
 * come, in the list's order. A milestone nobody recorded but that a later one
 * has overtaken ("out for delivery" when "delivered" is recorded) is passed:
 * showing it as still to come would say the cargo is going backwards.
 * ---------------------------------------------------------------------------
 */

export interface MilestoneLike {
  label: string;
  /** The job's stage this milestone marks, or null. */
  stage: string | null;
  position: number;
  /** An update the desk wrote itself, not one of the standing list. */
  added?: boolean;
  /** YYYY-MM-DD; null until it is recorded. */
  reached_on: string | null;
  /** HH:MM (the database sends HH:MM:SS); null when only the day is known. */
  reached_time: string | null;
  location?: string | null;
  note?: string | null;
  hidden?: boolean;
}

export const STAGE_ORDER = ["booked", "cargo_received", "stuffed", "gated_in", "sailed", "arrived", "delivered"];

export const hhmm = (t: string | null | undefined): string | null => (t ? t.slice(0, 5) : null);

const reached = (m: MilestoneLike) => Boolean(m.reached_on);

/**
 * When they happened: the day, then the time — a day given without one after
 * those with one, since it cannot be placed within the day — then the list's
 * order. A total order, so the same list always sorts the same way.
 */
export function byWhen(a: MilestoneLike, b: MilestoneLike): number {
  const d = (a.reached_on ?? "").localeCompare(b.reached_on ?? "");
  if (d) return d;
  const t = (hhmm(a.reached_time) ?? "99:99").localeCompare(hhmm(b.reached_time) ?? "99:99");
  if (t) return t;
  return a.position - b.position;
}

export interface CustomerView<M extends MilestoneLike> {
  /** Recorded, oldest first. */
  done: M[];
  /** Still to come, in the list's order. */
  ahead: M[];
  /** Not recorded, but overtaken by a later milestone: not shown to the customer. */
  passed: M[];
  /** The last thing that happened. */
  latest: M | null;
  /** The furthest stage recorded — "booked" when none is. */
  stage: string;
}

export function customerView<M extends MilestoneLike>(list: M[]): CustomerView<M> {
  const visible = list.filter((m) => !m.hidden);
  const done = visible.filter(reached).sort(byWhen);
  // How far the standing list has got. An update of the desk's own sits after
  // the list and says nothing about which of its milestones are behind.
  const furthest = done.filter((m) => !m.added).reduce((n, m) => Math.max(n, m.position), -Infinity);
  const open = visible.filter((m) => !reached(m)).sort((a, b) => a.position - b.position);
  const stage = done.reduce<string | null>((best, m) => {
    if (!m.stage) return best;
    return best === null || STAGE_ORDER.indexOf(m.stage) > STAGE_ORDER.indexOf(best) ? m.stage : best;
  }, null);
  return {
    done,
    ahead: open.filter((m) => m.position > furthest),
    passed: open.filter((m) => m.position < furthest),
    latest: done.length ? done[done.length - 1] : null,
    stage: stage ?? "booked",
  };
}

/**
 * The booking's own date for a milestone still to come: its ETD for the
 * sailing, its ETA for the arrival. Only those two — the booking holds no
 * other date the customer was promised.
 */
export function expectedFor(m: MilestoneLike, booking: { etd: string | null; eta: string | null }): string | null {
  if (reached(m)) return null;
  if (m.stage === "sailed") return booking.etd;
  if (m.stage === "arrived") return booking.eta;
  return null;
}

/** "27 Sep 2026, 14:30", "27 Sep 2026", or without the year. */
export function milestoneWhen(on: string | null | undefined, time?: string | null, withYear = true): string {
  if (!on) return "";
  const [y, m, d] = on.slice(0, 10).split("-").map(Number);
  const t = hhmm(time);
  return `${d} ${MONTHS_SHORT[m - 1]}${withYear ? ` ${y}` : ""}${t ? `, ${t}` : ""}`;
}

/** A moment as India's day and time, for a record that holds a timestamp. */
export function istParts(iso: string): { on: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return { on: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Where a milestone usually happens, to start the "where" box with. */
export function placeFor(
  code: string,
  booking: { origin: string | null; destination: string | null; port_of_loading: string | null; port_of_discharge: string | null }
): string {
  switch (code) {
    case "departed":
    case "gated_in":
      return booking.port_of_loading ?? booking.origin ?? "";
    case "arrived":
      return booking.port_of_discharge ?? booking.destination ?? "";
    case "out_for_delivery":
    case "delivered":
      return booking.destination ?? "";
    default:
      return "";
  }
}

/** Why an entry cannot be saved, or null. `today` is India's (YYYY-MM-DD). */
export function entryProblem(entry: { on: string; time: string }, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.on)) return "Give the date it happened.";
  if (entry.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)) return "The time is HH:MM, or leave it empty.";
  // A day ahead of India's is allowed: it can already be tomorrow where it happened.
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  if (entry.on > t.toISOString().slice(0, 10)) return "That date is in the future. Record a milestone once it has happened; put what is expected in the note.";
  return null;
}

/* ---------------------------------------------------------------------------
 * "Use this": what the job's own records already say
 *
 * Offered beside the milestone, never applied: the delivery on Pickup &
 * delivery, the first warehouse receipt, the LEO or out-of-charge date on
 * Customs, and what a carrier, an airline or the job's mail reported. The
 * person reads it, and recording it is their decision. A record that holds a
 * moment (a POD, a feed's timestamp) is offered in India's time; the person
 * corrects it to the place's own time where that differs.
 * ------------------------------------------------------------------------- */

export interface Evidence {
  moves: Array<{ kind: "pickup" | "delivery"; actual_at: string | null; pieces: number | null; received_by: string | null }>;
  receipts: Array<{ receipt_no: string; received_at: string; location: string | null; pieces: number | null; gross_weight_kg: number | null }>;
  customs: Array<{ side: "export" | "import"; leo_date: string | null; ooc_date: string | null }>;
  events: Array<{ kind: string; occurred_at: string | null; location: string | null; source: string; status: string; estimated: boolean }>;
}

export interface Suggestion {
  on: string;
  time: string | null;
  location: string;
  note: string;
  /** Where it came from, in the desk's words. */
  from: string;
}

const EVENT_KINDS: Record<string, string[]> = {
  received: ["cargo_received"],
  stuffed: ["stuffed"],
  gated_in: ["gate_in"],
  departed: ["departed"],
  arrived: ["arrived", "discharged"],
  out_for_delivery: ["out_for_delivery"],
  delivered: ["delivered"],
};

const FEED: Record<string, string> = {
  aerodatabox: "AeroDataBox",
  adsb: "adsb.lol",
  hapag_lloyd: "Hapag-Lloyd",
  aisstream: "AIS",
  mail: "The job's mail",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Every movement of that kind done: the last one's moment. */
function allDone(moves: Evidence["moves"], kind: "pickup" | "delivery") {
  const of = moves.filter((m) => m.kind === kind);
  if (!of.length || of.some((m) => !m.actual_at)) return null;
  return of.reduce((last, m) => (m.actual_at! > last.actual_at! ? m : last));
}

export function suggestionFor(code: string, ev: Evidence): Suggestion | null {
  if (code === "picked_up") {
    const last = allDone(ev.moves, "pickup");
    if (last) {
      const pcs = ev.moves.filter((m) => m.kind === "pickup").reduce((n, m) => n + (m.pieces ?? 0), 0);
      return { ...istParts(last.actual_at!), location: "", note: pcs ? `${plural(pcs, "piece")} collected.` : "", from: "Pickup & delivery" };
    }
  }
  if (code === "delivered") {
    const last = allDone(ev.moves, "delivery");
    if (last) {
      const by = [...new Set(ev.moves.filter((m) => m.kind === "delivery" && m.received_by).map((m) => m.received_by!))].join(", ");
      return { ...istParts(last.actual_at!), location: "", note: by ? `Received by ${by}.` : "", from: "Pickup & delivery" };
    }
  }
  if (code === "received" && ev.receipts.length) {
    const first = [...ev.receipts].sort((a, b) => (a.received_at < b.received_at ? -1 : 1))[0];
    const pcs = ev.receipts.reduce((n, r) => n + (r.pieces ?? 0), 0);
    const kg = ev.receipts.reduce((n, r) => n + Number(r.gross_weight_kg ?? 0), 0);
    const note = [pcs ? plural(pcs, "piece") : null, kg ? `${kg.toLocaleString("en-IN")} kg` : null].filter(Boolean).join(", ");
    return { ...istParts(first.received_at), location: first.location ?? "", note: note ? `${note} received.` : "", from: `Warehouse receipt ${first.receipt_no}` };
  }
  if (code === "export_customs" || code === "import_customs") {
    const side = code === "export_customs" ? "export" : "import";
    const c = ev.customs.find((x) => x.side === side);
    const day = side === "export" ? c?.leo_date : c?.ooc_date;
    if (day) return { on: day.slice(0, 10), time: null, location: "", note: "", from: side === "export" ? "Customs record (LEO)" : "Customs record (out of charge)" };
  }

  // What a feed or the mail said: the first report of it that nobody set aside.
  const kinds = EVENT_KINDS[code];
  if (!kinds) return null;
  const said = ev.events
    .filter((e) => kinds.includes(e.kind) && e.occurred_at && !e.estimated && e.status !== "dismissed")
    .sort((a, b) => (a.occurred_at! < b.occurred_at! ? -1 : 1))[0];
  if (!said) return null;
  return { ...istParts(said.occurred_at!), location: said.location ?? "", note: "", from: FEED[said.source] ?? said.source };
}
