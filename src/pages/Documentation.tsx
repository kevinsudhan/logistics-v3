import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import { AlertCircle, FileCheck2, FileText, RefreshCw } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { DOCUMENTS } from "../lib/documents";
import {
  listEnquiries,
  listShipments,
  STATUS_LABEL,
  SHIPMENT_STAGE_LABEL,
  type Customer,
  type Enquiry,
  type Shipment,
} from "../services/enquiries";

/**
 * The documentation desk.
 *
 * ---------------------------------------------------------------------------
 * TWO HALVES, BOTH REAL
 *
 * The page used to flat-map over the mock shipments array looking for documents
 * marked missing or generated. The array is empty, so it rendered two headings,
 * the words "Nothing outstanding", and a button that generated nothing — a
 * clean bill of health issued by a page attached to no data.
 *
 * What it shows instead is two things that are both true. The upper half is the
 * document set this CRM can actually issue, read from the registry that renders
 * them, with what each one needs before it will print as final rather than as a
 * draft. The lower half is the live cases those documents would be issued
 * against, from the real tables.
 *
 * Documents are produced from a case file, where the record and its gaps are
 * both in front of you, so this page routes there rather than growing a second
 * generate button with less context behind it.
 * ---------------------------------------------------------------------------
 */

type Row = Enquiry & { customer: Customer | null };

export default function Documentation() {
  const [enquiries, setEnquiries] = useState<Row[]>([]);
  const [shipments, setShipments] = useState<Array<Shipment & { customer: Customer | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, s] = await Promise.all([listEnquiries(), listShipments()]);
      setEnquiries(e);
      setShipments(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load cases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shippedRefs = new Set(shipments.map((s) => s.enquiry_ref));

  return (
    <div>
      <PageHeader
        title="Documentation"
        subtitle="What the desk can issue, and the cases it can be issued against. Every document is produced from one record — nothing is carried over from a similar shipment."
        action={
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      />

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
        Documents this desk issues
        <span className="ml-2 text-text-muted normal-case tracking-normal font-normal">
          {DOCUMENTS.length} in the set
        </span>
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-8">
        {DOCUMENTS.map((spec) => (
          <div key={spec.id} className="card p-4">
            <div className="flex items-start gap-2">
              <FileText size={14} className="mt-0.5 shrink-0 text-text-muted" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text-primary">{spec.shortName}</p>
                <p className="mt-0.5 text-[12px] text-text-secondary leading-snug">{spec.purpose}</p>
              </div>
            </div>
            <p className="mt-2.5 text-[11px] text-text-muted leading-relaxed">
              Needs {spec.requires.length} field{spec.requires.length === 1 ? "" : "s"} before it
              prints as final.
            </p>
          </div>
        ))}
      </div>

      <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
        Cases you can issue against
      </h2>

      {loading && !enquiries.length ? (
        <p className="text-[13px] text-text-muted py-6">Loading…</p>
      ) : !enquiries.length ? (
        <EmptyState
          icon={FileCheck2}
          title="No cases open"
          hint="Documents are issued from a case file. Once an enquiry exists, it appears here with its document set ready to generate."
          action={
            <Link
              to="/enquiries"
              className="inline-flex items-center h-8 px-3 rounded-lg border border-border-strong bg-surface-1 text-[12px] font-medium text-text-primary hover:bg-surface-2 transition-colors"
            >
              Go to enquiries
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          {enquiries.map((r) => (
            <EnquiryLink
              key={r.ref}
              to={`/enquiries/${r.ref}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 card px-3 sm:px-4 py-3 hover:border-border-strong transition-colors"
            >
              <span className="font-mono text-[12px] text-text-accent shrink-0">{r.ref}</span>
              <span className="min-w-0 flex-1 basis-40">
                <span className="block text-[13px] text-text-primary truncate">
                  {r.customer?.company || r.customer?.name || "Unnamed caller"}
                </span>
                <span className="block text-[12px] text-text-secondary truncate">
                  {[r.origin, r.destination].filter(Boolean).join(" → ") || "Route not captured"}
                  {r.cargo ? ` · ${r.cargo}` : ""}
                </span>
              </span>
              <span className="text-[11px] text-text-muted shrink-0">
                {shippedRefs.has(r.ref)
                  ? SHIPMENT_STAGE_LABEL[shipments.find((s) => s.enquiry_ref === r.ref)!.stage]
                  : STATUS_LABEL[r.status]}
              </span>
              <span className="text-[11px] text-text-accent shrink-0">Open documents →</span>
            </EnquiryLink>
          ))}
        </div>
      )}
    </div>
  );
}
