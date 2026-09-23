import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Flag, Loader2, Plane, Ship, Truck } from "lucide-react";
import {
  checkpointsFor,
  progressOf,
  setCheckpoint,
  setCheckpointDue,
  setCheckpointNote,
  setCheckpointOwner,
  type Checkpoint,
} from "../services/checkpoints";
import { listPeople, stageLabel, type Person, type Shipment, type ShipmentStage } from "../services/enquiries";
import { DUE_TONE, dueState, dueText, todayIST } from "../lib/progress";

/**
 * The follow-ups on a booking, as a line you read left to right.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A LINE AND NOT A LIST OF TICKBOXES
 *
 * Because the question people bring to it is "where are we", and a line
 * answers that at a glance where twelve tickboxes make you count. The same
 * shape as the enquiry's workflow bar, deliberately: the job is one job.
 *
 * THE STEPS MOVE THE STAGE (066)
 *
 * Some steps are milestones — flagged — and ticking one is the cargo reaching
 * that point: the shipment's stage is the furthest milestone ticked. There is
 * no second control that can disagree with the line.
 *
 * EVERY STEP HAS A DATE
 *
 * Worked out from the booking's own dates — ready date, cut-offs, ETD, ETA —
 * and moving when they move, unless somebody set it by hand. The date under a
 * step turns red when it has passed, which is what the desk scans for.
 *
 * WHY A DONE STEP CAN BE UNDONE
 *
 * Ticked by mistake is ordinary. A checklist you cannot correct is one people
 * stop trusting, and then they keep the real state on paper.
 * ---------------------------------------------------------------------------
 */
export default function ShipmentCheckpoints({
  shipmentId,
  mode,
  onChanged,
}: {
  shipmentId: string;
  mode?: Shipment["transport_mode"];
  /** Ticking a milestone changes the shipment's stage; the page re-reads it. */
  onChanged?: () => void;
}) {
  const [list, setList] = useState<Checkpoint[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = todayIST();

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
      if (c.stage) onChanged?.();
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
  const overdue = list.filter((c) => dueState(c.due_on, Boolean(c.done_at), today) === "overdue").length;
  const NextIcon = mode === "air" ? Plane : mode === "sea_lcl" || mode === "sea_fcl" ? Ship : Truck;

  if (loading && !list.length)
    return <p className="py-4 text-[13px] text-text-muted">Loading the follow-ups…</p>;

  if (!list.length) return null;

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Workflow
        </h2>
        <p className="text-[11.5px] text-text-muted">
          {overdue > 0 && (
            <span className="mr-2 font-medium text-text-danger">{overdue} overdue</span>
          )}
          {progress && `${progress.done} of ${progress.total} done`}
        </p>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/*
        Scrolls sideways rather than wrapping. Ten steps do not fit a phone at
        a readable size, and a bar that wraps to three rows stops reading as a
        sequence, which is the only thing it is for.
      */}
      <ol className="flex min-w-0 items-start gap-0 overflow-x-auto pb-1">
        {list.map((c, i) => {
          const done = Boolean(c.done_at);
          const isNext = !done && i === reached + 1;
          const state = dueState(c.due_on, done, today);
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
                      : state === "overdue"
                        ? "border-text-danger bg-bg-danger text-text-danger"
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
                    <NextIcon size={12} />
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
                className={`mt-1.5 inline-flex items-start gap-1 px-1 text-center text-[11px] leading-tight ${
                  done || isNext ? "text-text-primary" : "text-text-muted"
                } hover:underline`}
                title={
                  c.stage
                    ? `Milestone: ticking it marks the shipment ${stageLabel(c.stage as ShipmentStage, mode)}`
                    : undefined
                }
              >
                {c.stage && <Flag size={9} className="mt-0.5 shrink-0 text-text-accent" />}
                {c.label}
              </button>
              <p className={`text-center text-[10.5px] tabular-nums ${DUE_TONE[state]}`}>
                {c.done_at ? shortDate(c.done_at) : dueText(c.due_on, false, today)}
              </p>
              {c.note && open !== c.id && (
                <p className="mt-0.5 max-w-[110px] truncate text-center text-[10.5px] text-text-muted">
                  {c.note}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {/* One step, opened by pressing its label. */}
      {open && (
        <StepDetail
          checkpoint={list.find((c) => c.id === open)!}
          mode={mode}
          onClose={() => setOpen(null)}
          onSaved={load}
        />
      )}
    </section>
  );
}

/**
 * One step: what happened, when it is due, and who is on it.
 *
 * "Warehouse says Thursday" is the thing somebody actually needs three days
 * later, and it has nowhere else to live — a mail thread is the wrong place for
 * a fact about a step, because it is buried by the next twenty messages.
 */
function StepDetail({
  checkpoint,
  mode,
  onClose,
  onSaved,
}: {
  checkpoint: Checkpoint;
  mode?: Shipment["transport_mode"];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [text, setText] = useState(checkpoint.note);
  const [saving, setSaving] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setText(checkpoint.note), [checkpoint.id, checkpoint.note]);
  useEffect(() => {
    void listPeople()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[12px] font-medium text-text-primary">{checkpoint.label}</p>
        {checkpoint.stage && (
          <p className="inline-flex items-center gap-1 text-[11px] text-text-accent">
            <Flag size={10} /> Marks the shipment {stageLabel(checkpoint.stage as ShipmentStage, mode)}
          </p>
        )}
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">
            Due {checkpoint.due_manual ? "(set by hand)" : "(from the booking's dates)"}
          </span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={(checkpoint.due_on ?? "").slice(0, 10)}
              onChange={(e) => void run(() => setCheckpointDue(checkpoint.id, e.target.value || null))}
              className="h-8 flex-1"
            />
            {checkpoint.due_manual && (
              <button
                type="button"
                onClick={() => void run(() => setCheckpointDue(checkpoint.id, null))}
                className="shrink-0 text-[11px] text-text-accent hover:underline"
                title="Work the date out from the ETD, ETA and cut-offs again"
              >
                Back to automatic
              </button>
            )}
          </div>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Who is on it</span>
          <select
            value={checkpoint.assigned_to ?? ""}
            onChange={(e) => void run(() => setCheckpointOwner(checkpoint.id, e.target.value || null))}
            className="h-8 w-full"
          >
            <option value="">Whoever handles the job</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="What happened — who you spoke to, what they said, when to chase again"
        className="w-full text-[12.5px]"
      />
      {error && <p className="mt-1 text-[11px] text-text-danger">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
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

/** "18 Sep" — a full timestamp is noise under a ten-step bar. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
