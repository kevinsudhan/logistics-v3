import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileText,
  ClipboardList,
  Inbox,
  PackageSearch,
  Plus,
  RefreshCw,
  Wallet,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import MetricCard from "../components/MetricCard";
import EmptyState from "../components/EmptyState";
import {
  arrivedAt,
  listEnquiries,
  listShipments,
  recentEvents,
  STATUS_LABEL,
  SHIPMENT_STAGE_LABEL,
  type Customer,
  type Enquiry,
  type EnquiryEvent,
  type Shipment,
} from "../services/enquiries";
import { countWaiting } from "../services/intake";
import { ListSkeleton } from "../components/Loading";

/**
 * The first screen after signing in.
 *
 * ---------------------------------------------------------------------------
 * EVERY FIGURE ON THIS PAGE IS COUNTED, NOT WRITTEN
 *
 * This page used to open with four headline metrics that were nulls rendered as
 * dashes, and below them a "recent activity" list of four hand-typed lines
 * about container numbers that had never existed — a certificate of origin
 * flagged missing, a booking locked, a vessel delayed nine hours. They read as
 * the system reporting on itself. They were a paragraph in a source file.
 *
 * Everything here now comes from a query. The counts are lengths of lists that
 * were fetched; the activity feed is the enquiry timeline, which is written by
 * the same code paths that change the records. When the desk is empty the page
 * says the desk is empty, which on a system whose entire claim is that it never
 * invents anything is the only opening screen it can honestly have.
 * ---------------------------------------------------------------------------
 */

type Row = Enquiry & { customer: Customer | null };

/** How each timeline event should read and colour in the feed. */
const EVENT_STYLE: Record<string, { label: string; className: string }> = {
  created: { label: "Opened", className: "bg-bg-accent text-text-accent" },
  field_updated: { label: "Updated", className: "bg-surface-2 text-text-secondary" },
  call: { label: "Call", className: "bg-bg-accent text-text-accent" },
  quote_sent: { label: "Quoted", className: "bg-bg-warning text-text-warning" },
  verbal_accept: { label: "Verbal yes", className: "bg-bg-warning text-text-warning" },
  accepted: { label: "Accepted", className: "bg-bg-success text-text-success" },
  declined: { label: "Declined", className: "bg-bg-danger text-text-danger" },
  promoted: { label: "In process", className: "bg-bg-success text-text-success" },
  promoted_from_intake: { label: "From queue", className: "bg-bg-accent text-text-accent" },
  partner_assigned: { label: "Partner", className: "bg-surface-2 text-text-secondary" },
};

function when(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function Overview() {
  const [enquiries, setEnquiries] = useState<Row[]>([]);
  const [shipments, setShipments] = useState<Array<Shipment & { customer: Customer | null }>>([]);
  const [events, setEvents] = useState<EnquiryEvent[]>([]);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, s, ev, w] = await Promise.all([
        listEnquiries(),
        listShipments(),
        recentEvents(8),
        countWaiting(),
      ]);
      setEnquiries(e);
      setShipments(s);
      setEvents(ev);
      setWaiting(w);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the desk.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const open = enquiries.filter((e) => e.status === "new" || e.status === "qualifying").length;
    const quoted = enquiries.filter((e) => e.status === "quoted").length;
    const accepted = enquiries.filter((e) => e.status === "accepted").length;
    const active = shipments.filter((s) => s.stage !== "delivered" && s.stage !== "cancelled");
    const booked = active.reduce((sum, s) => sum + (s.agreed_inr ?? 0), 0);
    return { open, quoted, accepted, active: active.length, booked };
  }, [enquiries, shipments]);

  /** The refs somebody is most likely to want next: newest first, capped. */
  const newest = useMemo(
    () =>
      [...enquiries]
        .sort((a, b) => arrivedAt(b).localeCompare(arrivedAt(a)))
        .slice(0, 4),
    [enquiries]
  );

  const nothingAtAll = !loading && !enquiries.length && !shipments.length && !waiting;

  return (
    <div>
      <PageHeader
        title="Ops overview"
        subtitle="Counted from the desk's own records. Nothing on this page is estimated or filled in."
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
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mb-3">
        {/* First, because it is the earliest stage and the one that goes stale
            fastest: something arrived and nobody has looked at it yet. */}
        <MetricCard
          label="Waiting in the queue"
          value={waiting}
          icon={ClipboardList}
          to="/intake"
          hint="Arrived, not yet a case"
        />
        <MetricCard
          label="Awaiting quote"
          value={stats.open}
          icon={Inbox}
          to="/enquiries"
          hint="New and qualifying"
        />
        <MetricCard
          label="Quoted, no answer"
          value={stats.quoted}
          icon={FileText}
          to="/enquiries"
          hint="Waiting on the customer"
        />
        <MetricCard
          label="Accepted in writing"
          value={stats.accepted}
          icon={CheckCircle2}
          to="/enquiries"
          hint="Ready to push to shipments"
        />
        <MetricCard
          label="Active shipments"
          value={stats.active}
          icon={PackageSearch}
          to="/shipments/in-process"
          hint="Booked through delivery"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 mb-6">
        <MetricCard
          label="Booked value, active"
          value={stats.booked ? `₹${stats.booked.toLocaleString("en-IN")}` : null}
          icon={Wallet}
          hint={
            stats.booked
              ? "Sum of agreed amounts on shipments not yet delivered"
              : "No agreed amount recorded on an active shipment"
          }
        />
      </div>

      {nothingAtAll ? (
        <EmptyState
          title="The desk is empty"
          hint="Nothing has reached the desk yet. Send an email through from the mail page, or capture one by hand in the enquiries queue."
          action={
            <Link
              to="/enquiries"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium transition-colors"
            >
              <Plus size={13} />
              New enquiry
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* ---- activity ---- */}
          <section className="lg:col-span-3">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
              Recent activity
            </h2>

            {loading && !events.length ? (
              <ListSkeleton rows={4} />
            ) : !events.length ? (
              <div className="card px-4 py-8 text-center">
                <p className="text-[13px] text-text-secondary">
                  Nothing has happened on an enquiry yet.
                </p>
              </div>
            ) : (
              <ol className="card divide-y divide-border overflow-hidden">
                {events.map((ev) => {
                  const style = EVENT_STYLE[ev.kind] ?? {
                    label: ev.kind.replace(/_/g, " "),
                    className: "bg-surface-2 text-text-secondary",
                  };
                  return (
                    <li key={ev.id}>
                      <EnquiryLink
                        to={`/enquiries/${ev.enquiry_ref}`}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2 transition-colors"
                      >
                        <span
                          className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${style.className}`}
                        >
                          {style.label}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] text-text-primary leading-snug">
                            {ev.summary}
                          </span>
                          <span className="mt-0.5 block font-mono text-[11px] text-text-muted">
                            {ev.enquiry_ref}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-text-muted tabular-nums">
                          {when(ev.at)}
                        </span>
                      </EnquiryLink>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* ---- newest enquiries ---- */}
          <section className="lg:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                Newest enquiries
              </h2>
              <Link
                to="/enquiries"
                className="inline-flex items-center gap-1 text-[11px] text-text-accent hover:underline"
              >
                All <ArrowRight size={11} />
              </Link>
            </div>

            {!newest.length ? (
              <div className="card px-4 py-8 text-center">
                <p className="text-[13px] text-text-secondary">No enquiries on the desk.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {newest.map((r) => (
                  <EnquiryLink
                    key={r.ref}
                    to={`/enquiries/${r.ref}`}
                    className="block card p-3.5 hover:border-border-strong transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-mono text-[11px] text-text-accent truncate">{r.ref}</p>
                      <span className="shrink-0 text-[11px] text-text-muted">
                        {when(arrivedAt(r))}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] font-medium text-text-primary truncate">
                      {r.customer?.company || r.customer?.name || "Unnamed caller"}
                    </p>
                    <p className="text-[12px] text-text-secondary truncate">
                      {[r.origin, r.destination].filter(Boolean).join(" → ") || "Route not captured"}
                    </p>
                    <p className="mt-1.5 text-[11px] text-text-muted">
                      {STATUS_LABEL[r.status]} · via {r.source}
                    </p>
                  </EnquiryLink>
                ))}
              </div>
            )}

            {shipments.length > 0 && (
              <>
                <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mt-5 mb-2">
                  Shipments moving
                </h2>
                <div className="space-y-2">
                  {shipments.slice(0, 3).map((s) => (
                    <Link
                      key={s.id}
                      to={`/shipments/${s.id}`}
                      className="block card p-3.5 hover:border-border-strong transition-colors"
                    >
                      <p className="font-mono text-[11px] text-text-accent truncate">
                        {s.bl_number ?? s.id}
                      </p>
                      <p className="mt-1 text-[13px] text-text-primary truncate">
                        {s.customer?.company || s.customer?.name || "—"}
                      </p>
                      <p className="text-[12px] text-text-secondary truncate">
                        {[s.origin, s.destination].filter(Boolean).join(" → ") || "Route not set"}
                        {" · "}
                        {SHIPMENT_STAGE_LABEL[s.stage]}
                      </p>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
