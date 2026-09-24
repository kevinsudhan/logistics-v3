import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, Loader2, X } from "lucide-react";
import Select from "./Select";
import SchedulePicker from "./SchedulePicker";
import { CONTAINER_TYPES, DEFAULT_CONTAINER, createContainer, linkContainerSchedule, type Container } from "../services/containers";
import type { Partner } from "../services/partners";
import { departureName, type Schedule } from "../services/schedules";

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
export default function AddContainer({
  partners,
  schedule,
  onClose,
  onAdded,
}: {
  partners: Partner[];
  /** The departure it goes on: the route, dates and carrier come from it. */
  schedule?: Schedule | null;
  onClose: () => void;
  onAdded: (c: Container) => void;
}) {
  const [origin, setOrigin] = useState(schedule?.port_of_loading ?? "");
  const [destination, setDestination] = useState(schedule?.port_of_discharge ?? "");
  const [sailingDate, setSailingDate] = useState(schedule?.etd ?? "");
  const [code, setCode] = useState<string>(DEFAULT_CONTAINER);
  const [partnerId, setPartnerId] = useState("");
  const [carrier, setCarrier] = useState(schedule?.carrier ?? "");
  const [cutoff, setCutoff] = useState(schedule?.cfs_cutoff ?? schedule?.port_cutoff ?? "");
  const [mode, setMode] = useState<"FCL" | "LCL">(schedule && !schedule.services.includes("FCL") ? "LCL" : "FCL");
  const [notes, setNotes] = useState("");
  // The sailing schedule entry the route and dates were taken from, if any.
  const [scheduleId, setScheduleId] = useState<string | null>(schedule?.id ?? null);
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6" onClick={onClose}>
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
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {schedule ? (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-text-secondary">
              On <span className="font-medium text-text-primary">{departureName(schedule)}</span>, leaving {schedule.port_of_loading}{" "}
              <span className="font-mono text-text-muted">({schedule.id})</span>
            </p>
          ) : (
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
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From" required>
              <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Chennai" className="w-full" autoFocus />
            </Field>
            <Field label="To" required>
              <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Colombo" className="w-full" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sailing date" required>
              <input type="date" value={sailingDate} onChange={(e) => setSailingDate(e.target.value)} className="w-full" />
            </Field>
            <Field label="Cut-off" hint="Optional. Cannot be after the sailing.">
              <input type="date" value={cutoff} max={sailingDate || undefined} onChange={(e) => setCutoff(e.target.value)} className="w-full" />
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
              <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="CMA CGM" className="w-full" />
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

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
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
