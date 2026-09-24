import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PeriodRow } from "../lib/jobPnl";

/**
 * Revenue and cost by period, with the profit between them.
 *
 * ---------------------------------------------------------------------------
 * One axis, in rupees, for all three — they are the same unit, so a second
 * scale would only invent a relationship. Revenue and cost are paired columns
 * (thin, square at the baseline, rounded at the end, a 2px gap between the
 * pair); profit is a 2px line with ringed dots, so a loss-making month shows as
 * the line dipping under zero.
 *
 * Colours are the reference palette's first three slots (validated together:
 * worst colour-blind separation ΔE 9.2). The profit green sits under 3:1
 * against white, which is why there is a legend, a tooltip on every period,
 * and the full table under the chart.
 *
 * Every period is a hover and focus target the width of its band, so the
 * reader aims at a month, not at a 2px line.
 * ---------------------------------------------------------------------------
 */

const REVENUE = "#2a78d6";
const COST = "#eb6834";
const PROFIT = "#1baf7a";
const GRID = "#e7e8e2";
const AXIS_TEXT = "#6d6e61";

/** "₹4.2L", "₹1.1Cr", "₹850" — Indian units, for axis ticks. */
export function compactInr(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  const fmt = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toString();
  if (a >= 1e7) return `${sign}₹${fmt(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${fmt(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${fmt(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
}

export const inr = (n: number) => `${n < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

/** Round numbers for the axis: 1, 2 or 5 times a power of ten. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export default function PnlChart({ rows, shortLabel }: { rows: PeriodRow[]; shortLabel: (r: PeriodRow) => string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  // Measured once before the first paint, so the chart is drawn at its real width
  // from the start; the observer then follows the window as it changes.
  useLayoutEffect(() => {
    const w = box.current?.getBoundingClientRect().width;
    if (w) setWidth(Math.max(240, Math.round(w)));
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 260;
  const pad = { top: 12, right: 12, bottom: 30, left: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const { ticks, y } = useMemo(() => {
    const values = rows.flatMap((r) => [r.revenue, r.cost, r.gp, 0]);
    const t = niceTicks(Math.min(...values), Math.max(...values));
    const lo = t[0],
      hi = t[t.length - 1];
    return { ticks: t, y: (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH };
  }, [rows, innerH, pad.top]);

  const band = innerW / Math.max(rows.length, 1);
  const barW = Math.max(1, Math.min(24, (band - 10) / 2));
  const gap = barW >= 4 ? 2 : 0;
  const zero = y(0);
  // Labels thin out rather than collide: roughly one per 64px.
  const every = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(innerW / 64))));
  const cx = (i: number) => pad.left + band * i + band / 2;

  /** A column from the baseline, rounded only at its data end. */
  const column = (x: number, v: number, w: number) => {
    const top = Math.min(y(v), zero);
    const h = Math.abs(y(v) - zero);
    if (h < 0.5) return "";
    const r = Math.min(4, w / 2, h);
    return v >= 0
      ? `M${x},${zero} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${zero} Z`
      : `M${x},${zero} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + w - r} Q${x + w},${top + h} ${x + w},${top + h - r} V${zero} Z`;
  };

  const line = rows.map((r, i) => `${i ? "L" : "M"}${cx(i)},${y(r.gp)}`).join(" ");
  const h = hover != null ? rows[hover] : null;

  return (
    <div>
      {/* The legend mirrors the marks: blocks for the columns, a stroke for the line. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: REVENUE }} /> Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: COST }} /> Cost
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: PROFIT }} /> Gross profit
        </span>
      </div>

      <div ref={box} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={H} role="img" aria-label="Revenue, cost and gross profit by period" className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#b6b3a3" : GRID} strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
                {compactInr(t)}
              </text>
            </g>
          ))}

          {rows.map((r, i) => {
            const x0 = cx(i) - barW - gap / 2;
            return (
              <g key={r.period.key}>
                {hover === i && <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} fill="#14150f" opacity={0.04} />}
                <path d={column(x0, r.revenue, barW)} fill={REVENUE} />
                <path d={column(x0 + barW + gap, r.cost, barW)} fill={COST} />
                {i % every === 0 && (
                  <text x={cx(i)} y={H - 10} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
                    {shortLabel(r)}
                  </text>
                )}
              </g>
            );
          })}

          {rows.length > 1 && <path d={line} fill="none" stroke={PROFIT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {rows.map((r, i) =>
            rows.length <= 40 || hover === i ? (
              <circle key={r.period.key} cx={cx(i)} cy={y(r.gp)} r={4} fill={PROFIT} stroke="#ffffff" strokeWidth={2} />
            ) : null
          )}

          {/* Hit targets: each period's whole band, reachable by keyboard too. */}
          {rows.map((r, i) => (
            <rect
              key={r.period.key}
              x={pad.left + band * i}
              y={pad.top}
              width={band}
              height={innerH}
              fill="transparent"
              tabIndex={0}
              aria-label={`${r.period.label}: revenue ${inr(r.revenue)}, cost ${inr(r.cost)}, gross profit ${inr(r.gp)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              style={{ outline: "none" }}
            />
          ))}
        </svg>

        {h && hover != null && (
          <div
            className="pointer-events-none absolute z-10 min-w-[180px] rounded-lg border border-border bg-surface-1 px-3 py-2 text-[12px] shadow-pop"
            style={{
              top: 8,
              left: Math.min(Math.max(cx(hover) + 12, 0), width - 196),
            }}
          >
            <p className="mb-1.5 font-medium text-text-primary">{h.period.label}</p>
            {(
              [
                ["Revenue", h.revenue, REVENUE],
                ["Cost", h.cost, COST],
                ["Gross profit", h.gp, PROFIT],
              ] as const
            ).map(([label, v, c]) => (
              <p key={label} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="inline-block h-0.5 w-3 rounded" style={{ background: c }} />
                  {label}
                </span>
                <span className="font-semibold tabular-nums text-text-primary">{inr(v)}</span>
              </p>
            ))}
            <p className="mt-1 flex justify-between gap-4 border-t border-border pt-1 text-text-muted">
              <span>Margin · jobs</span>
              <span className="tabular-nums">
                {h.margin == null ? "—" : `${(h.margin * 100).toFixed(1)}%`} · {h.jobs}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
