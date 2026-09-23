import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  Ship,
  X,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Select from "../components/Select";
import SchedulePicker from "../components/SchedulePicker";
import {
  CONTAINER_TYPES,
  DEFAULT_CONTAINER,
  STATUS_LABEL,
  createContainer,
  linkContainerSchedule,
  enquiriesOn,
  listContainers,
  routeOf,
  sailsIn,
  updateContainer,
  type Container,
  type ContainerStatus,
} from "../services/containers";
import { listPartners, type Partner } from "../services/partners";
import type { Enquiry } from "../services/enquiries";

/**
 * The containers the desk has space on.
 *
 * ---------------------------------------------------------------------------
 * WHAT A ROW IS
 *
 * A box of a given size, on a route, leaving on a date, with a partner. That is
 * the whole model — the same row the stowage planner calls a sailing, because a
 * second table for the same four facts would let the two screens disagree about
 * what space exists.
 *
 * SORTED BY WHEN IT SAILS, NOT WHEN IT WAS ADDED
 *
 * The only question this page answers is "what is going out, and what is on
 * it". Creation order is an implementation detail of the database and tells
 * nobody anything; the next sailing is the one that needs a decision today.
 *
 * Expanding a row asks what is on it, rather than fetching that for every row
 * up front. Most rows are never expanded.
 * ---------------------------------------------------------------------------
 */

const STATUS_TONE: Record<ContainerStatus, string> = {
  open: "border-text-success/25 bg-bg-success text-text-success",
  closing_soon: "border-text-warning/25 bg-bg-warning text-text-warning",
  full: "border-text-accent/25 bg-bg-accent text-text-accent",
  sailed: "border-border bg-surface-2 text-text-muted",
};

export default function Containers() {
  const [rows, setRows] = useState<Container[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showSailed, setShowSailed] = useState(false);

  /** Which row is expanded, and what is on it once asked. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [onBoard, setOnBoard] = useState<Record<string, Enquiry[]>>({});
  const [loadingBoard, setLoadingBoard] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listContainers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the containers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void listPartners().then(setPartners).catch(() => setPartners([]));
  }, [load]);

  const visible = useMemo(
    () => rows.filter((r) => showSailed || r.status !== "sailed"),
    [rows, showSailed]
  );
  const sailedCount = useMemo(() => rows.filter((r) => r.status === "sailed").length, [rows]);

  async function expand(c: Container) {
    if (openId === c.id) return setOpenId(null);
    setOpenId(c.id);
    if (onBoard[c.id]) return;
    setLoadingBoard(true);
    try {
      const list = await enquiriesOn(c.id);
      setOnBoard((prev) => ({ ...prev, [c.id]: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read what is on that container.");
    } finally {
      setLoadingBoard(false);
    }
  }

  async function setStatus(c: Container, status: ContainerStatus) {
    setError(null);
    try {
      await updateContainer(c.id, { status });
      setNotice(`${c.id} marked ${STATUS_LABEL[status].toLowerCase()}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Containers"
        subtitle="Space the desk has booked. Add a container here, then put enquiries on it from the inbound board."
        action={
          <button
            onClick={() => setAdding(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark"
          >
            <Plus size={14} />
            Add a container
          </button>
        }
      />

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-success px-3 py-2.5 text-[12px] text-text-success">
          <Check size={13} className="mt-px shrink-0" />
          {notice}
        </div>
      )}

      {sailedCount > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setShowSailed((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            {showSailed ? "Hide" : "Show"} {sailedCount} sailed
          </button>
        </div>
      )}

      {loading ? (
        <p className="p-4 text-[13px] text-text-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No containers yet"
          hint="Add the space you have booked — a box, a route, a sailing date and who it is with. Enquiries can then be put on it from the inbound board."
        />
      ) : (
        <div className="card divide-y divide-border overflow-hidden">
          {visible.map((c) => {
            const when = sailsIn(c.sailing_date);
            const open = openId === c.id;
            const list = onBoard[c.id];

            return (
              <div key={c.id}>
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                  <button
                    onClick={() => void expand(c)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-text-secondary">
                      <Ship size={15} />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] font-medium text-text-secondary">
                          {c.container_code}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${STATUS_TONE[c.status]}`}
                        >
                          {STATUS_LABEL[c.status]}
                        </span>
                        {(c.enquiry_count ?? 0) > 0 && (
                          <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10.5px] text-text-secondary">
                            {c.enquiry_count} on board
                          </span>
                        )}
                      </span>

                      <span className="mt-1 block text-[13.5px] font-medium text-text-primary">
                        {routeOf(c)}
                      </span>

                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-text-secondary">
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarDays size={11} className="text-text-muted" />
                          {new Date(c.sailing_date + "T00:00:00").toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                          <span
                            className={
                              when.past
                                ? "text-text-muted"
                                : when.urgent
                                  ? "font-medium text-text-warning"
                                  : "text-text-muted"
                            }
                          >
                            · {when.text}
                          </span>
                        </span>
                        {(c.partner_name || c.partner_org) && (
                          <span className="text-text-muted">
                            {[c.partner_name, c.partner_org].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                    </span>

                    <ChevronDown
                      size={14}
                      className={`mt-1 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </button>

                  {c.status !== "sailed" && (
                    <div className="flex flex-wrap items-center gap-2">
                      {c.status !== "full" && (
                        <button
                          onClick={() => void setStatus(c, "full")}
                          className="h-7 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                        >
                          Mark full
                        </button>
                      )}
                      <button
                        onClick={() => void setStatus(c, "sailed")}
                        className="h-7 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                      >
                        Mark sailed
                      </button>
                    </div>
                  )}
                </div>

                {open && (
                  <div className="border-t border-border bg-surface-2 px-4 py-3">
                    {loadingBoard && !list ? (
                      <p className="text-[12px] text-text-muted">Reading what is on board…</p>
                    ) : !list?.length ? (
                      <p className="text-[12px] text-text-muted">
                        Nothing on this container yet. Put an enquiry on it from the{" "}
                        <Link to="/enquiries" className="text-text-accent hover:underline">
                          inbound board
                        </Link>
                        .
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {list.map((e) => (
                          <li key={e.ref}>
                            <EnquiryLink
                              to={`/enquiries/${e.ref}`}
                              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] hover:underline"
                            >
                              <span className="font-mono font-medium text-text-accent">{e.ref}</span>
                              <span className="text-text-primary">
                                {[e.origin, e.destination].filter(Boolean).join(" → ") || "—"}
                              </span>
                              {e.cargo && <span className="text-text-muted">{e.cargo}</span>}
                            </EnquiryLink>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <AddContainer
          partners={partners}
          onClose={() => setAdding(false)}
          onAdded={(c) => {
            setAdding(false);
            setNotice(`${c.id} added — ${routeOf(c)}, sailing ${c.sailing_date}.`);
            void load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Adding one.
 *
 * ---------------------------------------------------------------------------
 * FOUR FIELDS ARE REQUIRED AND THE REST ARE NOT
 *
 * Where from, where to, when it sails, and the type — and the type arrives
 * already answered, because a plain forty-foot box is what gets booked unless
 * somebody says otherwise. Making that a default rather than a question is the
 * difference between four decisions and three.
 *
 * The partner is optional on purpose: space is often held before the paperwork
 * names who it is with, and a required field there would have people typing
 * "TBC" into it within a week.
 * ---------------------------------------------------------------------------
 */
function AddContainer({
  partners,
  onClose,
  onAdded,
}: {
  partners: Partner[];
  onClose: () => void;
  onAdded: (c: Container) => void;
}) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [sailingDate, setSailingDate] = useState("");
  const [code, setCode] = useState<string>(DEFAULT_CONTAINER);
  const [partnerId, setPartnerId] = useState("");
  const [carrier, setCarrier] = useState("");
  const [cutoff, setCutoff] = useState("");
  const [mode, setMode] = useState<"FCL" | "LCL">("FCL");
  const [notes, setNotes] = useState("");
  // The sailing schedule entry the route and dates were taken from, if any.
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ready = origin.trim() && destination.trim() && sailingDate;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return setError("Give it both ends of the route and a sailing date.");
    setBusy(true);
    setError(null);
    try {
      const c = await createContainer({
        origin,
        destination,
        sailing_date: sailingDate,
        partner_id: partnerId || null,
        container_code: code,
        carrier,
        cutoff_date: cutoff || null,
        mode,
        notes,
      });
      if (scheduleId) await linkContainerSchedule(c.id, scheduleId);
      onAdded(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that container.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full flex-col rounded-t-card shadow-pop sm:card sm:max-w-lg"
        role="dialog"
        aria-label="Add a container"
        noValidate
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-medium text-text-primary">Add a container</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <SchedulePicker
              mode="sea"
              from={origin || null}
              to={destination || null}
              onPick={(x) => {
                setOrigin(x.port_of_loading);
                setDestination(x.port_of_discharge);
                setSailingDate(x.etd);
                setCutoff(x.cfs_cutoff ?? x.port_cutoff ?? "");
                if (x.carrier) setCarrier(x.carrier);
                setScheduleId(x.id);
              }}
            />
            {scheduleId && <span className="font-mono text-[11.5px] text-text-muted">From {scheduleId}</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From" required>
              <input
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Chennai"
                className="w-full"
                autoFocus
              />
            </Field>
            <Field label="To" required>
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Colombo"
                className="w-full"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sailing date" required>
              <input
                type="date"
                value={sailingDate}
                onChange={(e) => setSailingDate(e.target.value)}
                className="w-full"
              />
            </Field>
            <Field label="Cut-off" hint="Optional. Cannot be after the sailing.">
              <input
                type="date"
                value={cutoff}
                max={sailingDate || undefined}
                onChange={(e) => setCutoff(e.target.value)}
                className="w-full"
              />
            </Field>
          </div>

          <Field label="Container">
            <Select
              label="Container type"
              value={code}
              onChange={setCode}
              options={CONTAINER_TYPES.map((t) => ({
                value: t.code,
                label: `${t.label} · ${t.code}`,
                hint: t.hint,
              }))}
            />
          </Field>

          <Field label="Partner" hint="Optional — who the space is with.">
            <Select
              label="Partner"
              value={partnerId}
              onChange={setPartnerId}
              options={[
                { value: "", label: "Not named yet" },
                ...partners.map((p) => ({
                  value: p.id,
                  label: p.organisation?.trim() || p.name,
                  hint: p.organisation?.trim() ? p.name : undefined,
                })),
              ]}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Carrier" hint="Optional.">
              <input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="CMA CGM"
                className="w-full"
              />
            </Field>
            <Field label="Mode">
              <Select
                label="Mode"
                value={mode}
                onChange={(v) => setMode(v as "FCL" | "LCL")}
                options={[
                  { value: "FCL", label: "FCL", hint: "One shipper takes the box" },
                  { value: "LCL", label: "LCL", hint: "Consolidated — several shippers" },
                ]}
              />
            </Field>
          </div>

          <Field label="Notes" hint="Optional.">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full"
              placeholder="Anything the desk needs to know about this box."
            />
          </Field>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !ready}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
            Add it
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-text-secondary">
        {label}
        {required && <span className="ml-1 text-text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  );
}
