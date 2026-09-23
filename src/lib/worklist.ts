/**
 * The in-process worklist: finding a job, narrowing the list, ordering it,
 * and writing it out — without drawing anything.
 *
 * ---------------------------------------------------------------------------
 * SEARCH
 *
 * One box for everything a desk might have in hand when the phone rings: the
 * job number, the enquiry reference, the HAWB or house B/L, the master bill,
 * the container, the carrier's booking, the customer, the consignee, the
 * flight, the vessel, a port. Every word typed must appear somewhere; spaces,
 * dashes and slashes inside codes are ignored, so "HLXU 123456 7" finds
 * HLXU1234567 and "maa/dxb" finds MAA/DXB/HAWB0000001.
 *
 * WHAT A JOB CARRIES BESIDES ITS ROW
 *
 * Its open steps (the next one and how late), its customs clearances (077)
 * and the tracking updates waiting for somebody to confirm (072) are loaded
 * alongside and passed in as `Extras`, so the rules here can be tested on
 * plain data.
 * ---------------------------------------------------------------------------
 */

export interface WorkRow {
  id: string;
  enquiry_ref: string;
  stage: string;
  transport_mode: string | null;
  customer: { company: string | null; name: string | null } | null;
  origin: string | null;
  destination: string | null;
  port_of_loading: string | null;
  port_of_discharge: string | null;
  carrier: string | null;
  flight_number: string | null;
  vessel: string | null;
  voyage: string | null;
  bl_number: string | null;
  mainline_no: string | null;
  container_number: string | null;
  booking_number: string | null;
  consignee_name: string | null;
  shipper_name: string | null;
  cargo: string | null;
  etd: string | null;
  eta: string | null;
  created_at: string;
  assigned_to: string | null;
}

export type CustomsState = "none" | "pending" | "on_hold" | "cleared";

export interface Extras {
  /** The soonest open due date, and how many open steps are overdue or due today. */
  soonest: string | null;
  overdue: number;
  dueToday: number;
  nextLabel: string | null;
  nextDue: string | null;
  customs: CustomsState;
  /** Tracking updates waiting for a person (072). */
  updates: number;
}

export const NO_EXTRAS: Extras = { soonest: null, overdue: 0, dueToday: 0, nextLabel: null, nextDue: null, customs: "none", updates: 0 };

export interface Filters {
  query: string;
  stage: string;
  mode: string;
  carrier: string;
  customs: "any" | CustomsState;
  focus: "all" | "overdue" | "today" | "updates";
}

export const NO_FILTERS: Filters = { query: "", stage: "all", mode: "all", carrier: "all", customs: "any", focus: "all" };

export type SortKey = "urgency" | "etd" | "eta" | "newest" | "customer";

/** The customs position of a job from its clearances: a hold wins, then anything open, then cleared. */
export function customsState(records: Array<{ status: string }>): CustomsState {
  if (!records.length) return "none";
  if (records.some((r) => r.status === "on_hold")) return "on_hold";
  if (records.every((r) => r.status === "cleared")) return "cleared";
  return "pending";
}

const squash = (s: string) => s.toLowerCase().replace(/[\s\-/.]+/g, "");

export function haystack(r: WorkRow): string {
  return [
    r.id,
    r.enquiry_ref,
    r.bl_number,
    r.mainline_no,
    r.container_number,
    r.booking_number,
    r.customer?.company,
    r.customer?.name,
    r.consignee_name,
    r.shipper_name,
    r.carrier,
    r.flight_number,
    r.vessel,
    r.voyage,
    r.origin,
    r.destination,
    r.port_of_loading,
    r.port_of_discharge,
    r.cargo,
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
}

/** Every word must appear, either as typed or with the code's separators ignored. */
export function matches(r: WorkRow, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = haystack(r);
  const flat = squash(hay);
  // "HLXU 123456 7" typed with spaces is one code: try the whole query flattened too.
  if (words.length > 1 && flat.includes(squash(query))) return true;
  return words.every((w) => hay.includes(w) || flat.includes(squash(w)));
}

export function applyFilters(rows: WorkRow[], f: Filters, extras: (id: string) => Extras): WorkRow[] {
  return rows.filter((r) => {
    const x = extras(r.id);
    if (f.stage !== "all" && r.stage !== f.stage) return false;
    if (f.mode !== "all" && (r.transport_mode ?? "none") !== f.mode) return false;
    if (f.carrier !== "all" && (r.carrier ?? "").trim().toLowerCase() !== f.carrier.toLowerCase()) return false;
    if (f.customs !== "any" && x.customs !== f.customs) return false;
    if (f.focus === "overdue" && x.overdue === 0) return false;
    if (f.focus === "today" && x.dueToday === 0) return false;
    if (f.focus === "updates" && x.updates === 0) return false;
    return matches(r, f.query);
  });
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);

export function sortRows(rows: WorkRow[], key: SortKey, extras: (id: string) => Extras): WorkRow[] {
  const by = <T,>(f: (r: WorkRow) => T | null, cmp: (a: T, b: T) => number) => (a: WorkRow, b: WorkRow) => {
    const x = f(a);
    const y = f(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1; // undated at the bottom
    if (y === null) return -1;
    return cmp(x, y);
  };
  const text = (a: string, b: string) => a.localeCompare(b);
  const out = [...rows];
  switch (key) {
    case "urgency":
      // The soonest open date first — overdue before today before later.
      return out.sort(by((r) => extras(r.id).soonest, (a, b) => daysBetween(b, a)));
    case "etd":
      return out.sort(by((r) => r.etd, text));
    case "eta":
      return out.sort(by((r) => r.eta, text));
    case "newest":
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case "customer":
      return out.sort(by((r) => (r.customer?.company || r.customer?.name || "").trim() || null, text));
  }
}

/** The carriers on the list, for the filter: as written, first spelling kept. */
export function carriersOf(rows: WorkRow[]): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const c = (r.carrier ?? "").trim();
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export const MODE_LABEL: Record<string, string> = {
  air: "Air",
  sea_fcl: "Sea FCL",
  sea_lcl: "Sea LCL",
  road: "Road",
  other: "Other",
  none: "Not set",
};

export const CUSTOMS_LABEL: Record<CustomsState, string> = {
  none: "—",
  pending: "In progress",
  on_hold: "On hold",
  cleared: "Cleared",
};

/** The list as a spreadsheet: what is on screen, in the order it is on screen. */
export function exportTable(
  rows: WorkRow[],
  extras: (id: string) => Extras,
  stageName: (r: WorkRow) => string
): { columns: Array<{ header: string; width: number }>; rows: Array<Array<string | number | Date | null>> } {
  const date = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`) : null);
  return {
    columns: [
      { header: "Shipment", width: 14 },
      { header: "Enquiry", width: 13 },
      { header: "Customer", width: 26 },
      { header: "Mode", width: 9 },
      { header: "From", width: 20 },
      { header: "To", width: 20 },
      { header: "Carrier", width: 16 },
      { header: "Flight / vessel", width: 18 },
      { header: "House bill", width: 22 },
      { header: "Container", width: 14 },
      { header: "ETD", width: 11 },
      { header: "ETA", width: 11 },
      { header: "Stage", width: 14 },
      { header: "Next step", width: 26 },
      { header: "Next due", width: 11 },
      { header: "Overdue steps", width: 8 },
      { header: "Customs", width: 12 },
      { header: "Updates waiting", width: 8 },
    ],
    rows: rows.map((r) => {
      const x = extras(r.id);
      return [
        r.id,
        r.enquiry_ref,
        r.customer?.company || r.customer?.name || null,
        MODE_LABEL[r.transport_mode ?? "none"] ?? r.transport_mode,
        r.port_of_loading ?? r.origin,
        r.port_of_discharge ?? r.destination,
        r.carrier,
        r.transport_mode === "air" ? r.flight_number : [r.vessel, r.voyage].filter(Boolean).join(" / ") || null,
        r.bl_number,
        r.container_number,
        date(r.etd),
        date(r.eta),
        stageName(r),
        x.nextLabel,
        date(x.nextDue),
        x.overdue || null,
        x.customs === "none" ? null : CUSTOMS_LABEL[x.customs],
        x.updates || null,
      ];
    }),
  };
}
