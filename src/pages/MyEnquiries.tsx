import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import { AlertCircle, RefreshCw, Truck, UserCheck } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import AssignControl from "../components/AssignControl";
import JobState, { STATE_LABEL, stateOf } from "../components/JobState";
import { useAuth } from "../lib/auth";
import {
  arrivedAt,
  listEnquiries,
  listPeople,
  listShipments,
  STATUS_LABEL,
  type Customer,
  type Enquiry,
  type EnquiryStatus,
  type Person,
  type Shipment,
} from "../services/enquiries";

/**
 * The enquiries this person took on.
 *
 * ---------------------------------------------------------------------------
 * A VIEW, NOT A COMPARTMENT
 *
 * Nothing here is private. Every row on this page is on the shared board too,
 * and every colleague can open it, read it and see whose it is. What this page
 * does is answer the only question an operator asks first thing in the morning:
 * of everything on the desk, which pieces are mine.
 *
 * That distinction matters for what happens when somebody is away. Their work
 * stays visible and an admin can hand any of it back to the board, because a
 * desk where one person's absence hides their customers is a desk that loses
 * them.
 * ---------------------------------------------------------------------------
 */

type Row = Enquiry & { customer: Customer | null };

const STATUS_TONE: Record<EnquiryStatus, string> = {
  new: "bg-bg-accent text-text-accent border-text-accent/25",
  qualifying: "bg-bg-accent text-text-accent border-text-accent/25",
  quoted: "bg-bg-warning text-text-warning border-text-warning/25",
  accepted: "bg-bg-success text-text-success border-text-success/25",
  declined: "bg-surface-2 text-text-secondary border-border-strong",
  lost: "bg-surface-2 text-text-muted border-border-strong",
};

/** The order somebody works through their own list: oldest claim first. */
const byClaimAge = (a: Row, b: Row) => (a.assigned_at ?? "").localeCompare(b.assigned_at ?? "");

function when(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function MyEnquiries() {
  const { session } = useAuth();
  const me = session?.userId ?? "";

  const [rows, setRows] = useState<Row[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [shipped, setShipped] = useState<Map<string, Shipment>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, ships, team] = await Promise.all([
        listEnquiries(),
        listShipments(),
        listPeople(),
      ]);
      setRows(list);
      setShipped(new Map(ships.map((s) => [s.enquiry_ref, s])));
      setPeople(team);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your enquiries.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = useMemo(
    () => rows.filter((r) => r.assigned_to === me).sort(byClaimAge),
    [rows, me]
  );

  /** What is actually waiting on this person, as opposed to on the customer. */
  const onMe = useMemo(
    () => mine.filter((r) => r.status === "new" || r.status === "qualifying"),
    [mine]
  );
  const waitingOnThem = useMemo(() => mine.filter((r) => r.status === "quoted"), [mine]);
  const ready = useMemo(
    () => mine.filter((r) => r.status === "accepted" && !shipped.has(r.ref)),
    [mine, shipped]
  );

  return (
    <div>
      <PageHeader
        title="My enquiries"
        subtitle="The ones you took on. Everything here is on the shared board too, so a colleague can always pick it up if you are away."
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

      {mine.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <Tally label="Waiting on you" value={onMe.length} hint="New and qualifying" />
          <Tally label="Waiting on them" value={waitingOnThem.length} hint="Quoted, no answer" />
          <Tally label="Ready to push" value={ready.length} hint="Accepted in writing" />
        </div>
      )}

      {loading && !rows.length ? (
        <p className="text-[13px] text-text-muted py-8">Loading…</p>
      ) : !mine.length ? (
        <EmptyState
          icon={UserCheck}
          title="You have not taken anything on"
          hint="Open the inbound board and press take this on next to an enquiry. It stays visible to everybody; it just becomes yours to move."
          action={
            <Link
              to="/enquiries"
              className="inline-flex items-center h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark text-white text-[12px] font-medium transition-colors"
            >
              Go to the inbound board
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          {mine.map((r) => (
            <article key={r.ref} className="card p-4">
              <EnquiryLink to={`/my-enquiries/${r.ref}`} className="block group">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[12px] text-text-accent">{r.ref}</p>
                    <p className="mt-0.5 text-[14px] font-medium text-text-primary group-hover:underline">
                      {r.customer?.company || r.customer?.name || "—"}
                    </p>
                    <p className="text-[12px] text-text-secondary">
                      {[r.origin, r.destination].filter(Boolean).join(" → ") || "Route not captured"}
                      {r.cargo ? ` · ${r.cargo}` : ""}
                      {r.volume_cbm ? ` · ${r.volume_cbm} CBM` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <span className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                        {STATE_LABEL[stateOf(shipped.get(r.ref))]}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status]}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </span>
                    <p className="mt-1 text-[11px] text-text-muted">
                      Came in {when(arrivedAt(r))}
                    </p>
                    <p className="text-[11px] text-text-muted">Taken {when(r.assigned_at)}</p>
                  </div>
                </div>
              </EnquiryLink>

              <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-2">
                <AssignControl
                  enquiryRef={r.ref}
                  assignedTo={r.assigned_to}
                  people={people}
                  meId={me}
                  isAdmin={session?.role === "admin"}
                  onChanged={() => void load()}
                  compact
                />

                {/*
                  The state this job is in, and the way to move it. Read off
                  whether a shipment exists and whether it has been delivered,
                  so the shared boards show the move without anything being
                  copied between them.
                */}
                <JobState
                  enquiry={r}
                  shipment={shipped.get(r.ref)}
                  onChanged={() => void load()}
                />

                {shipped.has(r.ref) && (
                  <Link
                    to={`/shipments/${shipped.get(r.ref)!.id}`}
                    className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary"
                  >
                    <Truck size={13} />
                    <span className="font-mono">{shipped.get(r.ref)!.id}</span>
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Tally({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="card p-3.5">
      <p className="text-[11px] uppercase tracking-wide font-medium text-text-secondary">{label}</p>
      <p className="mt-1 text-2xl leading-none font-medium text-text-primary tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 text-[11px] text-text-muted">{hint}</p>
    </div>
  );
}
