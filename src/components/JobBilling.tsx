import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, Loader2, Plus, Receipt } from "lucide-react";
import EmptyState from "./EmptyState";
import StatusPill from "./StatusPill";
import InvoiceEditor from "./InvoiceEditor";
import {
  KIND_LABEL,
  STATUS_LABEL,
  daysOverdue,
  listInvoicesForShipment,
  money,
  startInvoice,
  type Invoice,
  type InvoiceKind,
} from "../services/billing";
import { SectionSkeleton } from "./Loading";

/**
 * Everything billed against one job.
 *
 * ---------------------------------------------------------------------------
 * ONE COMPONENT, TWO PLACES
 *
 * This is mounted on the shipment's Invoices section and on the case file's
 * Billing section, because they are the same question asked from two sides of
 * the same job. Two implementations would drift, and the one that drifted would
 * be the one somebody was looking at when they got a number wrong.
 *
 * WHY RAISING ONE IS A SINGLE PRESS
 *
 * Because everything it needs is already recorded. The bill-to party comes off
 * the customer, the B/L and the tonnage off the shipment, the first charge line
 * off the accepted quote, the tax treatment off the two states involved, and
 * the number off a sequence at the moment of issue. There is nothing for a
 * person to retype, which is the entire difference between this and a screen
 * whose first required field is the number of the job you are already on.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  issued: "accent",
  part_paid: "warning",
  paid: "success",
  cancelled: "danger",
};

const KINDS: { kind: InvoiceKind; label: string; hint: string }[] = [
  { kind: "tax_invoice", label: "Tax invoice", hint: "The bill itself" },
  { kind: "proforma", label: "Proforma", hint: "Before the work — not a tax document" },
  { kind: "credit_note", label: "Credit note", hint: "To reduce something already billed" },
  { kind: "debit_note", label: "Debit note", hint: "To add to something already billed" },
];

export default function JobBilling({
  shipmentId,
  onChanged,
}: {
  shipmentId: string;
  onChanged?: () => void;
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await listInvoicesForShipment(shipmentId);
      setInvoices(rows);
      // A draft is what somebody came here to finish, so open it rather than
      // making them find it and click it.
      setOpenId((current) => current ?? rows.find((r) => r.status === "draft")?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the invoices.");
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function raise(kind: InvoiceKind) {
    setBusy(true);
    setError(null);
    setPicking(false);
    try {
      const inv = await startInvoice(shipmentId, kind);
      await load();
      setOpenId(inv.id);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the invoice.");
    } finally {
      setBusy(false);
    }
  }

  const refresh = () => {
    void load();
    onChanged?.();
  };

  if (loading) return <SectionSkeleton />;

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-text-secondary">
          {invoices.length === 0
            ? "Nothing billed on this job yet."
            : `${invoices.length} document${invoices.length === 1 ? "" : "s"} on this job.`}
        </p>

        <div className="relative">
          <button
            onClick={() => setPicking((p) => !p)}
            disabled={busy}
            aria-expanded={picking}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
            Raise a document
            <ChevronDown size={13} className={picking ? "rotate-180" : ""} />
          </button>

          {picking && (
            <ul className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-border-strong bg-surface-1 py-1 shadow-lg">
              {KINDS.map((k) => (
                <li key={k.kind}>
                  <button
                    onClick={() => void raise(k.kind)}
                    className="block w-full px-2.5 py-1.5 text-left hover:bg-surface-2"
                  >
                    <span className="block text-[12px] text-text-primary">{k.label}</span>
                    <span className="block text-[11px] text-text-muted">{k.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nothing billed yet"
          hint="Raising one fills in the customer, the B/L, the tonnage and the agreed amount from the booking. You add the charges and issue it."
        />
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => {
            const open = openId === inv.id;
            const over = daysOverdue(inv);

            return (
              <div key={inv.id}>
                <button
                  onClick={() => setOpenId(open ? null : inv.id)}
                  aria-expanded={open}
                  className={`card card-interactive flex w-full flex-wrap items-center gap-x-3 gap-y-2 p-3 text-left ${
                    open ? "rounded-b-none border-b-0" : ""
                  }`}
                >
                  <span className="font-mono text-[12px] font-medium text-text-primary">
                    {inv.number ?? "Draft"}
                  </span>
                  <StatusPill tone={TONE[inv.status]}>{STATUS_LABEL[inv.status]}</StatusPill>
                  {inv.kind !== "tax_invoice" && (
                    <StatusPill tone="neutral">{KIND_LABEL[inv.kind]}</StatusPill>
                  )}
                  {over !== null && over > 0 && (
                    <StatusPill tone="danger">{over} days overdue</StatusPill>
                  )}

                  <span className="text-[12px] text-text-muted">
                    {new Date(inv.invoice_date + "T00:00:00").toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>

                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-[14px] font-medium tabular-nums text-text-primary">
                      {money(inv.total_amount, inv.currency)}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {open && (
                  <InvoiceEditor invoiceId={inv.id} onChanged={refresh} nested />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
