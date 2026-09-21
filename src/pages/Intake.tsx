import { useCallback, useEffect, useMemo, useState } from "react";
import ReadingPanel from "../components/ReadingPanel";
import { readText, type Reading } from "../services/classify";
import { Link } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Inbox,
  Loader2,
  Sparkles,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SquarePen,
  Undo2,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import IntakeForm from "../components/IntakeForm";
import PushToInbound from "../components/PushToInbound";
import {
  dismissIntake,
  listIntake,
  planApply,
  reopenIntake,
  updateIntake,
  CHANNEL_LABEL,
  INTAKE_STATUS_LABEL,
  type Intake,
  type IntakeStatus,
} from "../services/intake";

/**
 * The queue in front of the pipeline.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE PAGE
 *
 * Anything that reached the desk used to become an enquiry on arrival, which
 * meant a wrong number and a real shipper were treated identically: both got a
 * permanent reference and a customer record nobody can tidy away afterwards.
 *
 * This page is the step before that. A row here is cheap and reversible. It can
 * be corrected, set aside with a reason, and brought back. Only the push is
 * irreversible, and it is the one action that opens a panel and says what it is
 * about to create.
 *
 * Everything reaches it the same way: a message sent on from the mail page, a
 * submission read off the website's form, or a row typed in after a phone call.
 * The desk is worked through mail, so mail is the main door.
 * ---------------------------------------------------------------------------
 */

const CHANNEL_TONE: Record<string, string> = {
  call: "bg-bg-accent text-text-accent border-text-accent/25",
  email: "bg-bg-accent text-text-accent border-text-accent/25",
  whatsapp: "bg-bg-success text-text-success border-text-success/25",
  web: "bg-surface-2 text-text-secondary border-border-strong",
  walk_in: "bg-bg-warning text-text-warning border-text-warning/25",
  manual: "bg-surface-2 text-text-secondary border-border-strong",
};

const FILTERS: Array<IntakeStatus | "all"> = ["new", "promoted", "dismissed", "all"];

function when(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function IntakePage() {
  const [rows, setRows] = useState<Intake[]>([]);
  const [filter, setFilter] = useState<IntakeStatus | "all">("new");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [capturing, setCapturing] = useState(false);
  const [editing, setEditing] = useState<Intake | null>(null);
  const [pushing, setPushing] = useState<Intake | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Readings, keyed by row.
   *
   * Held on the page rather than inside each row so a reading survives the
   * list refreshing underneath it — pressing Set aside on a neighbouring row
   * refetches everything, and a reading that vanished when somebody else's row
   * changed would look like a bug.
   */
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [readingId, setReadingId] = useState<string | null>(null);

  /**
   * Puts a reading's fields onto the row.
   *
   * Only the blanks — `planApply` decides that, not this. What comes back is
   * said out loud, because a button that changes several fields at once and
   * reports nothing leaves the operator to spot the difference themselves.
   */
  function applyReading(r: Intake) {
    const reading = readings[r.id];
    if (!reading) return;
    const plan = planApply(r, reading);
    if (!plan.count) return;

    const filled = Object.keys(plan.fill).length;
    void act(
      r.id,
      () => updateIntake(r.id, plan.fill),
      `Filled ${filled} field${filled === 1 ? "" : "s"}` +
        (plan.conflicts.length
          ? `. Left ${plan.conflicts.join(", ")} alone — the row already says something different.`
          : ".")
    );
  }

  async function readRow(r: Intake) {
    setReadingId(r.id);
    setError(null);
    try {
      const reading = await readText({
        subject: r.subject,
        from: r.email,
        // Everything the row actually holds. A queued row keeps only a preview
        // of the mail, so the other captured fields are worth including —
        // without them a phone-call row would have almost nothing to read.
        body: [r.notes, r.contact_name, r.company, r.phone, r.origin, r.destination, r.cargo]
          .filter(Boolean)
          .join("\n"),
      });
      setReadings((prev) => ({ ...prev, [r.id]: reading }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that row.");
    } finally {
      setReadingId(null);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listIntake());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const s of ["new", "promoted", "dismissed"] as IntakeStatus[])
      c[s] = rows.filter((r) => r.status === s).length;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((r) => filter === "all" || r.status === filter)
      .filter((r) =>
        !needle
          ? true
          : [r.contact_name, r.company, r.phone, r.email, r.subject,
             r.origin, r.destination, r.cargo, r.notes]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(needle))
      );
  }, [rows, filter, query]);

  async function act(id: string, fn: () => Promise<unknown>, msg?: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (msg) setNotice(msg);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusyId(null);
    }
  }

  function setAside(row: Intake) {
    // The database requires a reason, so asking for one here is not a second
    // rule — it is the same rule, asked before the request instead of after it.
    const reason = window.prompt("Why is this being set aside?");
    if (reason === null) return;
    if (!reason.trim()) {
      setError("Say why this is being set aside.");
      return;
    }
    void act(row.id, () => dismissIntake(row.id, reason), "Set aside.");
  }

  return (
    <div>
      <PageHeader
        title="Enquiries"
        subtitle="Everything that has reached the desk and is not yet a case. Push one through and it becomes an inbound enquiry under a reference of ours."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              onClick={() => setCapturing(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium transition-colors"
            >
              <Plus size={13} />
              Capture
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Caller, company, number, route…"
            className="w-full pl-8 h-8"
          />
        </div>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] border transition-colors ${
              filter === f
                ? "border-brand bg-brand text-white"
                : "border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-strong"
            }`}
          >
            {f === "all" ? "All" : INTAKE_STATUS_LABEL[f]}
            <span className="opacity-70">{counts[f] ?? 0}</span>
          </button>
        ))}
      </div>

      {notice && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-success px-3 py-2.5 text-[12px] text-text-success">
          <Check size={13} className="mt-px shrink-0" />
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {loading && !rows.length ? (
        <p className="text-[13px] text-text-muted py-8">Loading…</p>
      ) : !visible.length ? (
        <EmptyState
          icon={Inbox}
          title={filter === "new" ? "Nothing waiting" : "Nothing here"}
          hint={
            filter === "new"
              ? "Anything that arrives and is not already a case lands here to be looked at. Capture one by hand after a phone call, or claim an unmatched call below."
              : "No rows with that status."
          }
          action={
            filter === "new" ? (
              <button
                onClick={() => setCapturing(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium transition-colors"
              >
                <Plus size={13} />
                Capture an enquiry
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <article key={r.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        CHANNEL_TONE[r.channel] ?? CHANNEL_TONE.manual
                      }`}
                    >
                      {CHANNEL_LABEL[r.channel]}
                    </span>
                    <span className="text-[11px] text-text-muted">{when(r.received_at)}</span>
                    {r.status !== "new" && (
                      <span className="text-[11px] text-text-muted">
                        · {INTAKE_STATUS_LABEL[r.status].toLowerCase()}
                      </span>
                    )}
                  </div>

                  <p className="mt-1.5 text-[14px] font-medium text-text-primary">
                    {r.company || r.contact_name || (
                      <span className="text-text-muted">Caller not named</span>
                    )}
                  </p>
                  {r.company && r.contact_name && (
                    <p className="text-[12px] text-text-secondary">{r.contact_name}</p>
                  )}

                  {/* An email's subject is what the sender called it, which is
                      usually the most informative line on the row. */}
                  {r.subject && (
                    <p className="mt-0.5 text-[12px] text-text-primary">{r.subject}</p>
                  )}

                  <p className="text-[12px] text-text-secondary">
                    {[r.origin, r.destination].filter(Boolean).join(" → ") ||
                      (r.channel === "email" ? "No route mentioned yet" : "Route not captured")}
                    {r.cargo ? ` · ${r.cargo}` : ""}
                  </p>

                  {(r.phone || r.email) && (
                    <p className="mt-0.5 text-[11px] text-text-muted truncate">
                      {[r.phone, r.email].filter(Boolean).join(" · ")}
                    </p>
                  )}

                  {r.notes && (
                    <p className="mt-2 text-[12px] text-text-secondary leading-relaxed line-clamp-3">
                      {r.notes}
                    </p>
                  )}

                  {r.status === "new" && r.conversation_id && (
                    <p className="mt-1.5 text-[11px] text-text-muted">
                      Pushing this through links the whole mail thread, so replies file themselves.
                    </p>
                  )}

                  {r.status === "dismissed" && r.dismissed_reason && (
                    <p className="mt-2 text-[12px] text-text-warning">
                      Set aside: {r.dismissed_reason}
                    </p>
                  )}

                  {readings[r.id] && (
                    <div className="mt-3">
                      {(() => {
                        const plan = planApply(r, readings[r.id]);
                        const labels = Object.keys(plan.fill).length;
                        return (
                          <ReadingPanel
                            reading={readings[r.id]}
                            hint={
                              plan.count
                                ? "Applying fills only the fields this row has left blank. Anything it disagrees with is left for you to change in Edit."
                                : plan.conflicts.length
                                  ? `Nothing to fill — this row already answers every field the reading found. It disagrees about ${plan.conflicts.join(", ")}; change that in Edit if the reading is right.`
                                  : "A reading, not a decision — nothing on this row has changed."
                            }
                            action={
                              plan.count > 0 && r.status === "new" ? (
                                <button
                                  onClick={() => applyReading(r)}
                                  disabled={busyId === r.id}
                                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border-strong bg-surface-1 text-[12px] font-medium text-text-primary hover:bg-surface-2 disabled:opacity-60 transition-colors"
                                >
                                  {busyId === r.id ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Check size={12} />
                                  )}
                                  Apply {labels} field{labels === 1 ? "" : "s"} to this row
                                </button>
                              ) : undefined
                            }
                          />
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* No shrink-0 here.
                    ----------------------------------------------------------
                    It pinned this group to the intrinsic width of four buttons,
                    which on a phone is wider than the card — so the row spilled
                    past its own edge and "Push to inbound" was cut in half. The
                    group already wraps; it just was not allowed to get narrow
                    enough to need to. */}
                <div className="flex flex-wrap items-center gap-2">
                  {r.status === "new" && (
                    <>
                      <button
                        onClick={() => void readRow(r)}
                        disabled={readingId === r.id}
                        title="Ask the model what this row is, and what is in it"
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong disabled:opacity-60 transition-colors"
                      >
                        {readingId === r.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Sparkles size={12} />
                        )}
                        {readings[r.id] ? "Read again" : "Read this"}
                      </button>
                      <button
                        onClick={() => setEditing(r)}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
                      >
                        <SquarePen size={12} />
                        Edit
                      </button>
                      <button
                        onClick={() => setAside(r)}
                        disabled={busyId === r.id}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong disabled:opacity-60 transition-colors"
                      >
                        <Undo2 size={12} />
                        Set aside
                      </button>
                      <button
                        onClick={() => setPushing(r)}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium transition-colors"
                      >
                        <ArrowRight size={12} />
                        Push to inbound
                      </button>
                    </>
                  )}

                  {r.status === "promoted" && r.enquiry_ref && (
                    <EnquiryLink
                      to={`/enquiries/${r.enquiry_ref}`}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-surface-1 font-mono text-[12px] text-text-accent hover:border-border-strong transition-colors"
                    >
                      {r.enquiry_ref}
                      <ArrowRight size={12} />
                    </EnquiryLink>
                  )}

                  {r.status === "dismissed" && (
                    <button
                      onClick={() => void act(r.id, () => reopenIntake(r.id), "Back in the queue.")}
                      disabled={busyId === r.id}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong disabled:opacity-60 transition-colors"
                    >
                      {busyId === r.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RotateCcw size={12} />
                      )}
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}


      {capturing && (
        <IntakeForm
          onClose={() => setCapturing(false)}
          onSaved={() => {
            setCapturing(false);
            setNotice("Captured.");
            void load();
          }}
        />
      )}

      {editing && (
        <IntakeForm
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {pushing && (
        <PushToInbound
          row={pushing}
          onClose={() => setPushing(null)}
          onPushed={(ref) => {
            setPushing(null);
            setNotice(`Pushed through as ${ref}.`);
            void load();
          }}
        />
      )}
    </div>
  );
}
