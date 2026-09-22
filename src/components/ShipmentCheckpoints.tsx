import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, Plane } from "lucide-react";
import {
  checkpointsFor,
  progressOf,
  setCheckpoint,
  setCheckpointNote,
  type Checkpoint,
} from "../services/checkpoints";

/**
 * The follow-ups on a booking, as a line you read left to right.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A LINE AND NOT A LIST OF TICKBOXES
 *
 * Because the question people bring to it is "where are we", and a line
 * answers that at a glance where twelve tickboxes make you count. The same
 * shape as the enquiry's workflow bar, deliberately: the job is one job, and
 * the half of it that happens after a booking should not look like a different
 * system.
 *
 * WHY THE STEPS ARE PRESSED DIRECTLY
 *
 * The bar on the enquiry is derived — nothing there can be set by hand, because
 * every step has a record behind it. These have no record behind them: ringing
 * the warehouse leaves nothing in a database. Somebody has to say it happened,
 * so the step is the control.
 *
 * WHY A DONE STEP CAN BE UNDONE
 *
 * Ticked by mistake is ordinary. A checklist you cannot correct is one people
 * stop trusting, and then they keep the real state on paper.
 * ---------------------------------------------------------------------------
 */
export default function ShipmentCheckpoints({ shipmentId }: { shipmentId: string }) {
  const [list, setList] = useState<Checkpoint[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await checkpointsFor(shipmentId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the follow-ups.");
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(c: Checkpoint) {
    setBusy(c.id);
    setError(null);
    try {
      await setCheckpoint(c.id, !c.done_at);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  const progress = progressOf(list);
  /*
    The furthest step reached, not the count of done ones.

    They differ whenever a step is skipped, which happens constantly — a job
    with no pickup because the shipper delivered into the CFS themselves. The
    rail should reach as far as the work has come.
  */
  const reached = list.reduce((last, c, i) => (c.done_at ? i : last), -1);

  if (loading && !list.length)
    return <p className="py-4 text-[13px] text-text-muted">Loading the follow-ups…</p>;

  if (!list.length) return null;

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Workflow
        </h2>
        {progress && (
          <p className="text-[11.5px] text-text-muted">
            {progress.done} of {progress.total} done
          </p>
        )}
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/*
        Scrolls sideways rather than wrapping. Eight steps do not fit a phone at
        a readable size, and a bar that wraps to three rows stops reading as a
        sequence, which is the only thing it is for.
      */}
      <ol className="flex min-w-0 items-start gap-0 overflow-x-auto pb-1">
        {list.map((c, i) => {
          const done = Boolean(c.done_at);
          const isNext = !done && i === reached + 1;
          return (
            <li
              key={c.id}
              className="flex min-w-0 flex-1 shrink-0 basis-[116px] flex-col items-center"
            >
              <div className="flex w-full items-center">
                <span
                  className={`h-0.5 flex-1 ${
                    i === 0 ? "opacity-0" : i <= reached ? "bg-text-success" : "bg-border"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => void toggle(c)}
                  disabled={busy !== null}
                  aria-pressed={done}
                  title={done ? `Done — press to undo` : `Mark "${c.label}" done`}
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[10px] transition-colors disabled:opacity-60 ${
                    done
                      ? "border-text-success bg-text-success text-white"
                      : isNext
                        ? "border-text-accent bg-surface-1 text-text-accent hover:bg-surface-2"
                        : "border-border bg-surface-2 text-text-muted hover:border-border-strong"
                  }`}
                >
                  {busy === c.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : done ? (
                    <Check size={13} />
                  ) : isNext ? (
                    <Plane size={12} />
                  ) : (
                    i + 1
                  )}
                </button>
                <span
                  className={`h-0.5 flex-1 ${
                    i === list.length - 1 ? "opacity-0" : i < reached ? "bg-text-success" : "bg-border"
                  }`}
                />
              </div>

              <button
                type="button"
                onClick={() => setOpen(open === c.id ? null : c.id)}
                className={`mt-1.5 px-1 text-center text-[11px] leading-tight ${
                  done || isNext ? "text-text-primary" : "text-text-muted"
                } hover:underline`}
              >
                {c.label}
              </button>
              <p className="text-center text-[10.5px] tabular-nums text-text-muted">
                {c.done_at ? shortDate(c.done_at) : isNext ? "next" : ""}
              </p>
              {c.note && !open && (
                <p className="mt-0.5 max-w-[110px] truncate text-center text-[10.5px] text-text-muted">
                  {c.note}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {/* The note on one step, opened by pressing its label. */}
      {open && (
        <Note
          checkpoint={list.find((c) => c.id === open)!}
          onClose={() => setOpen(null)}
          onSaved={load}
        />
      )}
    </section>
  );
}

/**
 * What happened on one step.
 *
 * "Warehouse says Thursday" is the thing somebody actually needs three days
 * later, and it has nowhere else to live — a mail thread is the wrong place for
 * a fact about a step, because it is buried by the next twenty messages.
 */
function Note({
  checkpoint,
  onClose,
  onSaved,
}: {
  checkpoint: Checkpoint;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [text, setText] = useState(checkpoint.note);
  const [saving, setSaving] = useState(false);

  useEffect(() => setText(checkpoint.note), [checkpoint.id, checkpoint.note]);

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
      <p className="mb-1.5 text-[12px] font-medium text-text-primary">{checkpoint.label}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="What happened — who you spoke to, what they said, when to chase again"
        className="w-full text-[12.5px]"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await setCheckpointNote(checkpoint.id, text.trim());
              await onSaved();
              onClose();
            } finally {
              setSaving(false);
            }
          }}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-brand px-3 text-[11.5px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Save note
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-lg border border-border px-3 text-[11.5px] text-text-secondary hover:text-text-primary"
        >
          Close
        </button>
        {checkpoint.done_at && (
          <span className="text-[11px] text-text-muted">
            Done {new Date(checkpoint.done_at).toLocaleString("en-GB")}
          </span>
        )}
      </div>
    </div>
  );
}

/** "18 Sep" — a full timestamp is noise under an eight-step bar. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
