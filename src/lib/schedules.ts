import { serialToDate, type Raw } from "./xlsxRead";

/**
 * The sailing schedule's columns, and turning an uploaded sheet into rows.
 *
 * ---------------------------------------------------------------------------
 * ONE COLUMN LIST FOR BOTH DIRECTIONS
 *
 * The download writes these headers and the upload reads them, so a file
 * downloaded, edited and uploaded again round-trips. The upload also accepts
 * the names schedules arrive under from carriers and agents — POL, POD,
 * "Vessel name", "CFS cut off" — because nobody retypes a carrier's sheet.
 *
 * WHAT MAKES A ROW
 *
 * Port of loading, port of discharge and an ETD. Everything else is optional.
 * A row with a Schedule ID updates that schedule; a row without one is new.
 * A row that cannot be read is reported with its line number and skipped —
 * one bad date must not throw away the other two hundred rows.
 * ---------------------------------------------------------------------------
 */

export interface ScheduleInput {
  id?: string;
  mode: "sea" | "air";
  services: string[];
  carrier: string | null;
  vessel: string | null;
  voyage: string | null;
  flight_number: string | null;
  port_of_receipt: string | null;
  port_of_loading: string;
  port_of_discharge: string;
  final_destination: string | null;
  cfs_cutoff: string | null;
  port_cutoff: string | null;
  si_cutoff: string | null;
  etd: string;
  eta: string | null;
  status: "scheduled" | "closed" | "departed" | "cancelled";
  notes: string | null;
}

type Key = keyof ScheduleInput | "transit_days";

export const SCHEDULE_COLUMNS: Array<{ key: Key; header: string; date?: boolean; exportOnly?: boolean; width?: number }> = [
  { key: "id", header: "Schedule ID", width: 14 },
  { key: "services", header: "Services", width: 10 },
  { key: "carrier", header: "Carrier", width: 18 },
  { key: "vessel", header: "Vessel", width: 18 },
  { key: "voyage", header: "Voyage", width: 10 },
  { key: "flight_number", header: "Flight", width: 10 },
  { key: "port_of_receipt", header: "Port of receipt", width: 18 },
  { key: "port_of_loading", header: "Port of loading", width: 18 },
  { key: "port_of_discharge", header: "Port of discharge", width: 18 },
  { key: "final_destination", header: "Final destination", width: 18 },
  { key: "cfs_cutoff", header: "CFS cut-off", date: true, width: 12 },
  { key: "port_cutoff", header: "Port cut-off", date: true, width: 12 },
  { key: "si_cutoff", header: "SI cut-off", date: true, width: 12 },
  { key: "etd", header: "ETD", date: true, width: 12 },
  { key: "eta", header: "ETA", date: true, width: 12 },
  { key: "transit_days", header: "Transit days", exportOnly: true, width: 8 },
  { key: "status", header: "Status", width: 10 },
  { key: "notes", header: "Notes", width: 30 },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Header names as they arrive from elsewhere, to our keys. */
const ALIASES: Record<string, Key> = {
  scheduleid: "id",
  id: "id",
  service: "services",
  services: "services",
  carrier: "carrier",
  line: "carrier",
  shippingline: "carrier",
  airline: "carrier",
  vessel: "vessel",
  vesselname: "vessel",
  voyage: "voyage",
  voyageno: "voyage",
  flight: "flight_number",
  flightno: "flight_number",
  flightnumber: "flight_number",
  portofreceipt: "port_of_receipt",
  por: "port_of_receipt",
  placeofreceipt: "port_of_receipt",
  portofloading: "port_of_loading",
  pol: "port_of_loading",
  loadport: "port_of_loading",
  portofdischarge: "port_of_discharge",
  pod: "port_of_discharge",
  dischargeport: "port_of_discharge",
  finaldestination: "final_destination",
  fnd: "final_destination",
  placeofdelivery: "final_destination",
  cfscutoff: "cfs_cutoff",
  portcutoff: "port_cutoff",
  cycutoff: "port_cutoff",
  sicutoff: "si_cutoff",
  docscutoff: "si_cutoff",
  etd: "etd",
  departure: "etd",
  eta: "eta",
  arrival: "eta",
  status: "status",
  notes: "notes",
  remarks: "notes",
  transitdays: "transit_days",
  transit: "transit_days",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date as a person or a spreadsheet wrote it, as YYYY-MM-DD — or null. */
export function toDate(v: Raw): string | null | "bad" {
  if (v === null || v === "") return null;
  if (typeof v === "number") return v > 20000 && v < 80000 ? serialToDate(v) : "bad";
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const ok = (y: number, mo: number, d: number) => {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
      ? dt.toISOString().slice(0, 10)
      : "bad";
  };
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s); // day first, as India writes it
  if (m) return ok(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-,]+(\d{4})$/i.exec(s);
  if (m && MONTHS.includes(m[2].toLowerCase())) return ok(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  return "bad";
}

export function parseServices(v: Raw): string[] {
  if (v === null) return [];
  return [...new Set(String(v).toUpperCase().split(/[\s,/+&]+/).filter((x) => ["LCL", "FCL", "AIR"].includes(x)))];
}

export interface ImportResult {
  rows: ScheduleInput[];
  errors: Array<{ line: number; message: string }>;
  /** Headers we did not recognise, so the desk knows what was ignored. */
  ignored: string[];
}

export function schedulesFromSheet(sheet: Raw[][]): ImportResult {
  const headerAt = sheet.findIndex((r) => r.some((v) => v !== null && ALIASES[norm(String(v))] !== undefined));
  if (headerAt < 0) return { rows: [], errors: [{ line: 1, message: "No recognisable header row (Port of loading, Port of discharge, ETD…)" }], ignored: [] };

  const header = sheet[headerAt].map((h) => (h === null ? null : ALIASES[norm(String(h))] ?? null));
  const ignored = sheet[headerAt].filter((h, i) => h !== null && header[i] === null).map(String);
  const out: ScheduleInput[] = [];
  const errors: ImportResult["errors"] = [];

  sheet.slice(headerAt + 1).forEach((cells, i) => {
    const line = headerAt + 2 + i;
    if (cells.every((c) => c === null || String(c).trim() === "")) return;
    const get = (k: Key): Raw => {
      const at = header.indexOf(k);
      return at < 0 ? null : (cells[at] ?? null);
    };
    const text = (k: Key) => {
      const v = get(k);
      return v === null || String(v).trim() === "" ? null : String(v).trim();
    };

    const dates: Record<string, string | null> = {};
    for (const k of ["cfs_cutoff", "port_cutoff", "si_cutoff", "etd", "eta"] as const) {
      const d = toDate(get(k));
      if (d === "bad") {
        errors.push({ line, message: `${SCHEDULE_COLUMNS.find((c) => c.key === k)!.header} "${get(k)}" is not a date` });
        return;
      }
      dates[k] = d;
    }
    const pol = text("port_of_loading");
    const pod = text("port_of_discharge");
    if (!pol || !pod || !dates.etd) {
      errors.push({ line, message: "Needs a port of loading, a port of discharge and an ETD" });
      return;
    }
    if (dates.eta && dates.eta < dates.etd) {
      errors.push({ line, message: "ETA is before ETD" });
      return;
    }
    const services = parseServices(get("services"));
    const status = (text("status") ?? "scheduled").toLowerCase();
    out.push({
      id: text("id") ?? undefined,
      mode: services.includes("AIR") || text("flight_number") ? "air" : "sea",
      services,
      carrier: text("carrier"),
      vessel: text("vessel"),
      voyage: text("voyage"),
      flight_number: text("flight_number"),
      port_of_receipt: text("port_of_receipt"),
      port_of_loading: pol,
      port_of_discharge: pod,
      final_destination: text("final_destination"),
      cfs_cutoff: dates.cfs_cutoff,
      port_cutoff: dates.port_cutoff,
      si_cutoff: dates.si_cutoff,
      etd: dates.etd,
      eta: dates.eta,
      status: (["scheduled", "closed", "departed", "cancelled"].includes(status) ? status : "scheduled") as ScheduleInput["status"],
      notes: text("notes"),
    });
  });

  return { rows: out, errors, ignored };
}

/**
 * Lane matching for the pickers: the schedule is spelled the carrier's way
 * and the job the shipper's, so the place word is compared, not the string.
 */
/** The word that names the place: "Chennai" out of "Chennai (MAA), India". */
export function placeKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\(.*?\)/g, " ").split(/[\s,/-]+/).filter(Boolean)[0] ?? "";
}

export function onLane(sch: Pick<ScheduleInput, "port_of_loading" | "port_of_discharge" | "port_of_receipt" | "final_destination">, from?: string | null, to?: string | null): boolean {
  const f = placeKey(from);
  const t = placeKey(to);
  const has = (hay: Array<string | null>, key: string) => !key || hay.some((h) => (h ?? "").toLowerCase().includes(key));
  return has([sch.port_of_loading, sch.port_of_receipt], f) && has([sch.port_of_discharge, sch.final_destination], t);
}

