import { useCallback, useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, Check, Loader2, Lock, ShieldCheck, Unlock, X } from "lucide-react";
import { useShipment } from "../ShipmentDetail";
import { useAuth } from "../../lib/auth";
import { failureText } from "../../lib/errorText";
import { listPeople, type Person, type SignOffItem } from "../../services/enquiries";
import { reopenSignOff, signOff, signOffChecklist } from "../../services/signoff";
import { formatDate } from "../../lib/dates";
import { useLiveVersion } from "../../lib/liveVersions";

/**
 * Operations closing the job.
 *
 * ---------------------------------------------------------------------------
 * The checklist is worked out by the database (070) — the same function the
 * sign-off itself checks — so nothing here can say "ready" while the rule says
 * otherwise. Must-pass items stop an employee; an admin can sign past one
 * with a reason, which is kept. Warnings are said and kept, and do not stop
 * anybody: accounts often invoices after operations closes a job.
 *
 * Once signed off the job's progress is locked until an admin reopens it with
 * a reason. Both are on the timeline.
 * ---------------------------------------------------------------------------
 */
export default function ShipmentSignOff() {
  const { shipment: s, reload } = useShipment();
  const { session } = useAuth();
  const [items, setItems] = useState<SignOffItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await signOffChecklist(s.id));
    } catch (e) {
      setError(failureText(e, "Could not work out the checklist.").message);
    }
  }, [s.id]);

  // The checklist reads most of the job, so any of it changing, by anybody,
  // reads it again (the page's subscription, 084).
  const live = useLiveVersion(
    "shipment_checkpoints",
    "shipment_customs",
    "shipment_movements",
    "shipment_containers",
    "house_airwaybills",
    "enquiry_files",
    "invoices",
    "bills"
  );
  useEffect(() => {
    void load();
    void listPeople()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [load, s.updated_at, live]);

  const admin = session?.role === "admin";
  const failing = items.filter((i) => i.blocking && !i.ok);
  const warnings = items.filter((i) => !i.blocking && !i.ok);
  const canSign = failing.length === 0 || (admin && note.trim() !== "");
  const signed = Boolean(s.signed_off_at);
  const who = people.find((p) => p.id === s.signed_off_by);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNote("");
      await reload();
      await load();
    } catch (e) {
      setError(failureText(e, "That did not go through.").message);
    } finally {
      setBusy(false);
    }
  }

  // Signed off: what was true at the time, not what is true now.
  const shown = signed && s.sign_off_snapshot ? s.sign_off_snapshot : items;

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {signed && (
        <section className="mb-4 rounded-card bg-bg-success p-5">
          <p className="flex items-center gap-2 text-[14px] font-medium text-text-success">
            <Lock size={15} /> Signed off
          </p>
          <p className="mt-1 text-[12.5px] text-text-success">
            {formatDate(s.signed_off_at, {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {who ? ` by ${who.full_name || who.email}` : ""}
            {s.sign_off_note ? ` — ${s.sign_off_note}` : ""}
          </p>
          <p className="mt-1 text-[11.5px] text-text-success opacity-80">
            Its progress is locked. The checklist below is as it stood when it was signed off.
          </p>
        </section>
      )}

      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          <ShieldCheck size={12} /> Ready to close
        </h2>
        <ul className="divide-y divide-border">
          {shown.map((i) => (
            <li key={i.key} className="flex items-start justify-between gap-3 py-2">
              <span className="flex items-start gap-2 text-[13px]">
                <span
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                    i.ok ? "bg-text-success text-white" : i.blocking ? "bg-text-danger text-white" : "bg-text-warning text-white"
                  }`}
                >
                  {i.ok ? <Check size={10} /> : i.blocking ? <X size={10} /> : <AlertTriangle size={9} />}
                </span>
                <span>
                  <span className="text-text-primary">{i.label}</span>
                  {!i.blocking && !i.ok && <span className="ml-1.5 text-[11px] text-text-muted">warning</span>}
                </span>
              </span>
              {i.detail && (
                <span className={`text-right text-[12px] ${i.ok ? "text-text-muted" : i.blocking ? "text-text-danger" : "text-text-warning"}`}>
                  {i.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card mt-4 p-5">
        {!signed ? (
          <>
            <p className="text-[12.5px] text-text-secondary">
              {failing.length === 0
                ? warnings.length
                  ? `Ready. ${warnings.length} warning${warnings.length === 1 ? "" : "s"} will be kept with the sign-off.`
                  : "Ready. Everything is in order."
                : admin
                  ? `Not ready: ${failing.map((i) => i.label.toLowerCase()).join(", ")}. As an admin you can sign it off anyway — say why.`
                  : `Not ready: ${failing.map((i) => i.label.toLowerCase()).join(", ")}. An admin can sign it off anyway.`}
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={failing.length ? "Why it is being signed off regardless" : "A note for accounts, if there is one"}
              className="mt-3 w-full text-[12.5px]"
            />
            <button
              type="button"
              disabled={busy || !canSign}
              onClick={() => void act(() => signOff(s.id, note.trim()))}
              className="mt-2 flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[12.5px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
              Sign off {s.id}
            </button>
          </>
        ) : admin ? (
          <>
            <p className="text-[12.5px] text-text-secondary">
              Reopening unlocks its progress. Say why — it goes on the timeline.
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Why it is being reopened"
              className="mt-3 w-full text-[12.5px]"
            />
            <button
              type="button"
              disabled={busy || note.trim() === ""}
              onClick={() => void act(() => reopenSignOff(s.id, note.trim()))}
              className="mt-2 flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-4 text-[12.5px] font-medium text-text-primary hover:bg-surface-2 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
              Reopen
            </button>
          </>
        ) : (
          <p className="text-[12.5px] text-text-secondary">Only an admin can reopen a signed-off job.</p>
        )}
      </section>
    </div>
  );
}
