import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Download, Wallet } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import AgeingTable from "../../components/AgeingTable";
import { downloadWorkbook, stamped } from "../../lib/xlsx";
import { money } from "../../services/billing";
import { BUCKETS, BUCKET_LABEL, receivablesAgeing, type AgedRow } from "../../services/reports";
import { PageSkeleton } from "../../components/Loading";

/**
 * What customers owe us, aged.
 *
 * The one report a desk reads every morning, so it is a page rather than a
 * filter buried behind a menu. TDS counts as settled — the customer remitted it
 * to the government against our PAN, and counting it as outstanding would leave
 * every invoice a customer deducted tax on sitting here short for ever.
 */
export default function Outstanding() {
  const [rows, setRows] = useState<AgedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await receivablesAgeing()).rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the ageing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <PageSkeleton />;

  const total = rows.reduce((t, r) => t + r.total, 0);
  const over90 = rows.reduce((t, r) => t + r.buckets.d90plus, 0);

  return (
    <div>
      <PageHeader
        title="Outstanding"
        subtitle="What customers owe us, and how long they have owed it."
        action={
          <button
            onClick={() =>
              downloadWorkbook(stamped("outstanding"), [
                {
                  name: "Ageing",
                  columns: [
                    { header: "Customer", width: 34 },
                    ...BUCKETS.map((b) => ({ header: BUCKET_LABEL[b], width: 14 })),
                    { header: "Total", width: 14 },
                    { header: "Oldest (days)", width: 13 },
                  ],
                  rows: rows.map((r) => [
                    r.label,
                    ...BUCKETS.map((b) => r.buckets[b]),
                    r.total,
                    r.oldestDays,
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
          icon={Wallet}
          title="Nothing outstanding"
          hint="Every issued invoice has been settled, or none has been issued yet."
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-3">
            <div className="card min-w-0 flex-1 p-4">
              <p className="text-[11px] text-text-secondary">Owed to us</p>
              <p className="mt-0.5 text-[19px] font-medium tabular-nums text-text-primary">
                {money(total)}
              </p>
              <p className="text-[11px] text-text-muted">
                across {rows.length} customer{rows.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="card min-w-0 flex-1 p-4">
              <p className="text-[11px] text-text-secondary">Over 90 days</p>
              <p
                className={`mt-0.5 text-[19px] font-medium tabular-nums ${
                  over90 > 0 ? "text-text-danger" : "text-text-muted"
                }`}
              >
                {money(over90)}
              </p>
              <p className="text-[11px] text-text-muted">
                {over90 > 0 ? "worth a telephone call" : "nothing that old"}
              </p>
            </div>
          </div>

          <AgeingTable rows={rows} partyHeading="Customer" />

          <p className="mt-2 max-w-prose text-[11px] leading-relaxed text-text-muted">
            TDS counts as settled: the customer remitted it to the government against our PAN
            rather than to us. An invoice with no agreed due date sits under “not yet due” rather
            than in the worst column on the strength of a blank field.
          </p>
        </>
      )}
    </div>
  );
}
