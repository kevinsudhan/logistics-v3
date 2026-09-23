import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Loader2, X } from "lucide-react";
import { onLane } from "../lib/schedules";
import { departureName, upcomingSchedules, type Schedule } from "../services/schedules";

/**
 * "Pick from sailing schedule" — one control, used wherever a departure is
 * needed: a shipment's schedule, a console, a new container, a quotation.
 *
 * ---------------------------------------------------------------------------
 * It offers departures still to come on the lane in hand, matched loosely —
 * "Chennai" finds "Chennai (MAA)" and "Chennai (ex Madras)", because the
 * schedule is spelled the carrier's way and the job the shipper's. The lane
 * filter can be switched off to see everything.
 *
 * What happens on picking is the caller's: each place copies what it needs.
 * ---------------------------------------------------------------------------
 */

export default function SchedulePicker({
  mode,
  from,
  to,
  onPick,
  label = "Pick from sailing schedule",
}: {
  /** Only departures of this kind. */
  mode?: "sea" | "air" | null;
  from?: string | null;
  to?: string | null;
  onPick: (s: Schedule) => void | Promise<void>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Schedule[] | null>(null);
  const [laneOnly, setLaneOnly] = useState(true);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open || rows) return;
    void upcomingSchedules({ mode: mode ?? null })
      .then(setRows)
      .catch(() => setRows([]));
  }, [open, rows, mode]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((s) => !laneOnly || onLane(s, from, to))
      .filter(
        (s) =>
          !k ||
          [s.id, s.carrier, s.vessel, s.voyage, s.flight_number, s.port_of_loading, s.port_of_discharge]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(k))
      );
  }, [rows, laneOnly, from, to, q]);

  const day = (d: string | null) =>
    d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary"
      >
        <CalendarRange size={13} /> {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pick a sailing"
          onClick={() => setOpen(false)}
        >
          <div className="card mt-10 w-full max-w-3xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-text-primary">Pick a sailing</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-text-muted hover:text-text-primary" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-3">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Vessel, flight, carrier, port or schedule ID"
                className="h-8 min-w-[220px] flex-1"
                autoFocus
              />
              {(from || to) && (
                <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                  <input type="checkbox" checked={laneOnly} onChange={(e) => setLaneOnly(e.target.checked)} />
                  Only {[from, to].filter(Boolean).join(" → ")}
                </label>
              )}
            </div>

            {!rows ? (
              <p className="flex items-center gap-2 py-6 text-[13px] text-text-muted">
                <Loader2 size={14} className="animate-spin" /> Loading the schedule…
              </p>
            ) : !shown.length ? (
              <p className="py-6 text-center text-[13px] text-text-muted">
                {rows.length
                  ? "No upcoming sailing matches. Untick the lane filter, or add it on the Sailing schedule page."
                  : "No upcoming sailings yet. Add them on the Sailing schedule page."}
              </p>
            ) : (
              <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] text-[12.5px]">
                  <thead className="sticky top-0 bg-surface-2">
                    <tr className="text-left text-[11px] text-text-secondary">
                      <th className="px-2 py-2 font-medium">Schedule</th>
                      <th className="px-2 py-2 font-medium">Lane</th>
                      <th className="px-2 py-2 font-medium">ETD → ETA</th>
                      <th className="px-2 py-2 font-medium">Cut-off</th>
                      <th className="px-2 py-2 font-medium">Departure</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.id} className="border-t border-border hover:bg-surface-2">
                        <td className="px-2 py-2">
                          <span className="font-mono text-[12px]">{s.id}</span>
                          <span className="block text-[11px] text-text-muted">{s.services.join(" ")}</span>
                        </td>
                        <td className="px-2 py-2">
                          {s.port_of_loading} → {s.port_of_discharge}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                          {day(s.etd)} → {day(s.eta)}
                          {s.transit_days != null && <span className="block text-[11px] text-text-muted">{s.transit_days} days</span>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{day(s.cfs_cutoff ?? s.port_cutoff)}</td>
                        <td className="px-2 py-2">{departureName(s)}</td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={async () => {
                              setBusy(s.id);
                              try {
                                await onPick(s);
                                setOpen(false);
                              } finally {
                                setBusy(null);
                              }
                            }}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-brand px-2.5 text-[11.5px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                          >
                            {busy === s.id && <Loader2 size={11} className="animate-spin" />}
                            Use
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
