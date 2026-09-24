import { daysUntil } from "./progress";

/**
 * Free time, demurrage and detention: how long each box has left, and what it
 * is costing once it has none.
 *
 * ---------------------------------------------------------------------------
 * THE TWO CLOCKS
 *
 * Demurrage runs while a full box sits in the terminal; detention runs while
 * the line's box is out of the terminal — with the consignee on an import,
 * with the shipper being stuffed on an export — until it is back. Each has its
 * own free days, or the carrier grants one combined allowance that runs from
 * the first date to the last (083 lists the dates).
 *
 * A shipper-owned box (SOC) pays no detention, because it is not the line's
 * box to return. It still pays demurrage for the space it takes in the port.
 *
 * HOW THE DAYS ARE COUNTED
 *
 * Calendar days, in IST, with the day the clock starts as day one — the way
 * carriers state free time on an arrival notice. Fourteen free days from a
 * discharge on 1 October means the 14th is the last free day and the 15th is
 * the first one charged. A clock that has stopped counts to the day it
 * stopped; one still running counts to today.
 *
 * WHAT IT DOES NOT DO
 *
 * Slab tariffs (days 1–5 at one rate, 6–10 at another) and weekend or holiday
 * exclusions. The rate is one figure per box per day, so what it prints is an
 * estimate and is labelled as one.
 * ---------------------------------------------------------------------------
 */

export type Side = "import" | "export";
export type Basis = "separate" | "combined";
export type ClockKind = "demurrage" | "detention" | "combined";

/** The job's terms, as the shipment row carries them (083). */
export interface FreeTimeTerms {
  free_time_basis: Basis | string | null;
  demurrage_free_days: number | null;
  detention_free_days: number | null;
  combined_free_days: number | null;
  demurrage_rate: number | null;
  detention_rate: number | null;
  combined_rate: number | null;
  dnd_currency: string | null;
}

/** One box's dates, as shipment_containers carries them (083). */
export interface BoxDates {
  discharged_on: string | null;
  gate_out_on: string | null;
  empty_returned_on: string | null;
  empty_picked_on: string | null;
  gate_in_on: string | null;
  loaded_on: string | null;
  is_soc: boolean;
}

export type DateKey = Exclude<keyof BoxDates, "is_soc">;

/** The dates each side uses, in the order they happen. `event` is the date as a noun: "starts at discharge". */
export const SIDE_DATES: Record<Side, Array<{ key: DateKey; label: string; event: string; hint: string }>> = {
  import: [
    { key: "discharged_on", label: "Discharged", event: "discharge", hint: "Off the ship at the port of discharge" },
    { key: "gate_out_on", label: "Gate-out full", event: "gate-out", hint: "Left the terminal, loaded" },
    { key: "empty_returned_on", label: "Empty returned", event: "empty return", hint: "Back to the line's depot, empty" },
  ],
  export: [
    { key: "empty_picked_on", label: "Empty picked up", event: "empty pickup", hint: "Collected from the depot for stuffing" },
    { key: "gate_in_on", label: "Gate-in full", event: "gate-in", hint: "Into the terminal, loaded" },
    { key: "loaded_on", label: "Loaded on board", event: "loading", hint: "On the ship" },
  ],
};

export const CLOCK_LABEL: Record<ClockKind, string> = {
  demurrage: "Demurrage",
  detention: "Detention",
  combined: "Demurrage and detention",
};

/**
 * Which end of the voyage the desk is counting at.
 *
 * An export's clocks run at the origin, an import's at the destination. A
 * cross-trade is counted at the destination, where the consignee's delays
 * are the ones that turn into charges.
 */
export function sideOf(tradeDirection: string | null | undefined): Side {
  return tradeDirection === "export" ? "export" : "import";
}

/** Only a full container load has a box of its own on the line's clock. */
export function appliesTo(transportMode: string | null | undefined): boolean {
  return transportMode === "sea_fcl";
}

export type ClockState =
  /** Its first date has not happened yet. */
  | "waiting"
  /** Running, but nobody has recorded how many days are free. */
  | "no_terms"
  | "running"
  /** Running, with the last free day within ENDING_DAYS. */
  | "ending"
  /** Running, past the last free day. */
  | "over"
  | "closed"
  | "closed_over";

/** "Ending" from this many days before the last free day. */
export const ENDING_DAYS = 2;

export interface Clock {
  kind: ClockKind;
  from: { key: DateKey; label: string; date: string | null };
  to: { key: DateKey; label: string; date: string | null };
  freeDays: number | null;
  rate: number | null;
  currency: string;
  /** The last day not charged. Null until the clock has a start and free days. */
  lastFreeDay: string | null;
  /** Days counted so far, the start as day one. Zero while waiting. */
  used: number;
  /** Days from today to the last free day while running: 0 is today, 1 tomorrow. */
  left: number | null;
  /** Days charged. */
  over: number;
  /** over × rate, where there is a rate. */
  accrued: number | null;
  state: ClockState;
  /** The dates contradict each other: the clock stopped before it started. */
  problem: string | null;
}

const addDays = (day: string, n: number): string => {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const dateDef = (key: DateKey) => [...SIDE_DATES.import, ...SIDE_DATES.export].find((d) => d.key === key)!;
const label = (key: DateKey) => dateDef(key).label;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function clock(
  kind: ClockKind,
  fromKey: DateKey,
  toKey: DateKey,
  box: BoxDates,
  freeDays: number | null,
  rate: number | null,
  currency: string,
  today: string
): Clock {
  const start = box[fromKey];
  const stop = box[toKey];
  const base = {
    kind,
    from: { key: fromKey, label: label(fromKey), date: start },
    to: { key: toKey, label: label(toKey), date: stop },
    freeDays,
    rate,
    currency,
  };
  const lastFreeDay = start && freeDays !== null ? addDays(start, freeDays - 1) : null;

  // Not started: nothing counted yet. A start typed in advance still says
  // when free time will end.
  if (!start || (!stop && start > today)) {
    return { ...base, lastFreeDay, used: 0, left: null, over: 0, accrued: null, state: "waiting", problem: null };
  }

  if (stop && stop < start) {
    return {
      ...base,
      lastFreeDay,
      used: 0,
      left: null,
      over: 0,
      accrued: null,
      state: "closed",
      problem: `${cap(dateDef(toKey).event)} is dated before ${dateDef(fromKey).event}`,
    };
  }

  // daysUntil(due, from): how many days `due` is after `from`.
  const used = daysUntil(stop ?? today, start) + 1;
  if (freeDays === null) {
    return { ...base, lastFreeDay: null, used, left: null, over: 0, accrued: null, state: stop ? "closed" : "no_terms", problem: null };
  }

  const over = Math.max(0, used - freeDays);
  const accrued = rate === null ? null : over * rate;
  if (stop) {
    return { ...base, lastFreeDay, used, left: null, over, accrued, state: over > 0 ? "closed_over" : "closed", problem: null };
  }
  const left = daysUntil(lastFreeDay!, today);
  const state: ClockState = over > 0 ? "over" : left <= ENDING_DAYS ? "ending" : "running";
  return { ...base, lastFreeDay, used, left, over, accrued, state, problem: null };
}

/** The clocks one box runs on this job, in the order they run. */
export function clocksFor(side: Side, terms: FreeTimeTerms, box: BoxDates, today: string): Clock[] {
  const currency = (terms.dnd_currency || "USD").toUpperCase();
  const combined = terms.free_time_basis === "combined";
  const dem = (from: DateKey, to: DateKey) =>
    clock(
      "demurrage",
      from,
      to,
      box,
      // A shipper-owned box on combined terms still has the port's free days,
      // and the combined allowance is the only figure the carrier gave.
      combined ? (terms.demurrage_free_days ?? terms.combined_free_days) : terms.demurrage_free_days,
      combined ? (terms.demurrage_rate ?? terms.combined_rate) : terms.demurrage_rate,
      currency,
      today
    );
  const det = (from: DateKey, to: DateKey) =>
    clock("detention", from, to, box, terms.detention_free_days, terms.detention_rate, currency, today);

  if (side === "import") {
    if (box.is_soc) return [dem("discharged_on", "gate_out_on")];
    if (combined) return [clock("combined", "discharged_on", "empty_returned_on", box, terms.combined_free_days, terms.combined_rate, currency, today)];
    return [dem("discharged_on", "gate_out_on"), det("gate_out_on", "empty_returned_on")];
  }
  if (box.is_soc) return [dem("gate_in_on", "loaded_on")];
  if (combined) return [clock("combined", "empty_picked_on", "loaded_on", box, terms.combined_free_days, terms.combined_rate, currency, today)];
  return [det("empty_picked_on", "gate_in_on"), dem("gate_in_on", "loaded_on")];
}

// ---------------------------------------------------------------------------
// Across a job
// ---------------------------------------------------------------------------

export type SummaryState = "none" | "waiting" | "running" | "no_terms" | "ending" | "over";

export interface FreeTimeSummary {
  state: SummaryState;
  /** The most urgent live clock's last free day. */
  lastFreeDay: string | null;
  left: number | null;
  /** The most days over on any live clock. */
  over: number;
  /** Charged so far on every clock, live or closed, where rates are known. */
  accrued: number | null;
  currency: string | null;
  /** Boxes with a live clock over or ending. */
  boxes: number;
  text: string;
}

export const NO_FREE_TIME: FreeTimeSummary = {
  state: "none",
  lastFreeDay: null,
  left: null,
  over: 0,
  accrued: null,
  currency: null,
  boxes: 0,
  text: "",
};

const RANK: Record<SummaryState, number> = { none: 0, waiting: 1, running: 2, no_terms: 3, ending: 4, over: 5 };

/** The job's worst live clock, for the worklist and the job file's header. */
export function summarise(boxes: Clock[][], today: string): FreeTimeSummary {
  let best: FreeTimeSummary = { ...NO_FREE_TIME };
  let accrued: number | null = null;
  let currency: string | null = null;
  let urgent = 0;

  for (const clocks of boxes) {
    if (clocks.some((c) => c.state === "over" || c.state === "ending")) urgent++;
    for (const c of clocks) {
      if (c.accrued !== null && c.over > 0) {
        accrued = (accrued ?? 0) + c.accrued;
        currency = c.currency;
      }
      const state: SummaryState =
        c.state === "closed" || c.state === "closed_over" ? "none" : c.state;
      const worse =
        RANK[state] > RANK[best.state] ||
        (RANK[state] === RANK[best.state] &&
          (state === "over" ? c.over > best.over : c.left !== null && (best.left === null || c.left < best.left)));
      if (worse) best = { ...best, state, lastFreeDay: c.lastFreeDay, left: c.left, over: c.over };
    }
  }
  return { ...best, accrued, currency, boxes: urgent, text: summaryText(best, today) };
}

function summaryText(s: Pick<FreeTimeSummary, "state" | "left" | "over" | "lastFreeDay">, today: string): string {
  switch (s.state) {
    case "over":
      return `Free time over by ${s.over} day${s.over === 1 ? "" : "s"}`;
    case "ending":
      return s.left === 0 ? "Free time ends today" : s.left === 1 ? "Free time ends tomorrow" : `Free time ends in ${s.left} days`;
    case "running":
      return s.lastFreeDay ? `Free until ${shortDay(s.lastFreeDay, today)}` : "Free time running";
    case "no_terms":
      return "Free days not recorded";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "16 Oct", with the year only when it is not this one. Spelled from a list: en-IN prints "Sept". */
export function shortDay(day: string, today: string): string {
  const d = `${+day.slice(8, 10)} ${MONTHS[+day.slice(5, 7) - 1]}`;
  return day.slice(0, 4) === today.slice(0, 4) ? d : `${d} ${day.slice(0, 4)}`;
}

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** One line for the clock, as the container card shows it. */
export function clockText(c: Clock, today: string): string {
  const money = c.accrued !== null && c.over > 0 ? ` · about ${c.currency} ${c.accrued.toLocaleString("en-IN")}` : "";
  switch (c.state) {
    case "waiting":
      if (!c.from.date) return `Starts at ${dateDef(c.from.key).event}`;
      return c.lastFreeDay
        ? `Starts ${shortDay(c.from.date, today)}; free until ${shortDay(c.lastFreeDay, today)}`
        : `Starts ${shortDay(c.from.date, today)}`;
    case "no_terms":
      return `Day ${c.used} — free days not recorded`;
    case "running":
    case "ending":
      return `Day ${c.used} of ${c.freeDays} free · ${
        c.left === 0 ? "last free day today" : c.left === 1 ? "last free day tomorrow" : `free until ${shortDay(c.lastFreeDay!, today)}`
      }`;
    case "over":
      return `${days(c.over)} over free time${money}`;
    case "closed":
      return c.problem ?? (c.freeDays === null ? `Stopped on day ${c.used}` : `Stopped on day ${c.used}, within free time`);
    case "closed_over":
      return `Stopped on day ${c.used}, ${days(c.over)} charged${money}`;
  }
}

/** The terms in a sentence, for the arrival notice: "14 days demurrage, 7 days detention". */
export function termsText(t: FreeTimeTerms): string | undefined {
  if (t.free_time_basis === "combined") {
    return t.combined_free_days === null ? undefined : `${days(t.combined_free_days)}, demurrage and detention combined`;
  }
  const parts = [
    t.demurrage_free_days !== null && `${days(t.demurrage_free_days)} demurrage`,
    t.detention_free_days !== null && `${days(t.detention_free_days)} detention`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}
