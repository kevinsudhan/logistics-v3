import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Ban,
  Check,
  ChevronDown,
  HandCoins,
  Loader2,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import Select from "./Select";
import StatusPill from "./StatusPill";
import {
  DIRECTION_LABEL,
  LINE_CURRENCIES,
  chargeHeadsFor,
  type ChargeHead,
  STATES,
  UNITS,
} from "../services/charges";
import {
  KIND_LABEL,
  STATUS_LABEL,
  TREATMENTS,
  addLine,
  cancelInvoice,
  getInvoice,
  issueInvoice,
  money,
  removeLine,
  updateInvoice,
  updateLine,
  type Invoice,
  type InvoiceLine,
  type TaxTreatment,
} from "../services/billing";
import { startPayment } from "../services/receipts";
import { SectionSkeleton } from "./Loading";

/**
 * One invoice, being built or being read.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS TRYING NOT TO BE
 *
 * The screen this replaces is eighteen fields in a flat grid, six of them
 * starred as required, with the total below the fold and the invoice number in
 * a text box. Everything here is a reaction to one of those:
 *
 *   - The number is allocated by the database at issue. There is nothing to
 *     type and nothing to get wrong.
 *   - Fields the system already knows are filled in and shown as context, not
 *     asked for. The B/L number is not a question you answer on a screen you
 *     reached by clicking that B/L.
 *   - The total is pinned next to the charges, because it is the number
 *     everybody opened the invoice to read.
 *   - Fields that are empty are empty. The reference system prints 01/01/1900
 *     in its extension date, which is a null that got out.
 *
 * SAVING
 *
 * Every field writes on blur. A draft is a scratchpad and a Save button on a
 * scratchpad is a thing to forget to press; the risk it protects against —
 * half-finished edits reaching a document — is handled instead by the database
 * refusing to touch an invoice that has been issued.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  issued: "accent",
  part_paid: "warning",
  paid: "success",
  cancelled: "danger",
};

/** A labelled field that writes when it loses focus. */
function Text({
  label,
  value,
  onCommit,
  placeholder,
  hint,
  mono,
  disabled,
  type = "text",
  className,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  disabled?: boolean;
  type?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <label className={`block min-w-0 ${className ?? ""}`}>
      <span className="block text-[11px] text-text-secondary">{label}</span>
      {disabled ? (
        <span
          className={`block truncate py-1 text-[13px] ${mono ? "font-mono " : ""}${
            value ? "text-text-primary" : "text-text-muted"
          }`}
        >
          {value || "—"}
        </span>
      ) : (
        <input
          type={type}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== value && onCommit(draft)}
          className={`mt-0.5 h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 text-[13px] text-text-primary transition-colors placeholder:text-text-muted hover:border-border-strong focus:border-border-strong focus:outline-none ${
            mono ? "font-mono" : ""
          }`}
        />
      )}
      {hint && <span className="mt-0.5 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  );
}

/** Read-only fact carried over from the job. */
function Carried({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className={`truncate text-[13px] ${value ? "text-text-primary" : "text-text-muted"}`}>
        {value || "—"}
      </p>
    </div>
  );
}

export default function InvoiceEditor({
  invoiceId,
  onChanged,
  /** Square off the top edge when it hangs directly under the row that opened it. */
  nested,
}: {
  invoiceId: string;
  onChanged?: () => void;
  nested?: boolean;
}) {
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [more, setMore] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const savedTimer = useRef<number>();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      setInv(await getInvoice(invoiceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the invoice.");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const flash = useCallback(() => {
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1600);
  }, []);

  const locked = !inv || inv.status !== "draft";

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        await load();
        flash();
        onChanged?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not save.");
      }
    },
    [flash, load, onChanged]
  );

  const patch = (p: Partial<Invoice>) => void run(() => updateInvoice(invoiceId, p));

  /**
   * The tax the customer is charged, as one number. The split into CGST and
   * SGST is a fact about the return, not about what they owe.
   */
  const tax = useMemo(
    () => (inv ? inv.cgst_amount + inv.sgst_amount + inv.igst_amount : 0),
    [inv]
  );

  if (loading) return <SectionSkeleton lines={5} />;
  if (!inv) return <p className="py-6 text-[13px] text-text-muted">That invoice is not there.</p>;

  const zeroRated = inv.tax_treatment === "export_lut" || inv.tax_treatment === "exempt";

  return (
    <div className={`card overflow-hidden ${nested ? "rounded-t-none" : ""}`}>
      {/* ------------------------------------------------------------ header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface-2 px-4 py-3">
        <span className="font-mono text-[13px] font-medium text-text-primary">
          {inv.number ?? "Not numbered yet"}
        </span>
        <StatusPill tone={TONE[inv.status]}>{STATUS_LABEL[inv.status]}</StatusPill>
        <StatusPill tone="neutral">{KIND_LABEL[inv.kind]}</StatusPill>

        {!inv.number && (
          <span className="text-[11px] text-text-muted">
            The number is allocated when you issue it, so an abandoned draft leaves no gap in the
            series.
          </span>
        )}

        <span className="ml-auto flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-[11px] text-text-success">
              <Check size={11} /> Saved
            </span>
          )}
          {locked && (
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
              <Lock size={11} /> Issued — no longer editable
            </span>
          )}
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 border-b border-border bg-bg-danger px-4 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-5 p-4">
        {/* ------------------------------------------------------ billed to */}
        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            Billed to
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Text
              label="Name"
              value={inv.bill_to_name}
              disabled={locked}
              onCommit={(v) => patch({ bill_to_name: v })}
              placeholder="Registered name"
            />
            <Text
              label="GSTIN"
              value={inv.bill_to_gstin ?? ""}
              disabled={locked}
              mono
              placeholder="33ABCDE1234F1Z5"
              hint="Paste it and the state fills itself in"
              onCommit={(v) => {
                const code = v.trim().length >= 2 ? v.trim().slice(0, 2) : null;
                const st = STATES.find((s) => s.code === code);
                // The first two characters of a GSTIN are the state code, by
                // construction. Asking for the same fact twice is how the two
                // end up disagreeing.
                patch({
                  bill_to_gstin: v || null,
                  ...(st
                    ? {
                        bill_to_state: st.name,
                        bill_to_state_code: st.code,
                        place_of_supply: st.name,
                        place_of_supply_code: st.code,
                        tax_treatment: (inv.bill_to_country !== "India"
                          ? inv.tax_treatment
                          : st.code === "33"
                            ? "cgst_sgst"
                            : "igst") as TaxTreatment,
                      }
                    : {}),
                });
              }}
            />
            <label className="block sm:col-span-2">
              <span className="block text-[11px] text-text-secondary">Address</span>
              {locked ? (
                <span className="block whitespace-pre-wrap py-1 text-[13px] text-text-primary">
                  {inv.bill_to_address || "—"}
                </span>
              ) : (
                <textarea
                  defaultValue={inv.bill_to_address}
                  rows={2}
                  onBlur={(e) =>
                    e.target.value !== inv.bill_to_address &&
                    patch({ bill_to_address: e.target.value })
                  }
                  className="mt-0.5 w-full resize-y rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-[13px] text-text-primary transition-colors hover:border-border-strong focus:border-border-strong focus:outline-none"
                />
              )}
            </label>
          </div>
        </section>

        {/* -------------------------------------------------------- charges */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
              Charges
            </h3>
            {!locked && (
              <ChargeAdder
                direction={inv.trade_direction}
                onPick={(head) =>
                  void run(() =>
                    addLine(inv.id, {
                      position: (inv.lines?.length ?? 0) + 1,
                      description: head.label,
                      sac_code: head.sac,
                      unit: head.unit,
                      quantity: 1,
                      rate: 0,
                      tax_rate: 18,
                    })
                  )
                }
              />
            )}
          </div>

          <Lines
            lines={inv.lines ?? []}
            currency={inv.currency}
            locked={locked}
            onEdit={(id, p) => void run(() => updateLine(id, p))}
            onRemove={(id) => void run(() => removeLine(id))}
          />

          {/* ---- totals, next to the thing they total ---- */}
          <div className="mt-3 flex justify-end">
            <dl className="w-full max-w-xs space-y-1 text-[13px] sm:w-72">
              <div className="flex justify-between">
                <dt className="text-text-secondary">Taxable value</dt>
                <dd className="tabular-nums text-text-primary">
                  {money(inv.taxable_value)}
                </dd>
              </div>

              {inv.tax_treatment === "cgst_sgst" ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-text-secondary">CGST</dt>
                    <dd className="tabular-nums text-text-primary">
                      {money(inv.cgst_amount)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-secondary">SGST</dt>
                    <dd className="tabular-nums text-text-primary">
                      {money(inv.sgst_amount)}
                    </dd>
                  </div>
                </>
              ) : zeroRated ? (
                <div className="flex justify-between">
                  <dt className="text-text-secondary">Tax</dt>
                  <dd className="text-text-muted">
                    {inv.tax_treatment === "export_lut" ? "Zero rated" : "Exempt"}
                  </dd>
                </div>
              ) : (
                <div className="flex justify-between">
                  <dt className="text-text-secondary">IGST</dt>
                  <dd className="tabular-nums text-text-primary">
                    {money(inv.igst_amount)}
                  </dd>
                </div>
              )}

              <div className="flex justify-between border-t border-border pt-1.5">
                <dt className="font-medium text-text-primary">Total</dt>
                <dd className="text-[15px] font-medium tabular-nums text-text-primary">
                  {money(inv.total_amount)}
                </dd>
              </div>

              {(inv.lines ?? []).some((l) => l.currency !== "INR") && (
                <p className="pt-1 text-[11px] leading-relaxed text-text-muted">
                  Lines in more than one currency, so the invoice foots in rupees at the rate on
                  each line.
                </p>
              )}
              {tax > 0 && inv.tax_treatment === "cgst_sgst" && (
                <p className="pt-1 text-[11px] leading-relaxed text-text-muted">
                  One rate to the customer, two lines on the return.
                </p>
              )}
            </dl>
          </div>
        </section>

        {/* ------------------------------------------------------------ tax */}
        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            Tax treatment
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="min-w-0">
              <span className="block text-[11px] text-text-secondary">How it is taxed</span>
              {locked ? (
                <span className="block py-1 text-[13px] text-text-primary">
                  {TREATMENTS.find((t) => t.value === inv.tax_treatment)?.label}
                </span>
              ) : (
                <div className="mt-0.5">
                  <Select
                    label="Tax treatment"
                    value={inv.tax_treatment}
                    options={TREATMENTS.map((t) => ({
                      value: t.value,
                      label: t.label,
                      hint: t.hint,
                    }))}
                    onChange={(v) => patch({ tax_treatment: v as TaxTreatment })}
                  />
                </div>
              )}
            </div>

            <div className="min-w-0">
              <span className="block text-[11px] text-text-secondary">Place of supply</span>
              {locked ? (
                <span className="block py-1 text-[13px] text-text-primary">
                  {inv.place_of_supply || "—"}
                </span>
              ) : (
                <div className="mt-0.5">
                  <Select
                    label="Place of supply"
                    value={inv.place_of_supply_code ?? ""}
                    options={[
                      { value: "", label: "Not stated" },
                      ...STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` })),
                    ]}
                    onChange={(v) =>
                      patch({
                        place_of_supply_code: v || null,
                        place_of_supply: STATES.find((s) => s.code === v)?.name ?? null,
                      })
                    }
                  />
                </div>
              )}
            </div>

            <Text
              label="Country"
              value={inv.bill_to_country}
              disabled={locked}
              onCommit={(v) => patch({ bill_to_country: v })}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            Suggested from the customer's state against ours in Tamil Nadu, and editable — place of
            supply for the transport of goods depends on things this system does not hold.
          </p>
        </section>

        {/* -------------------------------------------- carried off the job */}
        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            From the shipment
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-surface-2 p-3 lg:grid-cols-4">
            <Carried label="Bill of lading" value={inv.bl_number} />
            <Carried label="B/L date" value={inv.bl_date} />
            <Carried label="Vessel / voyage" value={inv.vessel_voyage} />
            <Carried label="Movement" value={inv.movement_type} />
            <Carried label="Volume" value={inv.volume_cbm === null ? null : `${inv.volume_cbm} CBM`} />
            <Carried
              label="Gross weight"
              value={
                inv.gross_weight_kg === null
                  ? null
                  : `${inv.gross_weight_kg.toLocaleString("en-IN")} kg`
              }
            />
            <Carried label="Shipment" value={inv.shipment_id} />
            <Carried label="Enquiry" value={inv.enquiry_ref} />
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            Copied from the booking when this draft was started. Correct them on the shipment.
          </p>
        </section>

        {/* ----------------------------------------------------- dates etc. */}
        <section className="grid gap-3 sm:grid-cols-3">
          <Text
            label="Invoice date"
            type="date"
            value={inv.invoice_date}
            disabled={locked}
            onCommit={(v) => patch({ invoice_date: v })}
          />
          <Text
            label="Due date"
            type="date"
            value={inv.due_date ?? ""}
            disabled={locked}
            hint={inv.due_date ? undefined : "From the customer's payment terms, when set"}
            onCommit={(v) => patch({ due_date: v || null })}
          />
          <Text
            label="Description"
            value={inv.description}
            disabled={locked}
            placeholder="What this invoice covers"
            onCommit={(v) => patch({ description: v })}
          />
        </section>

        {/* ------------------------------------------------- the rest of it */}
        <section>
          <button
            type="button"
            onClick={() => setMore((m) => !m)}
            aria-expanded={more}
            className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary transition-colors hover:text-text-primary"
          >
            <ChevronDown size={13} className={more ? "rotate-180" : ""} />
            {more ? "Fewer details" : "More details"}
            <span className="text-text-muted">
              — attention, account of, bank, remarks, currency
            </span>
          </button>

          {more && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Text
                label="Attention"
                value={inv.attention}
                disabled={locked}
                placeholder="Who at that company"
                onCommit={(v) => patch({ attention: v })}
              />
              <Text
                label="Charges on account of"
                value={inv.account_of}
                disabled={locked}
                hint="When the charges sit on a party other than the one being billed"
                onCommit={(v) => patch({ account_of: v })}
              />
              <Text
                label="Our bank account"
                value={inv.bank_account}
                disabled={locked}
                placeholder="Where payment should reach"
                onCommit={(v) => patch({ bank_account: v })}
              />
              <Text
                label="Free-time extension granted to"
                type="date"
                value={inv.extension_date ?? ""}
                disabled={locked}
                onCommit={(v) => patch({ extension_date: v || null })}
              />
              <Text
                label="Default currency for new charges"
                value={inv.currency}
                disabled={locked}
                mono
                hint="Each charge carries its own; this is only what a new one starts in"
                onCommit={(v) => patch({ currency: v.toUpperCase() || "INR" })}
              />
              <label className="block sm:col-span-2">
                <span className="block text-[11px] text-text-secondary">Remarks</span>
                {locked ? (
                  <span className="block whitespace-pre-wrap py-1 text-[13px] text-text-primary">
                    {inv.remarks || "—"}
                  </span>
                ) : (
                  <textarea
                    defaultValue={inv.remarks}
                    rows={2}
                    onBlur={(e) =>
                      e.target.value !== inv.remarks && patch({ remarks: e.target.value })
                    }
                    className="mt-0.5 w-full resize-y rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-[13px] text-text-primary transition-colors hover:border-border-strong focus:border-border-strong focus:outline-none"
                  />
                )}
              </label>
              <label className="flex items-start gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={inv.show_can_details}
                  disabled={locked}
                  onChange={(e) => patch({ show_can_details: e.target.checked })}
                  className="mt-0.5 size-3.5 accent-[var(--brand)]"
                />
                <span className="text-[12px] text-text-secondary">
                  Print the cargo arrival notice detail on the document
                </span>
              </label>
            </div>
          )}
        </section>
      </div>

      {/* ----------------------------------------------------------- actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-4 py-3">
        {inv.status === "draft" && (
          <button
            onClick={() => {
              setBusy(true);
              void run(() => issueInvoice(inv.id)).finally(() => setBusy(false));
            }}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            Issue this invoice
          </button>
        )}

        {inv.status !== "cancelled" &&
          (confirmCancel ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-text-secondary">
                {inv.number
                  ? `Cancel ${inv.number}? The number stays spent — a gap in the series has to be explainable.`
                  : "Cancel this draft?"}
              </span>
              <button
                onClick={() => {
                  setBusy(true);
                  void run(() => cancelInvoice(inv.id, "")).finally(() => {
                    setBusy(false);
                    setConfirmCancel(false);
                  });
                }}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-text-danger px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                Yes, cancel it
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                className="h-8 rounded-lg px-2 text-[12px] text-text-secondary hover:text-text-primary"
              >
                Keep it
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmCancel(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[13px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              <Ban size={13} />
              Cancel invoice
            </button>
          ))}

        {(inv.status === "issued" || inv.status === "part_paid") && (
          <button
            onClick={() => {
              setBusy(true);
              startPayment({ direction: "in", customerId: inv.customer_id, invoiceId: inv.id })
                // Carry which draft was made, so the receipts page opens that
                // one rather than landing you in a list to search.
                .then((p) => navigate("/receipts", { state: { openId: p.id } }))
                .catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : "Could not open a receipt.")
                )
                .finally(() => setBusy(false));
            }}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <HandCoins size={14} />}
            Record a receipt
          </button>
        )}

        {inv.status === "draft" && (
          <span className="ml-auto text-[11px] text-text-muted">
            Nothing is numbered or sent until you issue it.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Adding a charge by picking the head, not by typing it.
 *
 * A blank description box is how one customer ends up with "Doc charges",
 * "Documentation" and "DOC FEE" across three invoices — and how the SAC comes
 * out different each time too. The head carries its own code and unit.
 */
function ChargeAdder({
  onPick,
  direction,
}: {
  onPick: (h: ChargeHead) => void;
  direction: Invoice["trade_direction"];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const heads = chargeHeadsFor(direction);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
      >
        <Plus size={13} />
        Add a charge
      </button>
      {open && (
        <ul className="absolute right-0 z-30 mt-1 max-h-80 w-72 overflow-y-auto rounded-lg border border-border-strong bg-surface-1 py-1 shadow-lg">
          {direction && (
            <li className="border-b border-border px-2.5 pb-1.5 pt-1 text-[11px] text-text-muted">
              What applies on {DIRECTION_LABEL[direction].toLowerCase()}
            </li>
          )}
          {heads.map((h) => (
            <li key={h.label}>
              <button
                onClick={() => {
                  onPick(h);
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-surface-2"
              >
                <span className="text-text-primary">{h.label}</span>
                <span className="shrink-0 font-mono text-[11px] text-text-muted">{h.sac}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Lines({
  lines,
  currency,
  locked,
  onEdit,
  onRemove,
}: {
  lines: InvoiceLine[];
  currency: string;
  locked: boolean;
  onEdit: (id: string, patch: Partial<InvoiceLine>) => void;
  onRemove: (id: string) => void;
}) {
  if (lines.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12px] text-text-muted">
        No charges yet. An invoice cannot be issued without at least one.
      </p>
    );
  }

  /**
   * Show the conversion columns only when something needs converting.
   *
   * A wholly-rupee invoice is the ordinary case, and carrying two dead columns
   * for it pushes the amount — the thing anybody reads a charge line for —
   * behind a horizontal scrollbar. The currency picker stays, so the moment a
   * line is switched to dollars both columns appear.
   */
  const anyFx = lines.some((l) => l.currency !== "INR");

  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-[13px] ${anyFx ? "min-w-[58rem]" : "min-w-[44rem]"}`}>
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
            <th className="w-[15rem] py-1.5 pr-2 font-medium">Charge</th>
            <th className="py-1.5 pr-2 font-medium">SAC</th>
            <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
            <th className="py-1.5 pr-2 font-medium">Unit</th>
            <th className="py-1.5 pr-2 text-right font-medium">Rate</th>
            <th className="py-1.5 pr-2 font-medium">Cur</th>
            {anyFx && <th className="py-1.5 pr-2 text-right font-medium">Rate to INR</th>}
            <th className="py-1.5 pr-2 text-right font-medium">Tax</th>
            <th className="py-1.5 pr-2 text-right font-medium">Amount</th>
            {anyFx && <th className="py-1.5 pr-2 text-right font-medium">Amount (INR)</th>}
            {!locked && <th className="w-8" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="py-1.5 pr-2">
                <Cell
                  value={l.description}
                  locked={locked}
                  onCommit={(v) => onEdit(l.id, { description: v })}
                />
                {l.is_reimbursement && (
                  <span className="text-[11px] text-text-muted">
                    Recovered at cost — carries no tax
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-2">
                <Cell
                  value={l.sac_code ?? ""}
                  locked={locked}
                  mono
                  width="w-20"
                  onCommit={(v) => onEdit(l.id, { sac_code: v || null })}
                />
              </td>
              <td className="py-1.5 pr-2 text-right">
                <Cell
                  value={String(l.quantity)}
                  locked={locked}
                  align="right"
                  width="w-16"
                  onCommit={(v) => onEdit(l.id, { quantity: Number(v) || 0 })}
                />
              </td>
              <td className="py-1.5 pr-2">
                {locked ? (
                  <span className="text-text-secondary">{l.unit || "—"}</span>
                ) : (
                  <Select
                    label="Unit"
                    className="w-28"
                    value={l.unit}
                    options={UNITS.map((u) => ({ value: u, label: u }))}
                    onChange={(v) => onEdit(l.id, { unit: v })}
                  />
                )}
              </td>
              <td className="py-1.5 pr-2 text-right">
                <Cell
                  value={String(l.rate)}
                  locked={locked}
                  align="right"
                  width="w-24"
                  onCommit={(v) => onEdit(l.id, { rate: Number(v) || 0 })}
                />
              </td>
              <td className="py-1.5 pr-2">
                {locked ? (
                  <span className="font-mono text-text-secondary">{l.currency}</span>
                ) : (
                  <Select
                    label="Currency"
                    className="w-24"
                    value={l.currency}
                    options={LINE_CURRENCIES.map((c) => ({ value: c, label: c }))}
                    onChange={(v) =>
                      // A rupee line has no conversion, so switching back to INR
                      // puts the rate to par rather than leaving a stale one on it.
                      onEdit(l.id, { currency: v, ...(v === "INR" ? { fx_rate: 1 } : {}) })
                    }
                  />
                )}
              </td>
              {anyFx && (
                <td className="py-1.5 pr-2 text-right">
                  {l.currency === "INR" ? (
                    <span className="text-text-muted">—</span>
                  ) : (
                    <Cell
                      value={String(l.fx_rate)}
                      locked={locked}
                      align="right"
                      width="w-20"
                      onCommit={(v) => Number(v) > 0 && onEdit(l.id, { fx_rate: Number(v) })}
                    />
                  )}
                </td>
              )}
              <td className="py-1.5 pr-2 text-right">
                {l.is_reimbursement ? (
                  <span className="text-text-muted">—</span>
                ) : (
                  <Cell
                    value={String(l.tax_rate)}
                    locked={locked}
                    align="right"
                    width="w-14"
                    suffix="%"
                    onCommit={(v) => onEdit(l.id, { tax_rate: Number(v) || 0 })}
                  />
                )}
              </td>
              <td
                className={`py-1.5 pr-2 text-right tabular-nums ${
                  anyFx ? "text-text-secondary" : "font-medium text-text-primary"
                }`}
              >
                {money(l.amount, l.currency)}
              </td>
              {anyFx && (
                <td className="py-1.5 pr-2 text-right font-medium tabular-nums text-text-primary">
                  {money(l.amount_inr)}
                </td>
              )}
              {!locked && (
                <td className="py-1.5">
                  <button
                    onClick={() => onRemove(l.id)}
                    aria-label={`Remove ${l.description || "this charge"}`}
                    className="grid size-7 place-items-center rounded-lg text-text-muted transition-colors hover:bg-bg-danger hover:text-text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One editable cell in the charge table. */
function Cell({
  value,
  onCommit,
  locked,
  mono,
  align,
  width,
  suffix,
}: {
  value: string;
  onCommit: (v: string) => void;
  locked: boolean;
  mono?: boolean;
  align?: "right";
  width?: string;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (locked) {
    return (
      <span className={`${mono ? "font-mono " : ""}text-text-primary`}>
        {value || "—"}
        {value && suffix}
      </span>
    );
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      className={`h-7 rounded border border-transparent bg-transparent px-1.5 text-[13px] text-text-primary transition-colors hover:border-border focus:border-border-strong focus:bg-surface-1 focus:outline-none ${
        width ?? "w-full"
      } ${align === "right" ? "text-right tabular-nums" : ""} ${mono ? "font-mono" : ""}`}
    />
  );
}
