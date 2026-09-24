import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ChevronDown, Download, FileText } from "lucide-react";
import PageHeader from "./PageHeader";
import EmptyState from "./EmptyState";
import StatusPill from "./StatusPill";
import InvoiceEditor from "./InvoiceEditor";
import { invoiceSheets } from "../lib/exports";
import { downloadWorkbook, stamped } from "../lib/xlsx";
import {
  KIND_LABEL,
  STATUS_LABEL,
  daysOverdue,
  listInvoices,
  money,
  noteAdjustmentDeadline,
  type Invoice,
  type InvoiceKind,
} from "../services/billing";
import { supabase } from "../lib/supabase";
import { ListSkeleton } from "./Loading";

/**
 * One register, six pages.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE SHARE A COMPONENT
 *
 * A tax invoice, a proforma, a credit note, a debit note and their two overseas
 * cousins are one row shape with a different `kind` and a different party. The
 * reference system gives each its own screen, which is six places to fix a
 * rounding bug and five of them somebody forgets.
 *
 * What differs per page is what it is called, who it is addressed to, and
 * whether it can be raised from here at all — a note is raised from the invoice
 * it corrects, never from a blank page, because Rule 53(1A) wants that
 * invoice's number and date on it.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  issued: "accent",
  part_paid: "warning",
  paid: "success",
  cancelled: "danger",
};

export interface RegisterSpec {
  kind: InvoiceKind;
  /** Whose ledger this is. Customer documents and agent documents are separate pages. */
  party: "customer" | "partner";
  title: string;
  subtitle: string;
  /** Shown when there is nothing, and it explains where these come from. */
  emptyHint: string;
  /** Filename stem for the export. */
  exportAs: string;
}

export default function DocumentRegister({ spec }: { spec: RegisterSpec }) {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const all = await listInvoices({ kind: spec.kind, withLines: true });
      setRows(
        all.filter((i) =>
          spec.party === "partner" ? i.partner_id !== null : i.partner_id === null
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the register.");
    } finally {
      setLoading(false);
    }
  }, [spec.kind, spec.party]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const live = rows.filter((r) => r.status !== "cancelled" && r.status !== "draft");
    const drafts = rows.filter((r) => r.status === "draft");
    return {
      issued: live.reduce((t, r) => t + Number(r.total_inr || 0), 0),
      issuedCount: live.length,
      drafts: drafts.reduce((t, r) => t + Number(r.total_inr || 0), 0),
      draftCount: drafts.length,
    };
  }, [rows]);

  const isNote = spec.kind === "credit_note" || spec.kind === "debit_note";

  if (loading) return <ListSkeleton avatar={false} />;

  return (
    <div>
      <PageHeader
        title={spec.title}
        subtitle={spec.subtitle}
        action={
          <button
            onClick={() => downloadWorkbook(stamped(spec.exportAs), invoiceSheets(rows))}
            disabled={rows.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <Download size={14} />
            Excel
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="card min-w-0 flex-1 p-4">
            <p className="text-[11px] text-text-secondary">Issued</p>
            <p className="mt-0.5 text-[19px] font-medium tabular-nums text-text-primary">
              {money(totals.issued)}
            </p>
            <p className="text-[11px] text-text-muted">
              {totals.issuedCount} document{totals.issuedCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="card min-w-0 flex-1 p-4">
            <p className="text-[11px] text-text-secondary">In draft</p>
            <p className="mt-0.5 text-[19px] font-medium tabular-nums text-text-primary">
              {money(totals.drafts)}
            </p>
            <p className="text-[11px] text-text-muted">
              {totals.draftCount ? `${totals.draftCount} not yet issued` : "none open"}
            </p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={FileText} title={`No ${spec.title.toLowerCase()} yet`} hint={spec.emptyHint} />
      ) : (
        <div className="space-y-3">
          {rows.map((inv) => {
            const open = openId === inv.id;
            const over = daysOverdue(inv);

            // Section 34(2): past this date the note can still be issued, but
            // the tax cannot be adjusted in a return.
            const deadline = isNote && inv.original_date
              ? noteAdjustmentDeadline(inv.original_date)
              : null;
            const lateForTax = deadline !== null && new Date() > deadline;

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
                  {over !== null && over > 0 && (
                    <StatusPill tone="danger">{over} days overdue</StatusPill>
                  )}
                  {lateForTax && <StatusPill tone="warning">Past 30 Nov — commercial only</StatusPill>}

                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                    {inv.customer_label ?? inv.bill_to_name ?? "—"}
                  </span>

                  {inv.original_number && (
                    <span className="font-mono text-[11px] text-text-muted">
                      against {inv.original_number}
                    </span>
                  )}
                  {inv.shipment_id && (
                    <span className="font-mono text-[11px] text-text-muted">{inv.shipment_id}</span>
                  )}
                  <span className="text-[12px] text-text-muted">
                    {new Date(inv.invoice_date + "T00:00:00").toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-[14px] font-medium tabular-nums text-text-primary">
                      {money(inv.total_amount)}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {open && (
                  <>
                    {isNote && (
                      <div className="border-x border-border bg-surface-2 px-4 py-2.5">
                        <p className="text-[12px] text-text-secondary">
                          {inv.note_reason || <span className="text-text-muted">No reason recorded.</span>}
                        </p>
                        {deadline && (
                          <p className="mt-0.5 text-[11px] text-text-muted">
                            Declarable in a return until{" "}
                            {deadline.toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            })}
                            , or the day the annual return for that year is filed — whichever comes
                            first.
                          </p>
                        )}
                      </div>
                    )}
                    <InvoiceEditor invoiceId={inv.id} onChanged={load} nested />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isNote && (
        <p className="mt-4 max-w-prose text-[11px] leading-relaxed text-text-muted">
          A {spec.kind === "credit_note" ? "credit" : "debit"} note is raised from the invoice it
          corrects, on that invoice&rsquo;s own page, so its number and date come across —
          Rule 53(1A) requires both to be printed here. There is no way to raise one from a blank
          page, because a note that does not say what it corrects is not one.
        </p>
      )}
    </div>
  );
}

/** Shipments with an unissued draft, for the pages that want to point at them. */
export async function draftsPending(): Promise<number> {
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("status", "draft");
  return count ?? 0;
}
