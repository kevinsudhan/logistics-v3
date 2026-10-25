import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Loader2, X } from "lucide-react";
import Select from "./Select";
import { useDialog } from "../lib/useDialog";
import {
  listCustomers,
  listPeople,
  mayAssignOthers,
  type Customer,
  type Person,
} from "../services/enquiries";
import { useAuth } from "../lib/auth";
import { blocksPromotion, promoteIntake, type Intake } from "../services/intake";

/**
 * The moment an intake row becomes a case.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A PANEL AND NOT A BUTTON
 *
 * Everything before this point is reversible. A queued row can be edited, set
 * aside, reopened, and none of it is visible to anybody outside the desk.
 * Pushing it through is the first irreversible step: it allocates a reference
 * the customer will be quoted under, and enquiries are never deleted because
 * the correspondence attached to them is the record of what was said.
 *
 * So the panel shows what is about to be created before it creates it, and puts
 * the one real decision in front of the operator: is this somebody we already
 * have. Getting that wrong is the expensive mistake — a second customer record
 * for an existing shipper splits their history in two, and nothing downstream
 * puts it back together.
 *
 * The match is suggested, never applied. An email or phone number that matches
 * an existing customer preselects them and says why; the operator can still
 * override it, because two people at one company share a switchboard number and
 * the CRM has no way to know which of them rang.
 * ---------------------------------------------------------------------------
 */
export default function PushToInbound({
  row,
  onClose,
  onPushed,
}: {
  row: Intake;
  onClose: () => void;
  onPushed: (ref: string) => void;
}) {
  const { session } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [people, setPeople] = useState<Person[]>([]);
  /**
   * Who will handle it once it exists.
   *
   * Empty means nobody: it lands on the shared board for whoever picks it up,
   * which is the right default. Naming somebody is a decision, and a decision
   * should be made rather than inherited from whoever happened to press this.
   */
  const [handler, setHandler] = useState<string>("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listCustomers().then(setCustomers);
    void listPeople().then(setPeople).catch(() => setPeople([]));
  }, []);

  // Tab stays inside, Escape closes (not when it only shut a dropdown), focus goes back on closing.
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);

  /**
   * A customer this row probably belongs to.
   *
   * Email first, because an address is a person; a phone number can be a
   * company switchboard that three different shippers ring from. Digits are
   * compared with the punctuation stripped, so +91 98401 12233 and 919840112233
   * are recognised as the same number.
   */
  const suggestion = useMemo(() => {
    const email = row.email?.trim().toLowerCase();
    if (email) {
      const hit = customers.find((c) => c.emails.some((e) => e.toLowerCase() === email));
      if (hit) return { customer: hit, why: `${email} is already on this customer` };
    }
    const digits = (row.phone ?? "").replace(/\D/g, "");
    if (digits.length >= 8) {
      const hit = customers.find((c) =>
        c.phones.some((p) => {
          const d = p.replace(/\D/g, "");
          return d.endsWith(digits.slice(-10)) || digits.endsWith(d.slice(-10));
        })
      );
      if (hit) return { customer: hit, why: `${row.phone} matches a number on this customer` };
    }
    return null;
  }, [customers, row.email, row.phone]);

  // Preselect the suggestion, but stop doing so the moment somebody chooses.
  useEffect(() => {
    if (!touched && suggestion) setCustomerId(suggestion.customer.id);
  }, [suggestion, touched]);

  const chosen = customers.find((c) => c.id === customerId) ?? null;
  const blocked = blocksPromotion(row, customerId || undefined);

  async function push() {
    setBusy(true);
    setError(null);
    try {
      const enquiry = await promoteIntake(
        row.id,
        customerId || undefined,
        // Naming somebody takes precedence; otherwise it goes to the board.
        false,
        handler || null
      );
      onPushed(enquiry.ref);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not push that through.");
    } finally {
      setBusy(false);
    }
  }

  const named = (row.contact_name ?? "").trim() || (row.company ?? "").trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        ref={box}
        className="w-full max-w-lg card shadow-xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Push to inbound enquiries"
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-[14px] font-medium text-text-primary">Push to inbound enquiries</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              File it under
            </label>
            <Select
              label="File it under"
              value={customerId}
              onChange={(v) => {
                setTouched(true);
                setCustomerId(v);
              }}
              options={[
                { value: "", label: "A new customer", hint: "Creates a record with its own id" },
                ...customers.map((c) => ({
                  value: c.id,
                  label: c.company || c.name,
                  hint: suggestion?.customer.id === c.id ? `${c.id} · suggested` : c.id,
                })),
              ]}
            />

            {suggestion && customerId === suggestion.customer.id && (
              <p className="mt-1.5 text-[11px] text-text-success">
                Suggested: {suggestion.why}.
              </p>
            )}
            {!customerId && (
              <p className="mt-1.5 text-[11px] text-text-muted">
                A new customer record will be created and given its own id.
              </p>
            )}
          </div>

          {mayAssignOthers(people, session?.userId) && (
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                Who handles it
              </label>
              <Select
                label="Who handles it"
                value={handler}
                onChange={setHandler}
                options={[
                  { value: "", label: "Nobody yet", hint: "Goes to the shared board" },
                  ...people.map((p) => ({
                    value: p.id,
                    label: p.full_name?.trim() || p.email,
                    hint:
                      p.id === session?.userId
                        ? "you"
                        : p.role === "admin"
                          ? "administrator"
                          : undefined,
                  })),
                ]}
              />
              {handler && (
                <p className="mt-1.5 text-[11px] text-text-muted">
                  It appears on their My enquiries as soon as this is pushed through.
                </p>
              )}
            </div>
          )}

          {/* What is about to exist, before it exists. */}
          <div className="rounded-lg bg-surface-2 px-3.5 py-3 text-[12px]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
              This will create
            </p>
            <dl className="space-y-1.5">
              <Line
                label="Customer"
                value={chosen ? `${chosen.company || chosen.name} · ${chosen.id}` : named || "—"}
                hint={chosen ? "Existing, nothing new added" : "New record"}
              />
              <Line
                label="Enquiry"
                value="A new reference on the inbound board"
                hint={`Status new, source ${row.channel === "walk_in" ? "manual" : row.channel}`}
              />
              <Line
                label="Handled by"
                value={
                  handler
                    ? (people.find((p) => p.id === handler)?.full_name?.trim() ??
                      people.find((p) => p.id === handler)?.email ??
                      "somebody")
                    : "Nobody yet"
                }
                hint={handler ? "Lands on their My enquiries" : "Waits on the shared board"}
              />
              <Line
                label="Route"
                value={
                  [row.origin, row.destination].filter(Boolean).join(" → ") || "Not captured yet"
                }
                hint={row.cargo || undefined}
              />
              {row.call_id && (
                <Line
                  label="Call"
                  value={row.call_id}
                  hint="Moved onto the case file with its transcript"
                  mono
                />
              )}
            </dl>
          </div>

          <p className="text-[11px] text-text-muted leading-relaxed">
            A reference is permanent once allocated. Enquiries are never deleted, because the
            correspondence filed against them is the record of what the customer was told.
          </p>

          {blocked && (
            <div className="flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
              <AlertCircle size={13} className="mt-px shrink-0" />
              {blocked}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void push()}
            disabled={busy || blocked !== null}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-50 text-white text-[12px] font-medium transition-colors"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
            Push it through
          </button>
        </footer>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="w-20 shrink-0 text-text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1">
        <span className={`text-text-primary ${mono ? "font-mono text-[11.5px]" : ""}`}>{value}</span>
        {hint && <span className="block text-[11px] text-text-muted">{hint}</span>}
      </dd>
    </div>
  );
}
