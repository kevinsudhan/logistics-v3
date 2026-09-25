import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Clock, Info, RefreshCw } from "lucide-react";
import { failureText, type FailureText } from "../lib/errorText";
import { describeDelay, delayTone, listReplies, type ReplyLogRow } from "../services/replyLog";
import { ListSkeleton } from "./Loading";
import { formatDate } from "../lib/dates";

/**
 * Who answered a partner, and how long they took.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COLUMNS ARE THESE FOUR
 *
 * The question this exists for is "is anybody being left waiting", and it is
 * answered by: who wrote in, when, who replied, and the gap. Everything else --
 * subject lines, message ids, folders -- is there to identify the row once the
 * gap has made you look at it, so it goes underneath rather than in a column of
 * its own.
 *
 * Sorted by when the reply went out rather than by the size of the gap. A
 * league table of slowest responses reads as a scoreboard about people; a
 * chronological log reads as a record of work, which is what it is. The gap is
 * coloured, so the slow ones are still the ones your eye lands on.
 *
 * WHAT IT CANNOT SEE, SAID ON THE SCREEN
 *
 * Replies sent from Outlook rather than from the CRM. There is no row for
 * those, so a thread answered from somebody's phone looks unanswered here. An
 * administrator reading a number that is quietly missing a third of the desk's
 * replies would draw conclusions from it, so the limit is stated above the
 * table rather than in a tooltip.
 * ---------------------------------------------------------------------------
 */
export default function ReplyLog() {
  const [rows, setRows] = useState<ReplyLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FailureText | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listReplies(50));
    } catch (e) {
      setError(failureText(e, "Could not load the reply log."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-[14px] font-medium text-text-primary">
            <Clock size={15} className="text-text-accent" />
            Partner correspondence
          </h2>
          <p className="mt-1 max-w-prose text-[13px] text-text-secondary">
            When an agent wrote in, who answered, and how long it took.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Not a footnote. A number missing a third of the desk's replies is
          worse than no number, so the limit is stated before the table. */}
      <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-text-secondary">
        <Info size={13} className="mt-px shrink-0" />
        <span>
          Only replies sent from this CRM. Mail answered directly in Outlook leaves no record
          here, so a thread can look unanswered while it has been dealt with.
        </span>
      </p>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            {error.message}
            {error.hint && <span className="mt-1 block opacity-80">{error.hint}</span>}
          </span>
        </div>
      )}

      {loading && !rows.length ? (
        <ListSkeleton rows={3} />
      ) : !rows.length ? (
        <p className="py-6 text-[13px] text-text-muted">
          Nothing answered from the CRM yet. Reply to an agent from their mail page and it
          appears here.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-text-primary">
                  {r.partner || r.inbound_from || "Unknown sender"}
                </p>
                <p className="truncate text-[12px] text-text-secondary">{r.subject || "(no subject)"}</p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {r.inbound_at ? `In ${when(r.inbound_at)}` : "Arrival time not recorded"}
                  {" · "}
                  {`${r.replied_by_name} replied ${when(r.replied_at)}`}
                </p>
              </div>

              <span
                className={`shrink-0 text-[13px] font-medium tabular-nums ${toneClass(
                  delayTone(r.hours_to_reply)
                )}`}
                title={
                  r.hours_to_reply === null
                    ? "The message's arrival time was not recorded"
                    : "Time between their message arriving and the reply going out"
                }
              >
                {describeDelay(r.hours_to_reply)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A same-day reply gets no colour at all: it is the unremarkable case. */
function toneClass(tone: ReturnType<typeof delayTone>): string {
  if (tone === "danger") return "text-text-danger";
  if (tone === "warning") return "text-text-warning";
  if (tone === "muted") return "text-text-muted";
  return "text-text-primary";
}

/** Date and time, because on this screen the time is the point. */
function when(iso: string): string {
  const d = new Date(iso);
  return formatDate(d, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
