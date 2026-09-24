import { MODE_LABEL } from "./worklist";
import type { CellValue, Column, Sheet } from "./xlsx";

/**
 * Profit and loss, per job and over time.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS
 *
 *   Revenue  issued tax invoices and debit notes, less credit notes — to the
 *            customer or to an overseas agent alike.
 *   Cost     carrier, vendor and agent bills, less agent credit notes. A draft
 *            bill counts (a cost known before the vendor's invoice arrives, as
 *            the transport desk records it) and is marked provisional.
 *
 * Both before GST. GST collected is owed to the government and GST paid is
 * claimed back; neither is anybody's profit. A reimbursement line (duty paid
 * on the customer's behalf) is revenue that has a matching cost, and is shown
 * separately so a large one does not look like a good month.
 *
 * CONSOLE DOCUMENTS
 *
 * A master bill's freight is billed to the console, not to any one job. It is
 * shared across the console's jobs by volume (weight where a volume is
 * missing, evenly where both are), and each share is marked as one.
 *
 * WHICH PERIOD A FIGURE BELONGS TO
 *
 *   By job       the whole job lands in the period of its job date — the ETD,
 *                else the day it was booked. How operations reads a month.
 *   By document  each invoice and bill lands in the period of its own date.
 *                How the books read a month.
 *
 * Periods follow India's financial year: quarters run Apr–Jun, Jul–Sep,
 * Oct–Dec, Jan–Mar, and a year is FY 2026-27. Weeks start on Monday.
 *
 * Pure: src/services/jobPnl.ts reads the records and hands them here.
 * ---------------------------------------------------------------------------
 */

export type Mode = "sea_lcl" | "sea_fcl" | "air" | "road" | "other" | null;
export type Basis = "job" | "document";
export type Granularity = "day" | "week" | "month" | "quarter" | "year";

export interface PnlJob {
  id: string;
  enquiryRef: string | null;
  customer: string;
  mode: Mode;
  direction: "export" | "import" | "cross_trade" | null;
  origin: string | null;
  destination: string | null;
  /** YYYY-MM-DD, India's day. */
  jobDate: string;
  stage: string;
  signedOffAt: string | null;
  handledBy: string | null;
  consoleId: string | null;
  consoleNo: string | null;
  volumeCbm: number | null;
  weightKg: number | null;
  /** From the accepted quotation, when there is one. */
  quotedRevenue: number | null;
  quotedCost: number | null;
  /** Still to collect and to pay, GST included — what the ledger is owed. */
  receivable: number;
  payable: number;
  draftInvoices: number;
  disputedBills: number;
}

export interface PnlDoc {
  id: string;
  side: "revenue" | "cost";
  kind: string;
  number: string | null;
  /** YYYY-MM-DD */
  date: string;
  status: string;
  shipmentId: string | null;
  consoleId: string | null;
  party: string | null;
  /** Multiplies a line amount to rupees: 1 for invoice lines (already INR), the bill's rate for a bill. */
  fx: number;
  /** The document's value before tax, in rupees — used when it has no lines. */
  taxableInr: number;
  lines: Array<{ description: string; amount: number; reimbursement: boolean }>;
}

export interface PnlEntry {
  jobId: string;
  side: "revenue" | "cost";
  /** Rupees before GST; negative for a credit note. */
  amount: number;
  date: string;
  docId: string;
  docNo: string | null;
  docKind: string;
  head: string;
  party: string | null;
  reimbursement: boolean;
  /** A draft bill: the cost is known, the vendor's invoice has not arrived. */
  provisional: boolean;
  /** The job's share of a console document, when it came from one. */
  share: number | null;
}

const REVENUE_KINDS = new Set(["tax_invoice", "debit_note", "credit_note"]);
const REVENUE_STATUS = new Set(["issued", "part_paid", "paid"]);
const NEGATIVE = new Set(["credit_note", "agent_credit_note"]);

export const DOC_KIND_LABEL: Record<string, string> = {
  tax_invoice: "Invoice",
  debit_note: "Debit note",
  credit_note: "Credit note",
  carrier_invoice: "Carrier invoice",
  vendor_invoice: "Vendor invoice",
  agent_debit_note: "Agent debit note",
  agent_credit_note: "Agent credit note",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Which documents count: issued revenue, and every cost not cancelled. */
export function counts(d: PnlDoc): boolean {
  if (d.side === "revenue") return REVENUE_KINDS.has(d.kind) && REVENUE_STATUS.has(d.status);
  return d.status !== "cancelled";
}

/**
 * How a console's documents are shared across its jobs.
 *
 * By volume when every job has one, else by weight when every job has one,
 * else evenly — a share worked out from a mix of the two would compare cubic
 * metres with kilos.
 */
export function consoleShares(jobs: PnlJob[]): Map<string, Array<{ jobId: string; share: number }>> {
  const by = new Map<string, PnlJob[]>();
  for (const j of jobs) if (j.consoleId) by.set(j.consoleId, [...(by.get(j.consoleId) ?? []), j]);
  const out = new Map<string, Array<{ jobId: string; share: number }>>();
  for (const [id, members] of by) {
    const measure = members.every((m) => (m.volumeCbm ?? 0) > 0)
      ? (m: PnlJob) => m.volumeCbm ?? 0
      : members.every((m) => (m.weightKg ?? 0) > 0)
        ? (m: PnlJob) => m.weightKg ?? 0
        : () => 1;
    const total = members.reduce((n, m) => n + measure(m), 0);
    out.set(id, members.map((m) => ({ jobId: m.id, share: measure(m) / total })));
  }
  return out;
}

/** Every document broken into the lines that make up a job's revenue and cost. */
export function buildEntries(jobs: PnlJob[], docs: PnlDoc[]): PnlEntry[] {
  const shares = consoleShares(jobs);
  const known = new Set(jobs.map((j) => j.id));
  const out: PnlEntry[] = [];
  for (const d of docs) {
    if (!counts(d)) continue;
    const sign = NEGATIVE.has(d.kind) ? -1 : 1;
    const targets = d.shipmentId
      ? known.has(d.shipmentId)
        ? [{ jobId: d.shipmentId, share: null as number | null }]
        : []
      : d.consoleId
        ? (shares.get(d.consoleId) ?? []).map((s) => ({ jobId: s.jobId, share: s.share as number | null }))
        : [];
    const lines = d.lines.length
      ? d.lines.map((l) => ({ head: l.description, amount: l.amount * d.fx, reimbursement: l.reimbursement }))
      : [{ head: DOC_KIND_LABEL[d.kind] ?? d.kind, amount: d.taxableInr, reimbursement: false }];
    for (const t of targets) {
      for (const l of lines) {
        out.push({
          jobId: t.jobId,
          side: d.side,
          amount: round2(sign * l.amount * (t.share ?? 1)),
          date: d.date,
          docId: d.id,
          docNo: d.number,
          docKind: d.kind,
          head: l.head.trim() || (DOC_KIND_LABEL[d.kind] ?? d.kind),
          party: d.party,
          reimbursement: l.reimbursement,
          provisional: d.side === "cost" && d.status === "draft",
          share: t.share,
        });
      }
    }
  }
  return out;
}

export interface Totals {
  revenue: number;
  cost: number;
  gp: number;
  /** Profit over revenue; null when there is no revenue to divide by. */
  margin: number | null;
  reimbursements: number;
  provisionalCost: number;
}

export function totalsOf(entries: PnlEntry[]): Totals {
  let revenue = 0,
    cost = 0,
    reimbursements = 0,
    provisionalCost = 0;
  for (const e of entries) {
    if (e.side === "revenue") {
      revenue += e.amount;
      if (e.reimbursement) reimbursements += e.amount;
    } else {
      cost += e.amount;
      if (e.provisional) provisionalCost += e.amount;
    }
  }
  const gp = revenue - cost;
  return {
    revenue: round2(revenue),
    cost: round2(cost),
    gp: round2(gp),
    margin: Math.abs(revenue) > 0.005 ? gp / revenue : null,
    reimbursements: round2(reimbursements),
    provisionalCost: round2(provisionalCost),
  };
}

export type ClosingState = "closed" | "ready" | "open" | "cancelled";

export const CLOSING_LABEL: Record<ClosingState, string> = {
  closed: "Closed",
  ready: "Ready to close",
  open: "Open",
  cancelled: "Cancelled",
};

/**
 * Whether a job can be closed, and if not, what stands in the way.
 *
 * The money side of the sign-off checklist (070): delivered, invoiced, costs
 * in, nothing left in draft or in dispute. Collection is not on the list —
 * a job is closed operationally before the customer pays — so what is still
 * to collect and to pay is shown beside it, not held against it.
 */
export function closingState(job: PnlJob, entries: PnlEntry[]): { state: ClosingState; reasons: string[] } {
  if (job.signedOffAt) return { state: "closed", reasons: [] };
  if (job.stage === "cancelled") return { state: "cancelled", reasons: [] };
  const reasons: string[] = [];
  const mine = entries.filter((e) => e.jobId === job.id);
  const provisional = new Set(mine.filter((e) => e.provisional).map((e) => e.docId)).size;
  if (job.stage !== "delivered") reasons.push("Not delivered yet");
  if (!mine.some((e) => e.side === "revenue")) reasons.push("No invoice issued");
  if (!mine.some((e) => e.side === "cost")) reasons.push("No costs recorded");
  if (job.draftInvoices) reasons.push(`${job.draftInvoices} draft invoice${job.draftInvoices === 1 ? "" : "s"}`);
  if (provisional) reasons.push(`${provisional} bill${provisional === 1 ? "" : "s"} awaiting the vendor's invoice`);
  if (job.disputedBills) reasons.push(`${job.disputedBills} disputed bill${job.disputedBills === 1 ? "" : "s"}`);
  return { state: reasons.length ? "open" : "ready", reasons };
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const addDays = (day: string, n: number) => {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};
/** "24 Sep 2026" */
export const dayLabel = (day: string) => {
  const d = utc(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
/** The financial year a day falls in, by its starting calendar year: 2026 for Apr 2026–Mar 2027. */
export const fyOf = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  return m >= 4 ? y : y - 1;
};
export const fyLabel = (start: number) => `FY ${start}-${pad((start + 1) % 100)}`;

export interface Period {
  key: string;
  label: string;
  /** First and last day, inclusive. */
  start: string;
  end: string;
}

export function periodOf(day: string, g: Granularity): Period {
  const [y, m] = day.split("-").map(Number);
  switch (g) {
    case "day":
      return { key: day, label: dayLabel(day), start: day, end: day };
    case "week": {
      const dow = (utc(day).getUTCDay() + 6) % 7; // Monday = 0
      const start = addDays(day, -dow);
      const end = addDays(start, 6);
      const s = utc(start),
        e = utc(end);
      const label =
        s.getUTCMonth() === e.getUTCMonth()
          ? `${s.getUTCDate()}–${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`
          : `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
      return { key: start, label, start, end };
    }
    case "month": {
      const start = `${y}-${pad(m)}-01`;
      const end = ymd(new Date(Date.UTC(y, m, 0)));
      return { key: `${y}-${pad(m)}`, label: `${MONTHS[m - 1]} ${y}`, start, end };
    }
    case "quarter": {
      const fy = fyOf(day);
      // Q1 Apr–Jun … Q4 Jan–Mar.
      const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
      const firstMonth = [4, 7, 10, 1][q - 1];
      const firstYear = q === 4 ? fy + 1 : fy;
      const start = `${firstYear}-${pad(firstMonth)}-01`;
      const end = ymd(new Date(Date.UTC(firstYear, firstMonth + 2, 0)));
      return {
        key: `${fy}-Q${q}`,
        label: `Q${q} ${fyLabel(fy)} (${MONTHS[firstMonth - 1]}–${MONTHS[firstMonth + 1]})`,
        start,
        end,
      };
    }
    case "year": {
      const fy = fyOf(day);
      return { key: `FY${fy}`, label: fyLabel(fy), start: `${fy}-04-01`, end: `${fy + 1}-03-31` };
    }
  }
}

/** Every period from the one holding `from` to the one holding `to`, none skipped. */
export function periodsBetween(from: string, to: string, g: Granularity): Period[] {
  const out: Period[] = [];
  let p = periodOf(from, g);
  const last = periodOf(to, g).key;
  for (let guard = 0; guard < 4000; guard++) {
    out.push(p);
    if (p.key === last) break;
    p = periodOf(addDays(p.end, 1), g);
  }
  return out;
}

export const inRange = (day: string, from: string | null, to: string | null) => (!from || day >= from) && (!to || day <= to);

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface JobRow extends Totals {
  job: PnlJob;
  entries: PnlEntry[];
  closing: { state: ClosingState; reasons: string[] };
  quotedGp: number | null;
  /** Actual profit against quoted; null without a quotation. */
  variance: number | null;
}

/**
 * The jobs in a period, each with its figures.
 *
 * By job: jobs whose job date is in range, with everything they have. By
 * document: jobs with a document dated in range, with only those documents —
 * the same cut the books make.
 */
export function jobRows(jobs: PnlJob[], entries: PnlEntry[], opts: { basis: Basis; from: string | null; to: string | null }): JobRow[] {
  const byJob = new Map<string, PnlEntry[]>();
  for (const e of entries) byJob.set(e.jobId, [...(byJob.get(e.jobId) ?? []), e]);
  const out: JobRow[] = [];
  for (const job of jobs) {
    const all = byJob.get(job.id) ?? [];
    let mine: PnlEntry[];
    if (opts.basis === "job") {
      if (!inRange(job.jobDate, opts.from, opts.to)) continue;
      mine = all;
    } else {
      mine = all.filter((e) => inRange(e.date, opts.from, opts.to));
      if (!mine.length) continue;
    }
    const t = totalsOf(mine);
    const quotedGp = job.quotedRevenue != null && job.quotedCost != null ? round2(job.quotedRevenue - job.quotedCost) : null;
    out.push({
      ...t,
      job,
      entries: mine,
      closing: closingState(job, all),
      quotedGp,
      variance: quotedGp != null && (t.revenue || t.cost) ? round2(t.gp - quotedGp) : null,
    });
  }
  return out;
}

export interface PeriodRow extends Totals {
  period: Period;
  jobs: number;
}

/**
 * Profit and loss by period, every period in the range shown — a quiet week
 * is a row of zeros, not a gap the eye closes over.
 */
export function periodRows(rows: JobRow[], opts: { basis: Basis; granularity: Granularity; from: string | null; to: string | null }): PeriodRow[] {
  const dated: Array<{ day: string; entry: PnlEntry | null; jobId: string }> = [];
  for (const r of rows) {
    if (opts.basis === "job") {
      dated.push({ day: r.job.jobDate, entry: null, jobId: r.job.id });
      for (const e of r.entries) dated.push({ day: r.job.jobDate, entry: e, jobId: r.job.id });
    } else {
      for (const e of r.entries) dated.push({ day: e.date, entry: e, jobId: r.job.id });
    }
  }
  if (!dated.length) return [];
  const days = dated.map((d) => d.day).sort();
  // The range asked for; an open end stops at the data.
  const start = opts.from ?? days[0];
  const end = opts.to ?? days[days.length - 1];
  if (start > end) return [];
  const periods = periodsBetween(start, end, opts.granularity);
  const byKey = new Map(periods.map((p) => [p.key, { entries: [] as PnlEntry[], jobs: new Set<string>() }]));
  for (const d of dated) {
    const k = periodOf(d.day, opts.granularity).key;
    const slot = byKey.get(k);
    if (!slot) continue;
    if (d.entry) slot.entries.push(d.entry);
    slot.jobs.add(d.jobId);
  }
  return periods.map((p) => {
    const slot = byKey.get(p.key)!;
    return { ...totalsOf(slot.entries), period: p, jobs: slot.jobs.size };
  });
}

export type Dimension = "customer" | "mode" | "direction" | "handler" | "charge" | "vendor";

export const DIMENSION_LABEL: Record<Dimension, string> = {
  customer: "Customer",
  mode: "Mode",
  direction: "Direction",
  handler: "Handled by",
  charge: "Revenue by charge",
  vendor: "Cost by vendor",
};

export interface BreakdownRow extends Totals {
  label: string;
  jobs: number;
}

const DIRECTION_LABEL: Record<string, string> = { export: "Export", import: "Import", cross_trade: "Cross trade" };

/** The period's figures grouped one way, biggest first. */
export function breakdown(rows: JobRow[], dim: Dimension): BreakdownRow[] {
  const groups = new Map<string, { entries: PnlEntry[]; jobs: Set<string> }>();
  const add = (label: string, entries: PnlEntry[], jobId: string) => {
    const g = groups.get(label) ?? { entries: [], jobs: new Set<string>() };
    g.entries.push(...entries);
    g.jobs.add(jobId);
    groups.set(label, g);
  };
  for (const r of rows) {
    const j = r.job;
    if (dim === "charge" || dim === "vendor") {
      const side = dim === "charge" ? "revenue" : "cost";
      for (const e of r.entries.filter((x) => x.side === side)) {
        add(dim === "charge" ? normaliseHead(e.head) : e.party || "Not named", [e], j.id);
      }
      continue;
    }
    const label =
      dim === "customer"
        ? j.customer
        : dim === "mode"
          ? MODE_LABEL[j.mode ?? "none"] ?? "Not set"
          : dim === "direction"
            ? DIRECTION_LABEL[j.direction ?? ""] ?? "Not set"
            : j.handledBy || "Unassigned";
    add(label, r.entries, j.id);
  }
  return [...groups.entries()]
    .map(([label, g]) => ({ ...totalsOf(g.entries), label, jobs: g.jobs.size }))
    .sort((a, b) =>
      dim === "charge" ? b.revenue - a.revenue : dim === "vendor" ? b.cost - a.cost : b.gp - a.gp || b.revenue - a.revenue
    );
}

/** "Ocean Freight", "ocean freight " and "OCEAN FREIGHT" are one charge. */
function normaliseHead(h: string): string {
  const t = h.trim().replace(/\s+/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Other";
}

export interface Summary extends Totals {
  jobs: number;
  closed: number;
  ready: number;
  open: number;
  avgGp: number | null;
  receivable: number;
  payable: number;
}

export function summarise(rows: JobRow[]): Summary {
  const t = totalsOf(rows.flatMap((r) => r.entries));
  const live = rows.filter((r) => r.closing.state !== "cancelled");
  return {
    ...t,
    jobs: rows.length,
    closed: rows.filter((r) => r.closing.state === "closed").length,
    ready: rows.filter((r) => r.closing.state === "ready").length,
    open: rows.filter((r) => r.closing.state === "open").length,
    avgGp: live.length ? round2(t.gp / live.length) : null,
    receivable: round2(rows.reduce((n, r) => n + r.job.receivable, 0)),
    payable: round2(rows.reduce((n, r) => n + r.job.payable, 0)),
  };
}

// ---------------------------------------------------------------------------
// The workbook
// ---------------------------------------------------------------------------

const GRAN_LABEL: Record<Granularity, string> = { day: "Daily", week: "Weekly", month: "Monthly", quarter: "Quarterly", year: "Yearly" };
const pct = (m: number | null) => (m == null ? null : Math.round(m * 1000) / 10);
const asDate = (day: string | null) => {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Summary, jobs, every period granularity, breakdowns and the lines behind them. */
export function pnlWorkbook(
  rows: JobRow[],
  meta: { company: string; periodText: string; basis: Basis; from: string | null; to: string | null; generatedAt: Date; generatedBy: string | null }
): Sheet[] {
  const g = meta.generatedAt;
  const when = `${dayLabel(`${g.getFullYear()}-${pad(g.getMonth() + 1)}-${pad(g.getDate())}`)}, ${pad(g.getHours())}:${pad(g.getMinutes())}`;
  const lines = [
    meta.company,
    `${meta.periodText} · ${meta.basis === "job" ? "by job date" : "by invoice and bill dates"} · amounts in ₹ before GST`,
    `Generated ${when}${meta.generatedBy ? ` by ${meta.generatedBy}` : ""}`,
  ];
  const report = (title: string, freeze = 1) => ({ title, lines, freezeColumns: freeze, footer: `${meta.company} — ${title}` });
  const s = summarise(rows);

  const money: Column = { header: "", width: 15, kind: "money" };
  const totalsCols = (): Column[] => [
    { ...money, header: "REVENUE" },
    { ...money, header: "COST" },
    { ...money, header: "GROSS PROFIT" },
    { header: "MARGIN %", width: 10, kind: "number" },
  ];
  const totalsCells = (t: Totals): CellValue[] => [t.revenue, t.cost, t.gp, pct(t.margin)];

  const summary: Sheet = {
    name: "Summary",
    columns: [
      { header: "MEASURE", width: 34, kind: "text" },
      { header: "VALUE", width: 18, kind: "money" },
    ],
    rows: [
      ["Revenue", s.revenue],
      ["  of which reimbursements", s.reimbursements],
      ["Cost", s.cost],
      ["  of which provisional (draft bills)", s.provisionalCost],
      ["Gross profit", s.gp],
      ["Margin %", pct(s.margin)],
      ["Jobs", s.jobs],
      ["  closed", s.closed],
      ["  ready to close", s.ready],
      ["  open", s.open],
      ["Average profit per job", s.avgGp],
      ["Still to collect (with GST)", s.receivable],
      ["Still to pay (with GST)", s.payable],
    ],
    report: report("Job P&L — summary", 0),
  };

  const jobsSheet: Sheet = {
    name: "Jobs",
    columns: [
      { header: "JOB", width: 15, kind: "key" },
      { header: "ENQUIRY", width: 14, kind: "center" },
      { header: "JOB DATE", width: 11.5, kind: "date" },
      { header: "CUSTOMER", width: 26, kind: "wrap" },
      { header: "MODE", width: 9, kind: "center" },
      { header: "ROUTE", width: 30, kind: "wrap" },
      { header: "HANDLED BY", width: 16, kind: "wrap" },
      ...totalsCols(),
      { ...money, header: "QUOTED PROFIT" },
      { ...money, header: "VS QUOTED" },
      { ...money, header: "TO COLLECT" },
      { ...money, header: "TO PAY" },
      { header: "STATUS", width: 15, kind: "center" },
      { header: "TO CLOSE", width: 36, kind: "wrap" },
    ],
    rows: [...rows]
      .sort((a, b) => (a.job.jobDate < b.job.jobDate ? -1 : 1))
      .map((r) => [
        r.job.id,
        r.job.enquiryRef,
        asDate(r.job.jobDate),
        r.job.customer,
        MODE_LABEL[r.job.mode ?? "none"] ?? "",
        [r.job.origin, r.job.destination].filter(Boolean).join(" → "),
        r.job.handledBy,
        ...totalsCells(r),
        r.quotedGp,
        r.variance,
        r.job.receivable || null,
        r.job.payable || null,
        CLOSING_LABEL[r.closing.state],
        r.closing.reasons.join("; "),
      ]),
    report: report("Job P&L — per job"),
  };

  const range = { from: meta.from, to: meta.to };
  const periodSheets: Sheet[] = (["week", "month", "quarter", "year"] as Granularity[]).map((gran) => ({
    name: GRAN_LABEL[gran],
    columns: [{ header: "PERIOD", width: gran === "quarter" ? 30 : 22, kind: "text" }, { header: "JOBS", width: 8, kind: "number" }, ...totalsCols()],
    rows: periodRows(rows, { basis: meta.basis, granularity: gran, ...range }).map((p) => [p.period.label, p.jobs, ...totalsCells(p)]),
    report: report(`Job P&L — ${GRAN_LABEL[gran].toLowerCase()}`),
  }));

  const dims: Dimension[] = ["customer", "mode", "direction", "handler", "charge", "vendor"];
  const breakdownSheets: Sheet[] = dims.map((d) => ({
    name: `By ${d === "handler" ? "handler" : d}`,
    columns: [{ header: DIMENSION_LABEL[d].toUpperCase(), width: 32, kind: "wrap" }, { header: "JOBS", width: 8, kind: "number" }, ...totalsCols()],
    rows: breakdown(rows, d).map((b) => [b.label, b.jobs, ...totalsCells(b)]),
    report: report(`Job P&L — ${DIMENSION_LABEL[d].toLowerCase()}`),
  }));

  const entriesSheet: Sheet = {
    name: "Lines",
    columns: [
      { header: "JOB", width: 15, kind: "key" },
      { header: "SIDE", width: 10, kind: "center" },
      { header: "DOCUMENT", width: 18, kind: "text" },
      { header: "TYPE", width: 17, kind: "text" },
      { header: "DATE", width: 11.5, kind: "date" },
      { header: "PARTY", width: 26, kind: "wrap" },
      { header: "CHARGE", width: 34, kind: "wrap" },
      { ...money, header: "AMOUNT" },
      { header: "NOTE", width: 26, kind: "wrap" },
    ],
    rows: rows.flatMap((r) =>
      r.entries.map((e) => [
        r.job.id,
        e.side === "revenue" ? "Revenue" : "Cost",
        e.docNo,
        DOC_KIND_LABEL[e.docKind] ?? e.docKind,
        asDate(e.date),
        e.party,
        e.head,
        e.amount,
        [e.reimbursement ? "Reimbursement" : null, e.provisional ? "Provisional" : null, e.share != null ? `Console share ${Math.round(e.share * 1000) / 10}%` : null]
          .filter(Boolean)
          .join(" · "),
      ])
    ),
    report: report("Job P&L — lines"),
  };

  return [summary, jobsSheet, ...periodSheets, ...breakdownSheets, entriesSheet];
}
