import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import { AlertCircle, ChevronRight, RefreshCw, Truck } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../lib/auth";
import HandledBy, { OWNERSHIP, ownedBy, type Ownership } from "../components/HandledBy";
import {
  listPeople,
  listShipments,
  type Person,
  type ShipmentRow,
  SHIPMENT_STAGES,
  SHIPMENT_STAGE_LABEL,
  stageLabel,
  type ShipmentStage,
} from "../services/enquiries";

/** "2 Oct" — the list is read at a glance, the year is noise. */
const day = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;

/** Everything before delivery. Delivered shipments live on the completed page. */
const IN_PROCESS: ShipmentStage[] = SHIPMENT_STAGES.filter((s) => s !== "delivered");

export default function ShipmentsInProcess() {
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  // Everyone sees every shipment; this narrows to the ones that are
  // yours, or the ones nobody has picked up yet.
  const [owner, setOwner] = useState<Ownership>("all");
  const { session } = useAuth();
  const [filter, setFilter] = useState<ShipmentStage | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ships, who] = await Promise.all([listShipments(IN_PROCESS), listPeople()]);
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

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const s of IN_PROCESS) c[s] = rows.filter((r) => r.stage === s).length;
    return c;
  }, [rows]);

  const visible = rows.filter(
    (r) =>
      (filter === "all" || r.stage === filter) && ownedBy(r.assigned_to, owner, session?.userId)
  );

  return (
    <div>
      <PageHeader
        title="In-process shipments"
        subtitle="Bookings from acceptance through to delivery. Each one began as an enquiry the customer said yes to."
      />

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="opacity-60">{counts.all}</span>
        </Chip>
        {IN_PROCESS.filter((s) => counts[s] > 0).map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {SHIPMENT_STAGE_LABEL[s]} <span className="opacity-60">{counts[s]}</span>
          </Chip>
        ))}
        <span className="mx-2 h-4 w-px bg-border" aria-hidden="true" />
        {OWNERSHIP.map((o) => (
          <Chip key={o.key} active={owner === o.key} onClick={() => setOwner(o.key)}>
            {o.label}
            {o.key === "free" && (
              <span className="opacity-60">
                {" "}
                {rows.filter((r) => !r.assigned_to).length}
              </span>
            )}
          </Chip>
        ))}
        <button
          onClick={() => void load()}
          className="ml-auto flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {loading && !rows.length ? (
        <p className="text-[13px] text-text-muted py-8">Loading…</p>
      ) : !rows.length ? (
        <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <Truck size={20} className="mx-auto text-text-muted" />
          <p className="mt-2 text-[14px] font-medium text-text-primary">No shipments in process</p>
          <p className="mt-1 text-[13px] text-text-secondary max-w-md mx-auto">
            A shipment appears here when an accepted enquiry is pushed through from its case file.
          </p>
          <Link
            to="/enquiries"
            className="mt-4 inline-flex h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium items-center"
          >
            Go to enquiries
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((s) => (
            /*
              The card is no longer a Link.
              ------------------------------------------------------------------
              It carries the document panel now, and every control inside that —
              View, Generate, the disclosure — sat inside an anchor, where a
              click both opened the PDF and navigated away from the page that
              opened it. The reference is the link instead, which is also the
              more honest target: the row is a shipment, not a button.
            */
            <div key={s.id} className="card p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* The job opens the shipment; the enquiry is one click
                        further for anybody who needs the sales history. */}
                    <Link
                      to={`/shipments/${s.id}`}
                      className="font-mono text-[12px] text-text-accent hover:underline"
                    >
                      {s.id}
                    </Link>
                    <EnquiryLink
                      to={`/enquiries/${s.enquiry_ref}`}
                      className="font-mono text-[11px] text-text-muted hover:underline"
                    >
                      {s.enquiry_ref}
                    </EnquiryLink>
                    {s.bl_number && (
                      <span className="font-mono text-[11px] text-text-muted">{s.bl_number}</span>
                    )}
                    <HandledBy
                      assignedTo={s.assigned_to}
                      people={people}
                      meId={session?.userId}
                    />
                  </div>
                  <Link to={`/shipments/${s.id}`} className="group mt-0.5 block">
                    <p className="text-[14px] font-medium text-text-primary group-hover:underline">
                      {s.customer?.company || s.customer?.name || "—"}
                    </p>
                    <p className="text-[12px] text-text-secondary">
                      {[s.origin, s.destination].filter(Boolean).join(" → ") || "Route not recorded"}
                      {s.cargo ? ` · ${s.cargo}` : ""}
                      {s.volume_cbm ? ` · ${s.volume_cbm} CBM` : ""}
                    </p>
                  </Link>
                </div>
                <div className="flex shrink-0 items-start gap-3 text-right">
                  <div>
                    <span className="rounded-full bg-bg-accent px-2 py-0.5 text-[11px] font-medium text-text-accent">
                      {stageLabel(s.stage, s.transport_mode)}
                    </span>
                    <p className="mt-1 text-[11px] tabular-nums text-text-muted">
                      {s.etd || s.eta
                        ? [s.etd && `ETD ${day(s.etd)}`, s.eta && `ETA ${day(s.eta)}`].filter(Boolean).join(" · ")
                        : "No ETD yet"}
                    </p>
                    {(s.carrier || s.flight_number || s.vessel) && (
                      <p className="text-[11px] text-text-muted">
                        {[s.carrier, s.transport_mode === "air" ? s.flight_number : s.vessel]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <Link
                    to={`/shipments/${s.id}`}
                    className="mt-0.5 text-text-muted hover:text-text-primary"
                    aria-label={`Open ${s.id}`}
                  >
                    <ChevronRight size={16} />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] border transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-strong"
      }`}
    >
      {children}
    </button>
  );
}
