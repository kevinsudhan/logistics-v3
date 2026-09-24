import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Download, ListChecks } from "lucide-react";
import PageHeader from "./PageHeader";
import EmptyState from "./EmptyState";
import { downloadWorkbook, stamped } from "../lib/xlsx";
import { money } from "../services/billing";
import { settlementDetail, type SettlementLine } from "../services/reports";
import { ListSkeleton } from "./Loading";

/**
 * Every allocation, one row each.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A ROW PER ALLOCATION AND NOT PER RECEIPT
 *
 * Because a receipt settling three invoices is three facts, and the question
 * this report answers is always about one of them: which receipt cleared that
 * invoice, and how much of it was tax the customer withheld rather than money
 * that arrived.
 *
 * Rolled up to the receipt, TDS disappears into a difference between two
 * numbers and nobody can reconcile a single invoice against it.
 * ---------------------------------------------------------------------------
 */
export default function SettlementDetail({
  direction,
  title,
  subtitle,
  exportAs,
}: {
  direction: "in" | "out";
  title: string;
  subtitle: string;
  exportAs: string;
}) {
  const [rows, setRows] = useState<SettlementLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await settlementDetail(direction));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the detail.");
    } finally {
      setLoading(false);
    }
  }, [direction]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () => ({
      cash: rows.reduce((t, r) => t + r.cash, 0),
      tds: rows.reduce((t, r) => t + r.tds, 0),
      settled: rows.reduce((t, r) => t + r.settled, 0),
    }),
    [rows]
  );

  if (loading) return <ListSkeleton avatar={false} />;

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        action={
          <button
            onClick={() =>
              downloadWorkbook(stamped(exportAs), [
                {
                  name: direction === "in" ? "Receipts" : "Payments",
                  columns: [
                    { header: direction === "in" ? "Receipt" : "Payment", width: 18 },
                    { header: "Date", width: 12 },
                    { header: "Party", width: 30 },
                    { header: "Mode", width: 15 },
                    { header: "Instrument", width: 18 },
                    { header: direction === "in" ? "Invoice" : "Bill", width: 18 },
                    { header: "Document date", width: 13 },
                    { header: "Shipment", width: 16 },
                    { header: "Cash", width: 14 },
                    { header: "TDS", width: 12 },
                    { header: "Settled", width: 14 },
                  ],
                  rows: rows.map((r) => [
                    r.payment_number,
                    new Date(r.payment_date + "T00:00:00"),
                    r.party,
                    r.mode,
                    r.instrument,
                    r.document,
                    r.document_date ? new Date(r.document_date + "T00:00:00") : null,
                    r.shipment_id,
                    r.cash,
                    r.tds,
                    r.settled,
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

      {rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={direction === "in" ? "Nothing received yet" : "Nothing paid out yet"}
          hint={
            direction === "in"
              ? "Each line here is one invoice cleared by one receipt. Record a receipt from Receipts, or from an unpaid invoice."
              : "Each line here is one bill cleared by one payment. Record a payment from Payments."
          }
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-3">
            <div className="card min-w-0 flex-1 p-4">
              <p className="text-[11px] text-text-secondary">
                {direction === "in" ? "Cash received" : "Cash paid"}
              </p>
              <p className="mt-0.5 text-[19px] font-medium tabular-nums text-text-primary">
                {money(totals.cash)}
              </p>
              <p className="text-[11px] text-text-muted">
                {rows.length} allocation{rows.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="card min-w-0 flex-1 p-4">
              <p className="text-[11px] text-text-secondary">TDS withheld</p>
              <p className="mt-0.5 text-[19px] font-medium tabular-nums text-text-primary">
                {money(totals.tds)}
              </p>
              <p className="text-[11px] text-text-muted">
                {totals.tds > 0 ? "never reached the bank" : "none recorded"}
              </p>
            </div>
            <div className="card min-w-0 flex-1 p-4">
              <p className="text-[11px] text-text-secondary">Documents reduced by</p>
              <p className="mt-0.5 text-[19px] font-medium tabular-nums text-text-primary">
                {money(totals.settled)}
              </p>
              <p className="text-[11px] text-text-muted">cash plus withheld tax</p>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[52rem] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                  <th className="px-4 py-2 font-medium">{direction === "in" ? "Receipt" : "Payment"}</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Party</th>
                  <th className="px-4 py-2 font-medium">How</th>
                  <th className="px-4 py-2 font-medium">{direction === "in" ? "Invoice" : "Bill"}</th>
                  <th className="px-4 py-2 font-medium">Shipment</th>
                  <th className="px-4 py-2 text-right font-medium">Cash</th>
                  <th className="px-4 py-2 text-right font-medium">TDS</th>
                  <th className="px-4 py-2 text-right font-medium">Settled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-mono text-[12px] text-text-primary">
                      {r.payment_number ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-text-secondary">{r.payment_date}</td>
                    <td className="px-4 py-2 text-text-primary">{r.party ?? "—"}</td>
                    <td className="px-4 py-2 text-text-secondary">
                      {r.mode}
                      {r.instrument && (
                        <span className="ml-1 font-mono text-[11px] text-text-muted">
                          {r.instrument}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-[12px] text-text-secondary">
                      {r.document ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-text-muted">
                      {r.shipment_id ? (
                        <Link
                          to={`/shipments/${r.shipment_id}`}
                          className="text-text-accent hover:underline"
                        >
                          {r.shipment_id}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                      {money(r.cash)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-muted">
                      {r.tds > 0 ? money(r.tds) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-text-primary">
                      {money(r.settled)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
