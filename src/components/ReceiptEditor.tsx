import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Ban, Check, Loader2, Lock, Plus, Trash2, Wand2 } from "lucide-react";
import Select from "./Select";
import StatusPill from "./StatusPill";
import { money } from "../services/billing";
import {
  MODES_WITH_INSTRUMENT,
  MODE_LABEL,
  STATUS_LABEL,
  addAllocation,
  allocatedCash,
  cancelPayment,
  confirmPayment,
  getPayment,
  onAccount,
  openInvoicesFor,
  removeAllocation,
  settledTotal,
  spreadOldestFirst,
  updateAllocation,
  updatePayment,
  type OpenInvoice,
  type Payment,
  type PaymentMode,
} from "../services/receipts";
import { SectionSkeleton } from "./Loading";

/**
 * One receipt, or one payment out.
 *
 * ---------------------------------------------------------------------------
 * THE THREE COLUMNS THAT MATTER
 *
 * Outstanding, TDS, and applied. The reference system's grid has Amount, Amount
 * Received, TDS and Receipt Amount, and shows none of them against what is
 * actually still owed — so deciding what to type in the last column means doing
 * the subtraction in your head against a figure that is not on the screen.
 *
 * WHAT IS LEFT OVER IS NOT AN ERROR
 *
 * A receipt need not be fully applied. What is unapplied is an advance sitting
 * on the customer's account, and it is shown as that rather than as a warning.
 * Applying it later is adding a line here, which is why the lines stay editable
 * after the receipt is confirmed and the amount and date do not.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, "neutral" | "accent" | "success" | "danger"> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

function Text({
  label,
  value,
  onCommit,
  type = "text",
  disabled,
  placeholder,
  align,
  hint,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  type?: string;
  disabled?: boolean;
  placeholder?: string;
  align?: "right";
  hint?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <label className="block min-w-0">
      <span className="block text-[11px] text-text-secondary">{label}</span>
      {disabled ? (
        <span className="block truncate py-1 text-[13px] text-text-primary">{value || "—"}</span>
      ) : (
        <input
          type={type}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== value && onCommit(draft)}
          className={`mt-0.5 h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 text-[13px] text-text-primary transition-colors placeholder:text-text-muted hover:border-border-strong focus:border-border-strong focus:outline-none ${
            align === "right" ? "text-right tabular-nums" : ""
          }`}
        />
      )}
      {hint && <span className="mt-0.5 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  );
}

function Num({
  value,
  onCommit,
  locked,
  width = "w-24",
}: {
  value: number;
  onCommit: (n: number) => void;
  locked: boolean;
  width?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  if (locked) {
    return <span className="tabular-nums text-text-primary">{money(value)}</span>;
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft.replace(/,/g, ""));
        if (Number.isFinite(n) && n !== value) onCommit(n);
        else setDraft(String(value));
      }}
      className={`h-7 rounded border border-transparent bg-transparent px-1.5 text-right text-[13px] tabular-nums text-text-primary transition-colors hover:border-border focus:border-border-strong focus:bg-surface-1 focus:outline-none ${width}`}
    />
  );
}

export default function ReceiptEditor({
  paymentId,
  onChanged,
  nested,
}: {
  paymentId: string;
  onChanged?: () => void;
  nested?: boolean;
}) {
  const [pay, setPay] = useState<Payment | null>(null);
  const [open, setOpen] = useState<OpenInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await getPayment(paymentId);
      setPay(p);
      if (p?.customer_id) setOpen(await openInvoicesFor(p.customer_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load it.");
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        await load();
        onChanged?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not save.");
      }
    },
    [load, onChanged]
  );

  if (loading) return <SectionSkeleton lines={4} />;
  if (!pay) return <p className="py-6 text-[13px] text-text-muted">That receipt is not there.</p>;

  const isReceipt = pay.direction === "in";
  const draft = pay.status === "draft";
  const dead = pay.status === "cancelled";
  const applied = allocatedCash(pay);
  const spare = onAccount(pay);
  const settled = settledTotal(pay);
  const tds = settled - applied;

  const allocated = new Set((pay.allocations ?? []).map((a) => a.invoice_id));
  const addable = open.filter((o) => !allocated.has(o.invoice_id));

  /** Fill the lines from what is owed, oldest first. */
  const autoApply = () =>
    void run(async () => {
      const spread = spreadOldestFirst(spare, addable);
      for (const s of spread) await addAllocation(pay.id, s.invoice_id, s.amount);
      if (spread.length === 0) throw new Error("There is nothing outstanding to apply this to.");
    });

  return (
    <div className={`card overflow-hidden ${nested ? "rounded-t-none" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface-2 px-4 py-3">
        <span className="font-mono text-[13px] font-medium text-text-primary">
          {pay.number ?? "Not numbered yet"}
        </span>
        <StatusPill tone={TONE[pay.status]}>{STATUS_LABEL[pay.status]}</StatusPill>
        <StatusPill tone="neutral">{isReceipt ? "Money in" : "Money out"}</StatusPill>
        {!pay.number && (
          <span className="text-[11px] text-text-muted">
            Numbered when you confirm it, so an abandoned draft leaves no gap.
          </span>
        )}
        {!draft && !dead && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-text-muted">
            <Lock size={11} /> Confirmed — the amount and date are fixed, the lines are not
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 border-b border-border bg-bg-danger px-4 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-5 p-4">
        {/* ------------------------------------------------- what moved */}
        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Text
            label={isReceipt ? "Amount received" : "Amount paid"}
            value={String(pay.amount)}
            align="right"
            disabled={!draft}
            onCommit={(v) => {
              const n = Number(v.replace(/,/g, ""));
              if (Number.isFinite(n)) void run(() => updatePayment(pay.id, { amount: n }));
            }}
            hint="The cash that moved — TDS is not part of it"
          />
          <Text
            label="Date"
            type="date"
            value={pay.payment_date}
            disabled={!draft}
            onCommit={(v) => void run(() => updatePayment(pay.id, { payment_date: v }))}
          />
          <div className="min-w-0">
            <span className="block text-[11px] text-text-secondary">How</span>
            {draft ? (
              <div className="mt-0.5">
                <Select
                  label="Mode"
                  value={pay.mode}
                  options={Object.entries(MODE_LABEL).map(([value, label]) => ({ value, label }))}
                  onChange={(v) =>
                    void run(() => updatePayment(pay.id, { mode: v as PaymentMode }))
                  }
                />
              </div>
            ) : (
              <span className="block py-1 text-[13px] text-text-primary">
                {MODE_LABEL[pay.mode]}
              </span>
            )}
          </div>
          <Text
            label={isReceipt ? "Paid by, if not the customer" : "Paid to, if not the partner"}
            value={pay.paid_by}
            disabled={!draft}
            placeholder="Same"
            onCommit={(v) => void run(() => updatePayment(pay.id, { paid_by: v }))}
          />

          {MODES_WITH_INSTRUMENT.includes(pay.mode) && (
            <>
              <Text
                label={pay.mode === "cheque" ? "Cheque number" : "Reference"}
                value={pay.instrument_no}
                disabled={!draft}
                onCommit={(v) => void run(() => updatePayment(pay.id, { instrument_no: v }))}
              />
              <Text
                label="Drawn on"
                value={pay.drawn_on}
                disabled={!draft}
                placeholder="Bank"
                onCommit={(v) => void run(() => updatePayment(pay.id, { drawn_on: v }))}
              />
              <Text
                label="Instrument date"
                type="date"
                value={pay.instrument_date ?? ""}
                disabled={!draft}
                onCommit={(v) =>
                  void run(() => updatePayment(pay.id, { instrument_date: v || null }))
                }
              />
            </>
          )}
        </section>

        {/* ------------------------------------------- what it settles */}
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
              Applied to
            </h3>
            {!dead && (
              <div className="flex items-center gap-2">
                {spare > 0 && addable.length > 0 && (
                  <button
                    onClick={autoApply}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                  >
                    <Wand2 size={13} />
                    Apply {money(spare)} oldest first
                  </button>
                )}
                {addable.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setAdding((a) => !a)}
                      aria-expanded={adding}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                    >
                      <Plus size={13} />
                      Add an invoice
                    </button>
                    {adding && (
                      <ul className="absolute right-0 z-30 mt-1 max-h-72 w-80 overflow-y-auto rounded-lg border border-border-strong bg-surface-1 py-1 shadow-lg">
                        {addable.map((o) => (
                          <li key={o.invoice_id}>
                            <button
                              onClick={() => {
                                setAdding(false);
                                void run(() =>
                                  addAllocation(
                                    pay.id,
                                    o.invoice_id,
                                    Math.min(Math.max(spare, 0), o.outstanding)
                                  )
                                );
                              }}
                              className="flex w-full items-baseline justify-between gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-surface-2"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-mono text-text-primary">
                                  {o.number ?? "Draft"}
                                </span>
                                <span className="block text-[11px] text-text-muted">
                                  {o.shipment_id}
                                </span>
                              </span>
                              <span className="shrink-0 tabular-nums text-text-secondary">
                                {money(o.outstanding)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {(pay.allocations ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12px] text-text-muted">
              Nothing applied. All of it will sit on account as an advance until you apply it.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                    <th className="py-1.5 pr-2 font-medium">Invoice</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Invoice total</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Still owed</th>
                    <th className="py-1.5 pr-2 text-right font-medium">TDS withheld</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Applied</th>
                    {!dead && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(pay.allocations ?? []).map((a) => {
                    const o = open.find((x) => x.invoice_id === a.invoice_id);
                    // What this line leaves owing once it is applied.
                    const owed =
                      (o?.outstanding ?? Number(a.invoice?.total_amount ?? 0)) +
                      // The view already counts this line when confirmed, so add
                      // it back to show the position before this receipt.
                      (pay.status === "confirmed" ? a.amount + a.tds_amount : 0);

                    return (
                      <tr key={a.id}>
                        <td className="py-1.5 pr-2">
                          <span className="block font-mono text-text-primary">
                            {a.invoice?.number ?? "Draft"}
                          </span>
                          <span className="block text-[11px] text-text-muted">
                            {a.invoice?.shipment_id ?? ""}
                            {a.invoice?.bl_number ? ` · ${a.invoice.bl_number}` : ""}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">
                          {money(Number(a.invoice?.total_amount ?? 0))}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">
                          {money(owed)}
                        </td>
                        <td className="py-1.5 pr-2 text-right">
                          <Num
                            value={Number(a.tds_amount)}
                            locked={dead}
                            width="w-20"
                            onCommit={(n) => void run(() => updateAllocation(a.id, { tds_amount: n }))}
                          />
                        </td>
                        <td className="py-1.5 pr-2 text-right">
                          <Num
                            value={Number(a.amount)}
                            locked={dead}
                            onCommit={(n) => void run(() => updateAllocation(a.id, { amount: n }))}
                          />
                        </td>
                        {!dead && (
                          <td className="py-1.5">
                            <button
                              onClick={() => void run(() => removeAllocation(a.id))}
                              aria-label="Remove this line"
                              className="grid size-7 place-items-center rounded-lg text-text-muted transition-colors hover:bg-bg-danger hover:text-text-danger"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ---- where the money went ---- */}
          <div className="mt-3 flex justify-end">
            <dl className="w-full max-w-xs space-y-1 text-[13px] sm:w-72">
              <div className="flex justify-between">
                <dt className="text-text-secondary">Cash applied</dt>
                <dd className="tabular-nums text-text-primary">{money(applied)}</dd>
              </div>
              {tds > 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-secondary">TDS withheld</dt>
                  <dd className="tabular-nums text-text-primary">{money(tds)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-1.5">
                <dt className="font-medium text-text-primary">Invoices reduced by</dt>
                <dd className="font-medium tabular-nums text-text-primary">{money(settled)}</dd>
              </div>
              {spare > 0.005 && (
                <div className="flex justify-between rounded-lg bg-bg-warning px-2 py-1.5">
                  <dt className="text-text-warning">Left on account</dt>
                  <dd className="font-medium tabular-nums text-text-warning">{money(spare)}</dd>
                </div>
              )}
              {tds > 0 && (
                <p className="pt-1 text-[11px] leading-relaxed text-text-muted">
                  TDS never reached the bank — the payer remitted it against our PAN. It settles
                  the invoice all the same, which is why the invoice closes on {money(settled)}{" "}
                  when only {money(applied)} arrived.
                </p>
              )}
            </dl>
          </div>
        </section>

        <Text
          label="Remarks"
          value={pay.remarks}
          disabled={dead}
          onCommit={(v) => void run(() => updatePayment(pay.id, { remarks: v }))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-4 py-3">
        {draft && (
          <button
            onClick={() => {
              setBusy(true);
              void run(() => confirmPayment(pay.id)).finally(() => setBusy(false));
            }}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
            Confirm {isReceipt ? "receipt" : "payment"}
          </button>
        )}

        {!dead &&
          (confirmCancel ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-text-secondary">
                Cancel {pay.number ?? "this draft"}? Every invoice it settled goes back to unpaid.
              </span>
              <button
                onClick={() => {
                  setBusy(true);
                  void run(() => cancelPayment(pay.id)).finally(() => {
                    setBusy(false);
                    setConfirmCancel(false);
                  });
                }}
                className="inline-flex h-8 items-center rounded-lg bg-text-danger px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
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
              Cancel
            </button>
          ))}

        {draft && (
          <span className="ml-auto text-[11px] text-text-muted">
            Nothing is settled until you confirm it.
          </span>
        )}
      </div>
    </div>
  );
}
