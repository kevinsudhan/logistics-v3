import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Download, Scale } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import StatusPill from "../../components/StatusPill";
import { downloadWorkbook, stamped } from "../../lib/xlsx";
import { money } from "../../services/billing";
import { marginPct } from "../../services/bills";
import { finalBills, type FinalBillRow } from "../../services/reports";
import { PageSkeleton } from "../../components/Loading";

/**
 * Where every job ended up.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT I AM NOT SURE OF
 *
 * In the system this was modelled on, "Final Bill" sits between Invoice and
 * Receipts in the Accounts menu, and I only ever saw the menu entry — never the
 * screen. So this is a reading, not a copy.
 *
 * The reading: a job's closing position. Everything billed, everything it cost,
 * everything collected and everything paid out, and what is left on both sides.
 * That is the thing a desk needs before it calls a job finished, and nothing
 * else in this product answered it.
 *
 * If their Final Bill is instead a closing INVOICE — the last one raised when a
 * job completes, after provisional billing — that is a different feature and
 * this is not it. Say so and it becomes a kind on the invoice instead.
 *
 * WHY IT IS READ-ONLY
 *
 * Every figure here is a sum of documents that already exist. A screen that let
 * you type over them would be a second place for the truth to live.
 * ---------------------------------------------------------------------------
 */

const STAGE_TONE = (stage: string) =>
  stage === "delivered" ? "success" : stage === "cancelled" ? "danger" : "accent";

export default function FinalBill() {
  const [rows, setRows] = useState<FinalBillRow[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await finalBills());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the jobs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** A job is not finished while money is still moving either way. */
  const unsettled = (r: FinalBillRow) =>
    Math.abs(r.billed_inr - r.collected_inr) > 0.005 ||
    Math.abs(r.cost_inr - r.paid_out_inr) > 0.005 ||
    r.open_drafts > 0 ||
    r.unpaid_bills > 0 ||
    r.disputed_bills > 0;

  const shown = useMemo(
    () => (onlyOpen ? rows.filter(unsettled) : rows),
    [rows, onlyOpen]
  );

  if (loading) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Final bill"
        subtitle="Where each job ended up — billed against cost, collected against paid, and what is still moving."
        action={
          <button
            onClick={() =>
              downloadWorkbook(stamped("final-bill"), [
                {
                  name: "Jobs",
                  columns: [
                    { header: "Shipment", width: 16 },
                    { header: "Enquiry", width: 16 },
                    { header: "Customer", width: 30 },
                    { header: "Stage", width: 14 },
                    { header: "Billed", width: 14 },
                    { header: "Collected", width: 14 },
                    { header: "Still to collect", width: 14 },
                    { header: "Cost", width: 14 },
                    { header: "Paid out", width: 14 },
                    { header: "Still to pay", width: 14 },
                    { header: "Margin", width: 14 },
                    { header: "Open drafts", width: 11 },
                    { header: "Unpaid bills", width: 11 },
                    { header: "Disputed", width: 10 },
                  ],
                  rows: rows.map((r) => [
                    r.shipment_id,
                    r.enquiry_ref,
                    r.customer_label,
                    r.stage.replace(/_/g, " "),
                    r.billed_inr,
                    r.collected_inr,
                    r.billed_inr - r.collected_inr,
                    r.cost_inr,
                    r.paid_out_inr,
                    r.cost_inr - r.paid_out_inr,
                    r.billed_inr - r.cost_inr,
                    r.open_drafts,
                    r.unpaid_bills,
                    r.disputed_bills,
                  ]),
                },
              ])
            }
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

      <div className="mb-3 flex flex-wrap gap-1.5">
        {[
          { v: true, label: "Still moving" },
          { v: false, label: "Every job" },
        ].map((o) => (
          <button
            key={String(o.v)}
            onClick={() => setOnlyOpen(o.v)}
            className={`h-8 rounded-lg px-3 text-[12px] transition-colors ${
              onlyOpen === o.v
                ? "bg-brand font-medium text-white"
                : "border border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Scale}
          title={onlyOpen ? "Every job is settled" : "No jobs yet"}
          hint={
            onlyOpen
              ? "Nothing is waiting to be billed, collected or paid. Switch to every job to see the closed ones."
              : "A job appears here once an accepted enquiry becomes a shipment."
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[40rem] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 text-right font-medium">Billed</th>
                <th className="px-4 py-2 text-right font-medium">Collected</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
                <th className="px-4 py-2 text-right font-medium">Paid out</th>
                <th className="px-4 py-2 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => {
                const toCollect = r.billed_inr - r.collected_inr;
                const toPay = r.cost_inr - r.paid_out_inr;
                const margin = r.billed_inr - r.cost_inr;
                const pct = marginPct(r.billed_inr, r.cost_inr);

                const waiting: string[] = [];
                if (r.open_drafts) waiting.push(`${r.open_drafts} draft${r.open_drafts === 1 ? "" : "s"}`);
                if (toCollect > 0.005) waiting.push(`${money(toCollect)} to collect`);
                if (toPay > 0.005) waiting.push(`${money(toPay)} to pay`);
                if (r.disputed_bills) waiting.push(`${r.disputed_bills} disputed`);

                return (
                  <tr key={r.shipment_id}>
                    <td className="px-4 py-2">
                      <Link
                        to={`/shipments/${r.shipment_id}`}
                        className="font-mono text-[12px] text-text-accent hover:underline"
                      >
                        {r.shipment_id}
                      </Link>
                      <span className="ml-2 text-text-primary">{r.customer_label ?? "—"}</span>
                      <StatusPill tone={STAGE_TONE(r.stage)}>
                        {r.stage.replace(/_/g, " ")}
                      </StatusPill>
                      {/*
                        What the job is waiting on is a sentence, not a figure,
                        and as a seventh column it was the one pushed off the
                        edge — which is the one thing on the row somebody can
                        actually act on.
                      */}
                      <span className="mt-0.5 block text-[11px] text-text-muted">
                        {waiting.length ? waiting.join(" · ") : "nothing outstanding — settled"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                      {money(r.billed_inr)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                      {money(r.collected_inr)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                      {money(r.cost_inr)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                      {money(r.paid_out_inr)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-medium tabular-nums ${
                        margin < 0 ? "text-text-danger" : "text-text-primary"
                      }`}
                    >
                      {money(margin)}
                      {pct !== null && (
                        <span className="ml-1.5 text-[11px] font-normal text-text-muted">
                          {pct}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 max-w-prose text-[11px] leading-relaxed text-text-muted">
        Every figure here is a sum of documents that already exist, so there is nothing to type.
        Margin is what was billed less what the job cost — not what has been collected, which is a
        question about cash rather than about whether the job was worth doing.
      </p>
    </div>
  );
}
