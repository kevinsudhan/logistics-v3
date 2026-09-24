import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowDown, ArrowUp, Check, ChevronDown, Download, RefreshCw, Search, TrendingUp } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import PnlChart, { inr } from "../components/PnlChart";
import { PageSkeleton } from "../components/Loading";
import { Segmented } from "../components/formControls";
import { useAuth } from "../lib/auth";
import { COMPANY } from "../lib/company";
import { failureText } from "../lib/errorText";
import { todayIST } from "../lib/progress";
import { MODE_LABEL } from "../lib/worklist";
import { downloadWorkbook } from "../lib/xlsx";
import {
  CLOSING_LABEL,
  DIMENSION_LABEL,
  DOC_KIND_LABEL,
  breakdown,
  buildEntries,
  dayLabel,
  jobRows,
  periodOf,
  periodRows,
  pnlWorkbook,
  summarise,
  type Basis,
  type ClosingState,
  type Dimension,
  type Granularity,
  type JobRow,
  type PeriodRow,
} from "../lib/jobPnl";
import { loadPnl, type PnlData } from "../services/jobPnl";

/**
 * Job closing: what every job made, and every week, month, quarter and year.
 *
 * ---------------------------------------------------------------------------
 * ONE SET OF FIGURES, THREE WAYS IN
 *
 *   Per job     each job's revenue, cost, profit and margin, against what was
 *               quoted, with what still stands between it and closing — and
 *               the invoices and bills behind every figure a click away.
 *   By period   the same money by day, week, month, quarter or financial
 *               year, charted and tabled, every period in the range shown.
 *   Breakdown   by customer, mode, direction, who handled it, which charges
 *               earned it and which vendors cost it.
 *
 * All of it before GST, worked out in src/lib/jobPnl.ts, and all of it
 * downloadable as one workbook. Read-only: every figure is a sum of documents
 * that already exist, and a place to type over them would be a second place
 * for the truth to live.
 * ---------------------------------------------------------------------------
 */

type Preset = "this_month" | "last_month" | "this_quarter" | "this_fy" | "last_fy" | "all" | "custom";
type View = "jobs" | "periods" | "breakdown";
type SortKey = "date" | "revenue" | "cost" | "gp" | "margin" | "variance";

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "this_fy", label: "This financial year" },
  { value: "last_fy", label: "Last financial year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Choose dates" },
];

const GRANULARITIES: Array<{ value: Granularity; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "quarter", label: "Quarterly" },
  { value: "year", label: "Yearly" },
];

const PERIOD_WORD: Record<Granularity, string> = { day: "Day", week: "Week", month: "Month", quarter: "Quarter", year: "Financial year" };

const DIMENSIONS: Dimension[] = ["customer", "mode", "direction", "handler", "charge", "vendor"];

const STATE_TONE: Record<ClosingState, "success" | "accent" | "warning" | "neutral"> = {
  closed: "success",
  ready: "accent",
  open: "warning",
  cancelled: "neutral",
};

const dayBefore = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

function presetRange(p: Preset, today: string): { from: string | null; to: string | null } {
  switch (p) {
    case "this_month":
      return { from: periodOf(today, "month").start, to: today };
    case "last_month": {
      const m = periodOf(dayBefore(periodOf(today, "month").start), "month");
      return { from: m.start, to: m.end };
    }
    case "this_quarter":
      return { from: periodOf(today, "quarter").start, to: today };
    case "this_fy":
      return { from: periodOf(today, "year").start, to: today };
    case "last_fy": {
      const y = periodOf(dayBefore(periodOf(today, "year").start), "year");
      return { from: y.start, to: y.end };
    }
    default:
      return { from: null, to: null };
  }
}

const pct = (m: number | null) => (m == null ? "—" : `${(m * 100).toFixed(1)}%`);
const signed = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${inr(n)}`);
const tone = (n: number | null) => (n == null || Math.abs(n) < 0.5 ? "text-text-secondary" : n < 0 ? "text-text-danger" : "text-text-success");

/** The x-axis label: short enough to sit under a column. */
function shortLabel(g: Granularity) {
  return (r: PeriodRow) => {
    const p = r.period;
    if (g === "day") return dayLabel(p.start).replace(/ \d{4}$/, "");
    if (g === "week") return dayLabel(p.start).replace(/ \d{4}$/, "");
    if (g === "month") return p.label.replace(/ (\d{2})(\d{2})$/, " ’$2");
    if (g === "quarter") return p.label.split(" (")[0].replace("FY ", "");
    return p.label;
  };
}

export default function JobClosing() {
  const { session } = useAuth();
  const [data, setData] = useState<PnlData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [preset, setPreset] = useState<Preset>("this_fy");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [basis, setBasis] = useState<Basis>("job");
  const [mode, setMode] = useState("");
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState<"" | ClosingState>("");
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("jobs");
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [dimension, setDimension] = useState<Dimension>("customer");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadPnl());
    } catch (e) {
      setError(failureText(e, "Could not load the jobs.").message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const range = preset === "custom" ? { from: from || null, to: to || null } : presetRange(preset, todayIST());
  const periodText = range.from || range.to ? `${range.from ? dayLabel(range.from) : "The start"} – ${range.to ? dayLabel(range.to) : "today"}` : "All time";

  const entries = useMemo(() => (data ? buildEntries(data.jobs, data.docs) : []), [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const jobs = data.jobs.filter(
      (j) =>
        (!mode || j.mode === mode) &&
        (!direction || j.direction === direction) &&
        (!needle ||
          [j.id, j.enquiryRef, j.customer, j.origin, j.destination, j.handledBy, j.consoleNo].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)))
    );
    return jobRows(jobs, entries, { basis, ...range }).filter((r) => !status || r.closing.state === status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, entries, basis, range.from, range.to, mode, direction, status, q]);

  const summary = useMemo(() => summarise(rows), [rows]);
  const periods = useMemo(() => periodRows(rows, { basis, granularity, ...range }), [rows, basis, granularity, range.from, range.to]);
  const groups = useMemo(() => breakdown(rows, dimension), [rows, dimension]);

  const sorted = useMemo(() => {
    const val = (r: JobRow): number | string =>
      sort.key === "date" ? r.job.jobDate : sort.key === "margin" ? (r.margin ?? -Infinity) : sort.key === "variance" ? (r.variance ?? -Infinity) : r[sort.key];
    return [...rows].sort((a, b) => {
      const x = val(a),
        y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort]);

  function download() {
    const name = `job-pnl-${range.from ?? "start"}-to-${range.to ?? todayIST()}.xlsx`;
    downloadWorkbook(
      name,
      pnlWorkbook(rows, { company: COMPANY.legalName, periodText, basis, ...range, generatedAt: new Date(), generatedBy: session?.name ?? null })
    );
  }

  if (loading && !data) return <PageSkeleton />;

  const th = (key: SortKey, label: string, align: "left" | "right" = "right") => (
    <th className={`whitespace-nowrap px-3 py-2.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))}
        className={`inline-flex items-center gap-1 hover:text-text-primary ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );

  return (
    <div>
      <PageHeader
        title="Job closing"
        subtitle="What every job made, and every week, month, quarter and year — before GST, from the invoices and bills recorded."
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              type="button"
              onClick={download}
              disabled={!rows.length}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              <Download size={13} /> Download Excel
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- the period and the filters, in one place above everything they drive ---- */}
      <div className="card mb-4 space-y-3 p-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPreset(p.value)}
              aria-pressed={preset === p.value}
              className={`rounded-full border px-2.5 py-1 text-[12px] ${
                preset === p.value ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-secondary hover:text-text-primary"
              }`}
            >
              {p.label}
            </button>
          ))}
          {preset === "custom" && (
            <span className="flex flex-wrap items-center gap-1.5">
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-7" aria-label="From" />
              <span className="text-[12px] text-text-muted">to</span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-7" aria-label="To" />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-72" title="By job: a job's whole P&L falls in the period of its ETD. By document: each invoice and bill falls in the period of its own date.">
            <Segmented
              options={[
                { value: "job", label: "By job date" },
                { value: "document", label: "By invoice & bill date" },
              ]}
              value={basis}
              onChange={(v) => setBasis(v as Basis)}
            />
          </div>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="h-9" aria-label="Mode">
            <option value="">All modes</option>
            {["air", "sea_lcl", "sea_fcl", "road", "other"].map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className="h-9" aria-label="Direction">
            <option value="">Export and import</option>
            <option value="export">Export</option>
            <option value="import">Import</option>
            <option value="cross_trade">Cross trade</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as "" | ClosingState)} className="h-9" aria-label="Status">
            <option value="">Every job</option>
            <option value="open">Open</option>
            <option value="ready">Ready to close</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job, enquiry, customer, port, console…" className="h-9 w-full pl-8" />
          </div>
        </div>
        <p className="text-[11.5px] text-text-muted">
          {periodText} · {basis === "job" ? "jobs by their ETD (else booking date)" : "invoices and bills by their own dates"} · amounts before GST
        </p>
      </div>

      {/* ---- the headline figures ---- */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Tile label="Revenue" value={inr(summary.revenue)} note={summary.reimbursements ? `incl. ${inr(summary.reimbursements)} reimbursements` : undefined} />
        <Tile label="Cost" value={inr(summary.cost)} note={summary.provisionalCost ? `incl. ${inr(summary.provisionalCost)} provisional` : undefined} />
        <Tile label="Gross profit" value={inr(summary.gp)} valueClass={tone(summary.gp)} note={`Margin ${pct(summary.margin)}`} />
        <Tile
          label="Jobs"
          value={String(summary.jobs)}
          note={`${summary.closed} closed · ${summary.ready} ready · ${summary.open} open`}
        />
        <Tile label="Average profit per job" value={summary.avgGp == null ? "—" : inr(summary.avgGp)} valueClass={tone(summary.avgGp)} />
        <Tile label="Still to collect" value={inr(summary.receivable)} note="From customers and agents, with GST" />
        <Tile label="Still to pay" value={inr(summary.payable)} note="To carriers and vendors, with GST" />
        <Tile
          label="Ready to close"
          value={String(summary.ready)}
          note={summary.ready ? "Delivered, invoiced and costed" : "None waiting"}
          action={
            summary.ready ? (
              <button type="button" onClick={() => { setStatus("ready"); setView("jobs"); }} className="text-[11.5px] text-text-accent hover:underline">
                Show them
              </button>
            ) : null
          }
        />
      </div>

      <div className="mb-3 w-full sm:w-96">
        <Segmented
          options={[
            { value: "jobs", label: "Per job" },
            { value: "periods", label: "By period" },
            { value: "breakdown", label: "Breakdown" },
          ]}
          value={view}
          onChange={(v) => setView(v as View)}
        />
      </div>

      {!rows.length ? (
        <EmptyState
          icon={TrendingUp}
          title="No jobs in this period"
          hint={
            data?.jobs.length
              ? "Try a wider period, or clear the filters. A job's figures come from the invoices issued and the bills recorded against it."
              : "Jobs appear here once enquiries are booked as shipments; their figures come from the invoices issued and the bills recorded against them."
          }
        />
      ) : view === "jobs" ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[1060px] border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-surface-2 text-left text-[11px] text-text-secondary">
                <th className="w-8 px-2 py-2.5" aria-label="Open" />
                {th("date", "Job", "left")}
                <th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium">Mode · route</th>
                {th("revenue", "Revenue")}
                {th("cost", "Cost")}
                {th("gp", "Profit")}
                {th("margin", "Margin")}
                {th("variance", "vs quoted")}
                <th className="px-3 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isOpen = open === r.job.id;
                return (
                  <Fragment key={r.job.id}>
                    <tr
                      className={`cursor-pointer border-t border-border hover:bg-surface-2/60 ${isOpen ? "bg-surface-2/60" : ""}`}
                      onClick={() => setOpen(isOpen ? null : r.job.id)}
                    >
                      <td className="px-2 py-2.5 text-text-muted">
                        <ChevronDown size={14} className={`transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <p className="font-mono text-[12px] font-medium text-text-accent">{r.job.id}</p>
                        <p className="text-[11px] text-text-muted">
                          {dayLabel(r.job.jobDate)}
                          {r.job.enquiryRef ? ` · ${r.job.enquiryRef}` : ""}
                        </p>
                      </td>
                      <td className="max-w-[200px] px-3 py-2.5">
                        <p className="truncate text-text-primary">{r.job.customer}</p>
                        {r.job.handledBy && <p className="truncate text-[11px] text-text-muted">{r.job.handledBy}</p>}
                      </td>
                      <td className="max-w-[220px] px-3 py-2.5">
                        <p className="text-text-secondary">{MODE_LABEL[r.job.mode ?? "none"]}</p>
                        <p className="truncate text-[11px] text-text-muted">{[r.job.origin, r.job.destination].filter(Boolean).join(" → ") || "—"}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{inr(r.revenue)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{inr(r.cost)}</td>
                      <td className={`whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums ${tone(r.gp)}`}>{inr(r.gp)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-text-secondary">{pct(r.margin)}</td>
                      <td className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${tone(r.variance)}`}>{signed(r.variance)}</td>
                      <td className="px-3 py-2.5">
                        <StatusPill tone={STATE_TONE[r.closing.state]}>{CLOSING_LABEL[r.closing.state]}</StatusPill>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface-2/40">
                        <td colSpan={10} className="px-3 pb-4 pt-1">
                          <div className="sticky left-3 max-w-[calc(100vw-4rem)] lg:max-w-none">
                            <JobDetail r={r} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-strong bg-surface-2 font-semibold">
                <td />
                <td className="px-3 py-2.5" colSpan={3}>
                  Total · {rows.length} {rows.length === 1 ? "job" : "jobs"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{inr(summary.revenue)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{inr(summary.cost)}</td>
                <td className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${tone(summary.gp)}`}>{inr(summary.gp)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{pct(summary.margin)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : view === "periods" ? (
        <div className="space-y-3">
          <div className="w-full sm:w-[28rem]">
            <Segmented options={GRANULARITIES} value={granularity} onChange={(v) => setGranularity(v as Granularity)} />
          </div>
          {granularity === "day" && periods.length > 120 && (
            <p className="text-[12px] text-text-muted">{periods.length} days — weekly or monthly reads more easily over a period this long.</p>
          )}
          <div className="card p-4">
            <PnlChart rows={periods} shortLabel={shortLabel(granularity)} />
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-surface-2 text-left text-[11px] text-text-secondary">
                  <th className="px-3 py-2.5 font-medium">{PERIOD_WORD[granularity]}</th>
                  <th className="px-3 py-2.5 text-right font-medium">Jobs</th>
                  <th className="px-3 py-2.5 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cost</th>
                  <th className="px-3 py-2.5 text-right font-medium">Profit</th>
                  <th className="px-3 py-2.5 text-right font-medium">Margin</th>
                  <th className="px-3 py-2.5 text-right font-medium">Profit vs previous</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p, i) => {
                  const prev = i ? periods[i - 1].gp : null;
                  return (
                    <tr key={p.period.key} className={`border-t border-border ${!p.jobs ? "text-text-muted" : ""}`}>
                      <td className="whitespace-nowrap px-3 py-2">{p.period.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.jobs}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{inr(p.revenue)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{inr(p.cost)}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${tone(p.gp)}`}>{inr(p.gp)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(p.margin)}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${tone(prev == null ? null : p.gp - prev)}`}>
                        {prev == null ? "—" : signed(Math.round((p.gp - prev) * 100) / 100)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-strong bg-surface-2 font-semibold">
                  <td className="px-3 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{summary.jobs}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{inr(summary.revenue)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{inr(summary.cost)}</td>
                  <td className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${tone(summary.gp)}`}>{inr(summary.gp)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{pct(summary.margin)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {DIMENSIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDimension(d)}
                aria-pressed={dimension === d}
                className={`rounded-full border px-2.5 py-1 text-[12px] ${
                  dimension === d ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-secondary hover:text-text-primary"
                }`}
              >
                {DIMENSION_LABEL[d]}
              </button>
            ))}
          </div>
          <BreakdownTable rows={groups} dimension={dimension} />
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, note, valueClass = "text-text-primary", action }: { label: string; value: string; note?: string; valueClass?: string; action?: React.ReactNode }) {
  return (
    <div className="card min-w-0 px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-1 truncate text-[19px] font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {note && <p className="mt-0.5 truncate text-[11px] text-text-muted">{note}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** A job opened: the documents behind every figure, and what it needs to close. */
function JobDetail({ r }: { r: JobRow }) {
  const docs = (side: "revenue" | "cost") => {
    const by = new Map<string, typeof r.entries>();
    for (const e of r.entries.filter((x) => x.side === side)) by.set(e.docId, [...(by.get(e.docId) ?? []), e]);
    return [...by.values()];
  };
  const side = (title: string, s: "revenue" | "cost", total: number) => (
    <div className="min-w-0">
      <p className="mb-1.5 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {title} <span className="tabular-nums text-text-primary">{inr(total)}</span>
      </p>
      {docs(s).length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-[12px] text-text-muted">
          {s === "revenue" ? "No invoice issued in this view." : "No bill recorded in this view."}
        </p>
      ) : (
        <div className="space-y-2">
          {docs(s).map((lines) => {
            const d = lines[0];
            return (
              <div key={d.docId} className="rounded-lg border border-border bg-surface-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border px-3 py-1.5 text-[11.5px]">
                  <span className="font-medium text-text-primary">
                    {DOC_KIND_LABEL[d.docKind] ?? d.docKind} {d.docNo ?? "(no number)"}
                  </span>
                  <span className="text-text-muted">
                    {dayLabel(d.date)}
                    {d.party ? ` · ${d.party}` : ""}
                  </span>
                </div>
                <ul className="px-3 py-1.5">
                  {lines.map((l, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 py-0.5 text-[12px]">
                      <span className="min-w-0 text-text-secondary">
                        {l.head}
                        {l.reimbursement && <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10.5px] text-text-muted">reimbursement</span>}
                        {l.provisional && <span className="ml-1.5 rounded bg-bg-warning px-1 text-[10.5px] text-text-warning">provisional</span>}
                        {l.share != null && (
                          <span className="ml-1.5 rounded bg-bg-accent px-1 text-[10.5px] text-text-accent">console share {(l.share * 100).toFixed(1)}%</span>
                        )}
                      </span>
                      <span className={`shrink-0 tabular-nums ${l.amount < 0 ? "text-text-danger" : "text-text-primary"}`}>{inr(l.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const j = r.job;
  return (
    <div className="grid gap-4 pt-2 lg:grid-cols-[1fr_1fr_18rem]">
      {side("Revenue", "revenue", r.revenue)}
      {side("Cost", "cost", r.cost)}
      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-surface-1 px-3 py-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Closing</p>
          {r.closing.state === "closed" ? (
            <p className="flex items-center gap-1.5 text-[12.5px] text-text-success">
              <Check size={13} /> Signed off {j.signedOffAt ? dayLabel(j.signedOffAt.slice(0, 10)) : ""}
            </p>
          ) : r.closing.state === "ready" ? (
            <p className="flex items-center gap-1.5 text-[12.5px] text-text-accent">
              <Check size={13} /> Delivered, invoiced and costed — ready to sign off.
            </p>
          ) : r.closing.state === "cancelled" ? (
            <p className="text-[12.5px] text-text-muted">Cancelled.</p>
          ) : (
            <ul className="space-y-0.5 text-[12px] text-text-warning">
              {r.closing.reasons.map((x) => (
                <li key={x}>· {x}</li>
              ))}
            </ul>
          )}
          <dl className="mt-2 space-y-0.5 border-t border-border pt-2 text-[12px]">
            <div className="flex justify-between">
              <dt className="text-text-muted">Still to collect</dt>
              <dd className="tabular-nums">{inr(j.receivable)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">Still to pay</dt>
              <dd className="tabular-nums">{inr(j.payable)}</dd>
            </div>
            {r.reimbursements !== 0 && (
              <div className="flex justify-between">
                <dt className="text-text-muted">Reimbursements</dt>
                <dd className="tabular-nums">{inr(r.reimbursements)}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="rounded-lg border border-border bg-surface-1 px-3 py-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Against the quotation</p>
          {r.quotedGp == null ? (
            <p className="text-[12px] text-text-muted">No accepted quotation with costs to compare against.</p>
          ) : (
            <dl className="space-y-0.5 text-[12px]">
              {(
                [
                  ["Revenue", j.quotedRevenue ?? 0, r.revenue],
                  ["Cost", j.quotedCost ?? 0, r.cost],
                  ["Profit", r.quotedGp, r.gp],
                ] as const
              ).map(([label, quoted, actual]) => (
                <div key={label} className="grid grid-cols-[1fr_auto_auto] gap-x-3">
                  <dt className="text-text-muted">{label}</dt>
                  <dd className="text-right tabular-nums text-text-muted">{inr(quoted)}</dd>
                  <dd className="text-right tabular-nums">{inr(actual)}</dd>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-text-muted">Quoted, then actual.</p>
            </dl>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/shipments/${j.id}`} className="flex h-8 items-center rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary">
            Open the job
          </Link>
          <Link to={`/shipments/${j.id}/costs`} className="flex h-8 items-center rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary">
            Costs
          </Link>
          {r.closing.state !== "closed" && r.closing.state !== "cancelled" && (
            <Link
              to={`/shipments/${j.id}/sign-off`}
              className="flex h-8 items-center rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
            >
              Close the job
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** A breakdown with a share bar: one series, one colour. */
function BreakdownTable({ rows, dimension }: { rows: ReturnType<typeof breakdown>; dimension: Dimension }) {
  const measure = (b: (typeof rows)[number]) => (dimension === "vendor" ? b.cost : dimension === "charge" ? b.revenue : b.gp);
  const total = rows.reduce((n, b) => n + Math.max(0, measure(b)), 0);
  const shareLabel = dimension === "vendor" ? "Share of cost" : dimension === "charge" ? "Share of revenue" : "Share of profit";
  if (!rows.length) return <p className="py-6 text-[12.5px] text-text-muted">Nothing to break down in this view.</p>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-surface-2 text-left text-[11px] text-text-secondary">
            <th className="px-3 py-2.5 font-medium">{DIMENSION_LABEL[dimension]}</th>
            <th className="w-[26%] px-3 py-2.5 font-medium">{shareLabel}</th>
            <th className="px-3 py-2.5 text-right font-medium">Jobs</th>
            {dimension !== "vendor" && <th className="px-3 py-2.5 text-right font-medium">Revenue</th>}
            {dimension !== "charge" && <th className="px-3 py-2.5 text-right font-medium">Cost</th>}
            {dimension !== "charge" && dimension !== "vendor" && (
              <>
                <th className="px-3 py-2.5 text-right font-medium">Profit</th>
                <th className="px-3 py-2.5 text-right font-medium">Margin</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const share = total > 0 ? Math.max(0, measure(b)) / total : 0;
            return (
              <tr key={b.label} className="border-t border-border">
                <td className="max-w-[260px] truncate px-3 py-2 text-text-primary">{b.label}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-surface-2">
                      <div className="h-2 rounded-full" style={{ width: `${share * 100}%`, background: "#2a78d6" }} />
                    </div>
                    <span className="w-12 text-right text-[11.5px] tabular-nums text-text-secondary">{(share * 100).toFixed(1)}%</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{b.jobs}</td>
                {dimension !== "vendor" && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{inr(b.revenue)}</td>}
                {dimension !== "charge" && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{inr(b.cost)}</td>}
                {dimension !== "charge" && dimension !== "vendor" && (
                  <>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${tone(b.gp)}`}>{inr(b.gp)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(b.margin)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
