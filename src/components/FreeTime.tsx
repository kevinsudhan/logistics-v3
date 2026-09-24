import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Timer } from "lucide-react";
import Select from "./Select";
import {
  CLOCK_LABEL,
  SIDE_DATES,
  clockText,
  termsText,
  type BoxDates,
  type Clock,
  type ClockState,
  type DateKey,
  type FreeTimeSummary,
  type FreeTimeTerms,
  type Side,
  type SummaryState,
} from "../lib/freeTime";

/**
 * Free time on screen (083): the job's terms, each box's dates and clocks, and
 * the one-line alert the job file and the worklist carry.
 *
 * The counting is lib/freeTime.ts; this file only draws it.
 */

const CURRENCIES = ["USD", "INR", "EUR", "AED", "GBP", "SGD", "CNY"];

const CLOCK_TONE: Record<ClockState, string> = {
  waiting: "bg-surface-2 text-text-secondary",
  closed: "bg-surface-2 text-text-secondary",
  running: "bg-bg-accent text-text-accent",
  ending: "bg-bg-warning text-text-warning",
  no_terms: "bg-bg-warning text-text-warning",
  over: "bg-bg-danger text-text-danger",
  closed_over: "bg-bg-danger text-text-danger",
};

const SUMMARY_TONE: Record<SummaryState, string> = {
  none: "",
  waiting: "",
  running: "bg-surface-2 text-text-secondary",
  no_terms: "bg-bg-warning text-text-warning",
  ending: "bg-bg-warning text-text-warning",
  over: "bg-bg-danger text-text-danger",
};

/** Whether the job's alert is worth a badge: live, and either close or unknown. */
export const needsAttention = (s: FreeTimeSummary) => s.state === "over" || s.state === "ending" || s.state === "no_terms";

/**
 * The job's free time as one pill: "Free time over by 3 days".
 *
 * `quiet` also shows a clock that is simply running ("Free until 31 Oct"),
 * which the job file wants and the worklist does not — there it would be one
 * more badge on every FCL job.
 */
export function FreeTimePill({ summary, to, quiet }: { summary: FreeTimeSummary; to?: string; quiet?: boolean }) {
  if (!summary.text || (!quiet && !needsAttention(summary))) return null;
  const body = (
    <>
      {summary.state === "over" || summary.state === "no_terms" ? <AlertTriangle size={11} /> : <Timer size={11} />}
      {summary.text}
      {summary.boxes > 1 && <span className="opacity-70">· {summary.boxes} boxes</span>}
    </>
  );
  const cls = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${SUMMARY_TONE[summary.state]}`;
  return to ? (
    <Link to={to} className={`${cls} hover:underline`} title="Free time, demurrage and detention">
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
  );
}

function Num({
  label,
  value,
  onCommit,
  step,
  hint,
}: {
  label: string;
  value: number | null;
  onCommit: (v: number | null) => void;
  step?: string;
  hint?: string;
}) {
  const shown = value === null ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[11px] text-text-secondary">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={step ?? "1"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === shown) return;
          const n = Number(draft);
          onCommit(draft.trim() === "" || Number.isNaN(n) ? null : n);
        }}
        className="h-8 w-full rounded-lg border border-border bg-surface-1 px-2 text-right text-[13px] tabular-nums text-text-primary hover:border-border-strong focus:border-border-strong focus:outline-none"
      />
      {hint && <span className="mt-0.5 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  );
}

/** The free days and tariff the carrier granted on this job. */
export function FreeTimeTermsCard({
  terms,
  summary,
  onSave,
}: {
  terms: FreeTimeTerms;
  summary: FreeTimeSummary;
  onSave: (patch: Partial<FreeTimeTerms>) => void;
}) {
  const combined = terms.free_time_basis === "combined";
  const currency = terms.dnd_currency || "USD";
  const days = (v: number | null) => (v === null ? null : Math.max(0, Math.min(365, Math.round(v))));
  const money = (v: number | null) => (v === null ? null : Math.max(0, Math.round(v * 100) / 100));

  return (
    <section className="card mb-3 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium text-text-primary">Free time</h2>
          <p className="mt-0.5 max-w-prose text-[11px] leading-relaxed text-text-muted">
            The free days the carrier grants on this bill, per box. Each box&rsquo;s dates below start and stop its
            clocks. Days are calendar days, with the day a clock starts as day one.
          </p>
        </div>
        <FreeTimePill summary={summary} quiet />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="How free time is granted">
        {(
          [
            { v: "separate", label: "Demurrage and detention separately" },
            { v: "combined", label: "Combined" },
          ] as const
        ).map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onSave({ free_time_basis: o.v })}
            aria-pressed={terms.free_time_basis === o.v}
            className={`h-8 rounded-lg border px-3 text-[12px] transition-colors ${
              terms.free_time_basis === o.v
                ? "border-brand bg-brand font-medium text-white"
                : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {combined ? (
          <>
            <Num label="Free days, combined" value={terms.combined_free_days} onCommit={(v) => onSave({ combined_free_days: days(v) })} />
            <Num label={`Rate per box per day (${currency})`} value={terms.combined_rate} step="0.01" onCommit={(v) => onSave({ combined_rate: money(v) })} />
          </>
        ) : (
          <>
            <Num
              label="Demurrage free days"
              value={terms.demurrage_free_days}
              hint="In the terminal"
              onCommit={(v) => onSave({ demurrage_free_days: days(v) })}
            />
            <Num
              label="Detention free days"
              value={terms.detention_free_days}
              hint="Out of the terminal"
              onCommit={(v) => onSave({ detention_free_days: days(v) })}
            />
            <Num label={`Demurrage per box per day (${currency})`} value={terms.demurrage_rate} step="0.01" onCommit={(v) => onSave({ demurrage_rate: money(v) })} />
            <Num label={`Detention per box per day (${currency})`} value={terms.detention_rate} step="0.01" onCommit={(v) => onSave({ detention_rate: money(v) })} />
          </>
        )}
        <div className="min-w-0">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Currency</span>
          <Select
            label="Currency"
            value={currency}
            options={(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => ({ value: c, label: c }))}
            onChange={(v) => onSave({ dnd_currency: v })}
          />
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
        {termsText(terms) ? `On the arrival notice as: ${termsText(terms)}.` : "Not on the arrival notice until the free days are recorded."}{" "}
        Charges shown are an estimate at one rate per day; slab tariffs and holiday rules are the carrier&rsquo;s.
      </p>
    </section>
  );
}

/** A year a container date can plausibly have. */
const plausible = (d: string) => d === "" || (d >= "2000-01-01" && d <= "2099-12-31");

function DateInput({ label, hint, value, onCommit }: { label: string; hint: string; value: string | null; onCommit: (v: string | null) => void }) {
  const shown = value ?? "";
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  return (
    <label className="block min-w-0" title={hint}>
      <span className="mb-0.5 block text-[11px] text-text-secondary">{label}</span>
      <input
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        // Saved on leaving the box, not on each change: a date input reports a
        // "complete" date as soon as the year has one digit, so typing 2026
        // would save the years 2, 20 and 202 on the way.
        onBlur={() => draft !== shown && plausible(draft) && onCommit(draft || null)}
        className={`h-8 w-full rounded-lg border bg-surface-1 px-2 text-[13px] tabular-nums text-text-primary hover:border-border-strong focus:border-border-strong focus:outline-none ${
          plausible(draft) ? "border-border" : "border-text-warning"
        }`}
      />
      {!plausible(draft) && <span className="mt-0.5 block text-[11px] text-text-warning">Not saved: check the year</span>}
    </label>
  );
}

export function ClockLine({ clock, today }: { clock: Clock; today: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
      <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${CLOCK_TONE[clock.problem ? "ending" : clock.state]}`}>
        {CLOCK_LABEL[clock.kind]}
      </span>
      <span className={clock.problem ? "text-text-warning" : "text-text-primary"}>{clockText(clock, today)}</span>
    </li>
  );
}

/** A box's dates for this side, and the clocks they drive. */
export function BoxFreeTime({
  side,
  box,
  clocks,
  today,
  onSave,
}: {
  side: Side;
  box: BoxDates;
  clocks: Clock[];
  today: string;
  onSave: (patch: Partial<Record<DateKey, string | null>>) => void;
}) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        Free time {side === "import" ? "at destination" : "at origin"}
        {box.is_soc && <span className="ml-1 normal-case tracking-normal text-text-muted">· shipper-owned, no detention</span>}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {SIDE_DATES[side].map((d) => (
          <DateInput key={d.key} label={d.label} hint={d.hint} value={box[d.key]} onCommit={(v) => onSave({ [d.key]: v })} />
        ))}
      </div>
      <ul className="mt-2 space-y-1">
        {clocks.map((c) => (
          <ClockLine key={c.kind} clock={c} today={today} />
        ))}
      </ul>
    </div>
  );
}
