import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import { AlertCircle, PackageCheck, RefreshCw } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import { useAuth } from "../lib/auth";
import { useTableChanges } from "../lib/useTableChanges";
import HandledBy, { OWNERSHIP, ownedBy, type Ownership } from "../components/HandledBy";
import {
  listPeople,
  listShipments,
  type Person,
  type ShipmentRow,
} from "../services/enquiries";
import { ListSkeleton } from "../components/Loading";

/**
 * Delivered shipments, kept for history, billing and audit.
 *
 * Reads the real shipments table rather than the emptied mock module it used to
 * import, so the page shows what was actually delivered. Until the first
 * shipment reaches delivery this is empty, and says so.
 */
export default function ShipmentsCompleted() {
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  // The completed board is the desk's history, not one person's, so it
  // filters by owner rather than hiding other people's work.
  const [owner, setOwner] = useState<Ownership>("all");
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ships, who] = await Promise.all([listShipments(["delivered"]), listPeople()]);
      setRows(ships);
      setPeople(who);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load shipments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A job delivered or signed off elsewhere lands here without a reload.
  useTableChanges("shipments", null, () => void load());

  return (
    <div>
      <PageHeader
        title="Completed shipments"
        subtitle="Delivered shipments, kept for history, billing and audit."
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

      {loading && !rows.length ? (
        <ListSkeleton />
      ) : !rows.length ? (
        <EmptyState
          icon={PackageCheck}
          title="Nothing delivered yet"
          hint="A shipment moves here once its stage reaches delivered. Until then it stays on the in-process board."
          action={
            <Link
              to="/shipments/in-process"
              className="inline-flex items-center h-8 px-3 rounded-lg border border-border-strong bg-surface-1 text-[12px] font-medium text-text-primary hover:bg-surface-2 transition-colors"
            >
              See shipments in process
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {OWNERSHIP.filter((o) => o.key !== "free").map((o) => (
              <button
                key={o.key}
                onClick={() => setOwner(o.key)}
                className={`h-7 rounded-lg px-2.5 text-[12px] transition-colors ${
                  owner === o.key
                    ? "bg-brand font-medium text-white"
                    : "border border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {rows
            .filter((s) => ownedBy(s.assigned_to, owner, session?.userId))
            .map((s) => (
            <EnquiryLink
              key={s.id}
              to={`/enquiries/${s.enquiry_ref}`}
              className="block card p-4 hover:border-border-strong transition-colors"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-mono text-[12px] text-text-accent">{s.id}</p>
                    {s.bl_number && (
                      <span className="font-mono text-[11px] text-text-muted">{s.bl_number}</span>
                    )}
                    <HandledBy
                      assignedTo={s.assigned_to}
                      people={people}
                      meId={session?.userId}
                    />
                  </div>
                  <p className="mt-0.5 text-[14px] font-medium text-text-primary truncate">
                    {s.customer?.company || s.customer?.name || "—"}
                  </p>
                  <p className="text-[12px] text-text-secondary">
                    {[s.origin, s.destination].filter(Boolean).join(" → ")}
                    {s.carrier ? ` · ${s.carrier}` : ""}
                    {s.volume_cbm ? ` · ${s.volume_cbm} CBM` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <StatusPill tone="success">Delivered</StatusPill>
                  {/* Delivered is not closed: the sign-off (070) is operations
                      handing the job to accounts, and a job still waiting for
                      it is one somebody has to finish. */}
                  <p className={`mt-1 text-[11px] ${s.signed_off_at ? "text-text-success" : "text-text-warning"}`}>
                    {s.signed_off_at ? "Signed off" : "Awaiting sign-off"}
                  </p>
                  {s.agreed_inr !== null && (
                    <p className="mt-1 text-[12px] text-text-primary tabular-nums">
                      ₹{s.agreed_inr.toLocaleString("en-IN")}
                    </p>
                  )}
                  {s.eta && <p className="text-[11px] text-text-muted">Arrived {s.eta}</p>}
                </div>
              </div>
            </EnquiryLink>
          ))}
        </div>
      )}
    </div>
  );
}
