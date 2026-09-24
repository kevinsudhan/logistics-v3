import type { CellValue, Column, Sheet } from "./xlsx";

/**
 * The enquiry register: every enquiry on one sheet, in the columns the desk
 * kept by hand in "ENQUIRY FILES.xlsx".
 *
 * ---------------------------------------------------------------------------
 * WHERE EACH COLUMN COMES FROM
 *
 *   Date               when it reached the desk (the mail or call), else when
 *                      it was opened — India's day
 *   Name of customer   the customer's company; Person name is the contact
 *   Mode, Term         SEA / AIR; LCL or FCL with the incoterm ("LCL FOB")
 *   Port               the far end: the origin of an import, the destination
 *                      of an export
 *   Agent, Rate        the overseas agent the job is routed through, or else
 *                      every agent asked for a rate, with what each quoted,
 *                      in the same order ("ZHL & UNI-SYSTEM", "USD 50 & USD 355")
 *   CFS charges        the CFS lines on the customer's latest quotation, in ₹
 *   Booking … T/T      the shipment, once there is one
 *   Co-load or consol  direct, co-loaded (with whom), or on a console
 *   Status             how far it has got, and on a shipment the next step
 *   Hints              the enquiry's notes, on one line and cut short: on
 *                      an enquiry from the queue they begin with the whole
 *                      first mail, which would make one row a page tall
 *
 * Pure, so it is tested without a database: src/services/enquiryRegister.ts
 * reads the records and hands them here.
 * ---------------------------------------------------------------------------
 */

export type RegisterStatus = "new" | "qualifying" | "quoted" | "accepted" | "declined" | "lost";
type Mode = "sea_lcl" | "sea_fcl" | "air" | "road" | "other" | null;

export interface RegisterInput {
  enquiry: {
    ref: string;
    received_at: string | null;
    opened_at: string;
    status: RegisterStatus;
    transport_mode: Mode;
    trade_direction: "export" | "import" | "cross_trade" | null;
    origin: string | null;
    destination: string | null;
    incoterm: string | null;
    cargo_cutoff: string | null;
    transit_days: number | null;
    notes: string | null;
  };
  customer: { name: string | null; company: string | null } | null;
  /** Every rate request sent to an agent, any order. */
  agentQuotes: Array<{
    partner_id: string | null;
    partner_label: string;
    status: string;
    amount: number | null;
    currency: string | null;
    sent_at: string;
  }>;
  /** The job is routed through this agent (Shipment details). */
  routedAgent: { id: string; name: string } | null;
  cfsInr: number | null;
  shipment: {
    id: string;
    transport_mode: Mode;
    booking_number: string | null;
    bl_number: string | null;
    forwarders_bl_no: string | null;
    vessel: string | null;
    voyage: string | null;
    flight_number: string | null;
    etd: string | null;
    eta: string | null;
    cargo_cutoff: string | null;
    port_of_loading: string | null;
    port_of_discharge: string | null;
    direct: boolean;
    bl_type: "house" | "forwarder" | null;
    console_id: string | null;
    cancelled: boolean;
    signed_off: boolean;
  } | null;
  /** The shipment's stage in words ("Booked"), worked out by the caller. */
  stageText: string | null;
  /** The first workflow step not yet done. */
  nextStep: string | null;
  consoleNo: string | null;
  /** The co-loader or consol partner named on the job. */
  coloader: string | null;
  hawbNo: string | null;
}

export const REGISTER_COLUMNS: Column[] = [
  { header: "S.NO", width: 6, kind: "center" },
  { header: "DATE", width: 11.5, kind: "date" },
  { header: "NAME OF CUSTOMER", width: 28, kind: "wrap" },
  { header: "ENQ NO", width: 14, kind: "key" },
  { header: "MODE", width: 8, kind: "center" },
  { header: "PORT", width: 18, kind: "wrap" },
  { header: "TERM", width: 11, kind: "center" },
  { header: "AGENT", width: 22, kind: "wrap" },
  { header: "RATE", width: 16, kind: "wrap" },
  { header: "CFS CHARGES (₹)", width: 13, kind: "money" },
  { header: "BOOKING NO", width: 15, kind: "text" },
  { header: "PERSON NAME", width: 16, kind: "wrap" },
  { header: "BL NO", width: 19, kind: "text" },
  { header: "VESSEL NAME", width: 24, kind: "wrap" },
  { header: "CUT-OFF", width: 11.5, kind: "date" },
  { header: "ETD", width: 11.5, kind: "date" },
  { header: "ETA", width: 11.5, kind: "date" },
  { header: "T/T DAYS", width: 9, kind: "days" },
  { header: "CO-LOAD OR CONSOL", width: 18, kind: "wrap" },
  { header: "STATUS", width: 30, kind: "wrap" },
  { header: "HINTS", width: 40, kind: "wrap" },
];

const up = (s: string | null | undefined) => (s?.trim() ? s.trim().replace(/\s+/g, " ").toUpperCase() : "");

/** "2026-09-22" for an instant, on India's calendar. */
export function istDay(iso: string): string {
  return iso.length === 10 ? iso : new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** A calendar day as a Date the sheet writes as that same day, whatever the browser's zone. */
function asDate(day: string | null | undefined): Date | null {
  if (!day) return null;
  const [y, m, d] = istDay(day).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const registerDay = (i: RegisterInput) => istDay(i.enquiry.received_at ?? i.enquiry.opened_at);

export function modeWord(mode: Mode): string {
  if (mode === "sea_lcl" || mode === "sea_fcl") return "SEA";
  return mode ? mode.toUpperCase() : "";
}

export function termOf(mode: Mode, incoterm: string | null): string {
  const load = mode === "sea_fcl" ? "FCL" : mode === "sea_lcl" ? "LCL" : "";
  return [load, up(incoterm)].filter(Boolean).join(" ");
}

/** The port at the far end — where an import comes from, where an export goes. */
export function portOf(i: RegisterInput): string {
  const e = i.enquiry;
  const from = i.shipment?.port_of_loading || e.origin;
  const to = i.shipment?.port_of_discharge || e.destination;
  if (e.trade_direction === "import") return up(from);
  if (e.trade_direction === "export") return up(to);
  return from && to ? `${up(from)} → ${up(to)}` : up(to || from);
}

const money = (currency: string | null, amount: number) =>
  `${currency ? `${currency.toUpperCase()} ` : ""}${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** The agent and the rate, as the register pairs them. */
export function agentAndRate(i: RegisterInput): { agent: string; rate: string } {
  // The latest request per agent: asking again replaces the earlier ask.
  const latest = new Map<string, RegisterInput["agentQuotes"][number]>();
  for (const q of [...i.agentQuotes].sort((a, b) => (a.sent_at < b.sent_at ? -1 : 1))) {
    latest.set(q.partner_id ?? q.partner_label.toLowerCase(), q);
  }
  const quotes = [...latest.values()];

  if (i.routedAgent) {
    const q = latest.get(i.routedAgent.id);
    return { agent: up(i.routedAgent.name), rate: q?.amount != null ? money(q.currency, Number(q.amount)) : "" };
  }
  const agent = quotes.map((q) => up(q.partner_label)).join(" & ");
  const rate = quotes.some((q) => q.amount != null)
    ? quotes.map((q) => (q.amount != null ? money(q.currency, Number(q.amount)) : "—")).join(" & ")
    : "";
  return { agent, rate };
}

export function registerStatus(i: RegisterInput): string {
  const s = i.shipment;
  if (s) {
    if (s.cancelled) return "Cancelled";
    if (s.signed_off) return "Completed";
    return [i.stageText, i.nextStep ? `next: ${i.nextStep}` : null].filter(Boolean).join(" — ");
  }
  const asked = i.agentQuotes.length > 0;
  const heard = i.agentQuotes.some((q) => q.amount != null || q.status === "replied" || q.status === "quoted");
  switch (i.enquiry.status) {
    case "new":
    case "qualifying":
      return heard ? "Agent rates received" : asked ? "Waiting for agent rates" : i.enquiry.status === "new" ? "New" : "Qualifying";
    case "quoted":
      return "Quoted to customer";
    case "accepted":
      return "Accepted — to be booked";
    case "declined":
      return "Declined by customer";
    case "lost":
      return "Lost";
  }
}

function coloadOf(i: RegisterInput): string {
  const s = i.shipment;
  if (!s) return i.coloader ? `CO-LOAD ${up(i.coloader)}` : "";
  if (s.direct) return "DIRECT";
  if (i.coloader || s.bl_type === "forwarder") return ["CO-LOAD", up(i.coloader)].filter(Boolean).join(" ");
  if (s.console_id) return ["CONSOL", up(i.consoleNo)].filter(Boolean).join(" ");
  return "";
}

export const HINT_LENGTH = 160;

/** The notes as a hint: one line, the start of it. */
export function hintOf(notes: string | null): string {
  const flat = (notes ?? "").replace(/_{3,}/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > HINT_LENGTH ? `${flat.slice(0, HINT_LENGTH - 1).trimEnd()}…` : flat;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${istDay(b)}T00:00:00Z`) - Date.parse(`${istDay(a)}T00:00:00Z`)) / 86_400_000);
}

/** One line of the register, in REGISTER_COLUMNS order. */
export function registerRow(n: number, i: RegisterInput): CellValue[] {
  const e = i.enquiry;
  const s = i.shipment;
  const mode = s?.transport_mode ?? e.transport_mode;
  const company = i.customer?.company?.trim();
  const { agent, rate } = agentAndRate(i);
  const air = mode === "air";
  const transit = s?.etd && s?.eta ? daysBetween(s.etd, s.eta) : e.transit_days;

  return [
    n,
    asDate(registerDay(i)),
    up(company || i.customer?.name),
    e.ref,
    modeWord(mode),
    portOf(i),
    termOf(mode, e.incoterm),
    agent,
    rate,
    i.cfsInr && i.cfsInr > 0 ? Math.round(i.cfsInr * 100) / 100 : null,
    s ? up(s.booking_number) || s.id : "",
    company ? up(i.customer?.name) : "",
    s ? (air ? up(i.hawbNo || s.bl_number) : up(s.bl_number || s.forwarders_bl_no)) : "",
    s ? (air ? up(s.flight_number) : up([s.vessel, s.voyage].filter(Boolean).join(" "))) : "",
    asDate(s?.cargo_cutoff ?? e.cargo_cutoff),
    asDate(s?.etd),
    asDate(s?.eta),
    transit != null && transit >= 0 ? transit : null,
    coloadOf(i),
    registerStatus(i),
    hintOf(e.notes),
  ];
}

// Spelled out here rather than by the locale, which writes "Sept" on some systems and "Sep" on others.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** The period in words: "All enquiries", "1 Sep 2026 – 30 Sep 2026", "From 1 Sep 2026". */
export function periodText(from: string | null, to: string | null): string {
  if (from && to) return `${longDay(from)} – ${longDay(to)}`;
  if (from) return `From ${longDay(from)}`;
  if (to) return `Up to ${longDay(to)}`;
  return "All enquiries";
}

/** The periods offered for the download. The financial year runs April to March. */
export type Preset = "all" | "this_month" | "last_month" | "fy" | "custom";

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The first and last day of a preset, on India's calendar. */
export function presetRange(p: Exclude<Preset, "custom">, today: string): { from: string | null; to: string | null } {
  const [y, m] = today.split("-").map(Number);
  switch (p) {
    case "all":
      return { from: null, to: null };
    case "this_month":
      return { from: `${y}-${pad(m)}-01`, to: today };
    case "last_month": {
      const [ly, lm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(lastDay(ly, lm))}` };
    }
    case "fy": {
      const start = m >= 4 ? y : y - 1;
      return { from: `${start}-04-01`, to: today };
    }
  }
}

/** Within the period, by the register's date. Either end may be open. */
export const inPeriod = (i: RegisterInput, from: string | null, to: string | null) => {
  const d = registerDay(i);
  return (!from || d >= from) && (!to || d <= to);
};

/** The whole sheet, oldest first as the register was kept. */
export function registerSheet(
  inputs: RegisterInput[],
  meta: { company: string; from: string | null; to: string | null; generatedAt: Date; generatedBy: string | null }
): Sheet {
  const sorted = [...inputs].sort((a, b) => registerDay(a).localeCompare(registerDay(b)) || a.enquiry.ref.localeCompare(b.enquiry.ref));
  const g = meta.generatedAt;
  const when = `${longDay(`${g.getFullYear()}-${g.getMonth() + 1}-${g.getDate()}`)}, ${String(g.getHours()).padStart(2, "0")}:${String(g.getMinutes()).padStart(2, "0")}`;
  return {
    name: "Enquiry register",
    columns: REGISTER_COLUMNS,
    rows: sorted.map((i, k) => registerRow(k + 1, i)),
    report: {
      title: "Enquiry register",
      lines: [
        meta.company,
        `${periodText(meta.from, meta.to)} · ${sorted.length} ${sorted.length === 1 ? "enquiry" : "enquiries"}`,
        `Generated ${when}${meta.generatedBy ? ` by ${meta.generatedBy}` : ""}`,
      ],
      freezeColumns: 4,
      footer: `${meta.company} — Enquiry register`,
    },
  };
}
