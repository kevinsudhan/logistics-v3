import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, Check, CheckCircle2, FileSpreadsheet, Inbox, Loader2, Mail, PackageSearch, RefreshCw } from "lucide-react";
import PageHeader from "../components/PageHeader";
import PushToInbound from "../components/PushToInbound";
import { PageSkeleton } from "../components/Loading";
import { useAuth } from "../lib/auth";
import { failureText } from "../lib/errorText";
import { todayIST } from "../lib/progress";
import { istDay, periodText, presetRange, type Preset } from "../lib/enquiryRegister";
import { dayLabel } from "../lib/jobPnl";
import { downloadEnquiryRegister } from "../services/enquiryRegister";
import {
  INBOUND_STATUSES,
  SHIPMENT_STAGES,
  STATUS_LABEL,
  listEnquiries,
  listShipments,
  stageLabel,
  type Enquiry,
  type ShipmentRow,
  type ShipmentStage,
} from "../services/enquiries";
import { dismissIntake, listIntake, type Intake } from "../services/intake";

/**
 * Enquiries: where every one stands, and the register to take away.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE IS NOW
 *
 * It was a capture queue: everything that reached the desk waited here to be
 * pushed through to a reference. The desk does that from the mail itself, so
 * the queue was a stop nobody made. What the desk asks of this page instead
 * is how many enquiries are inbound, how many are shipments in process, how
 * many are completed — each a click from its own list — and the whole register
 * as one Excel file.
 *
 * The counts are the same cut as those lists: inbound is an enquiry with no
 * shipment yet (new, qualifying, quoted, accepted), in process is a shipment
 * not yet delivered, completed is one delivered. Declined, lost and cancelled
 * are said once, underneath, rather than hidden.
 *
 * Mail sent to the old queue and never pushed through is listed at the foot
 * until it is pushed or set aside, so none of it is lost with the page.
 * ---------------------------------------------------------------------------
 */

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "all", label: "All enquiries" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "fy", label: "This financial year" },
  { value: "custom", label: "Choose dates" },
];

const IN_PROCESS: ShipmentStage[] = SHIPMENT_STAGES.filter((s) => s !== "delivered");

export default function EnquiriesOverview() {
  const { session } = useAuth();
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [waiting, setWaiting] = useState<Intake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, s, w] = await Promise.all([listEnquiries(), listShipments(), listIntake("new").catch(() => [] as Intake[])]);
      setEnquiries(e);
      setShipments(s);
      setWaiting(w);
    } catch (x) {
      setError(failureText(x, "Could not load the enquiries.").message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const booked = new Set(shipments.map((s) => s.enquiry_ref));
    const notBooked = enquiries.filter((e) => !booked.has(e.ref));
    const inbound = notBooked.filter((e) => INBOUND_STATUSES.includes(e.status));
    const inProcess = shipments.filter((s) => IN_PROCESS.includes(s.stage));
    const completed = shipments.filter((s) => s.stage === "delivered");
    const month = todayIST().slice(0, 7);
    return {
      inbound,
      byStatus: INBOUND_STATUSES.map((st) => [st, inbound.filter((e) => e.status === st).length] as const),
      inProcess,
      byStage: IN_PROCESS.map((st) => [st, inProcess.filter((s) => s.stage === st).length] as const).filter(([, n]) => n > 0),
      completed,
      closed: completed.filter((s) => s.signed_off_at).length,
      declined: notBooked.filter((e) => e.status === "declined").length,
      lost: notBooked.filter((e) => e.status === "lost").length,
      cancelled: shipments.filter((s) => s.stage === "cancelled").length,
      newThisMonth: enquiries.filter((e) => istDay(e.received_at ?? e.opened_at).startsWith(month)).length,
      bookedThisMonth: shipments.filter((s) => istDay(s.created_at).startsWith(month)).length,
    };
  }, [enquiries, shipments]);

  if (loading && !enquiries.length && !shipments.length) return <PageSkeleton rows={3} />;

  const notProceeding = [
    stats.declined ? `${stats.declined} declined` : null,
    stats.lost ? `${stats.lost} lost` : null,
    stats.cancelled ? `${stats.cancelled} shipment${stats.cancelled === 1 ? "" : "s"} cancelled` : null,
  ].filter(Boolean);

  return (
    <div>
      <PageHeader
        title="Enquiries"
        subtitle="Where every enquiry stands — inbound, in process and completed — and the whole register as one Excel file."
        action={
          <button
            type="button"
            onClick={() => void load()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      />

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <StageCard
          icon={Inbox}
          title="Inbound"
          count={stats.inbound.length}
          note="Enquiries not yet booked"
          to="/enquiries"
          linkText="Open inbound enquiries"
          rows={stats.byStatus.map(([st, n]) => [st === "accepted" ? "Accepted — to be booked" : STATUS_LABEL[st], n])}
        />
        <StageCard
          icon={PackageSearch}
          title="In process"
          count={stats.inProcess.length}
          note="Shipments booked, not yet delivered"
          to="/shipments/in-process"
          linkText="Open in-process shipments"
          rows={stats.byStage.map(([st, n]) => [stageLabel(st, null), n])}
          empty="Nothing under way."
        />
        <StageCard
          icon={CheckCircle2}
          title="Completed"
          count={stats.completed.length}
          note="Shipments delivered"
          to="/shipments/completed"
          linkText="Open completed shipments"
          rows={[
            ["Closed (signed off)", stats.closed],
            ["Delivered, not yet closed", stats.completed.length - stats.closed],
          ]}
          extra={
            stats.completed.length - stats.closed > 0 ? (
              <Link to="/job-closing" className="text-[12px] text-text-accent hover:underline">
                Close them on Job closing
              </Link>
            ) : null
          }
        />
      </div>

      <p className="mt-3 text-[12px] text-text-muted">
        This month: {stats.newThisMonth} new {stats.newThisMonth === 1 ? "enquiry" : "enquiries"} · {stats.bookedThisMonth} booked as{" "}
        {stats.bookedThisMonth === 1 ? "a shipment" : "shipments"}
        {notProceeding.length ? ` · Not proceeding: ${notProceeding.join(", ")}` : ""}
      </p>

      <RegisterDownload generatedBy={session?.name ?? null} />

      {waiting.length > 0 && <Waiting rows={waiting} onChanged={() => void load()} />}
    </div>
  );
}

function StageCard({
  icon: Icon,
  title,
  count,
  note,
  to,
  linkText,
  rows,
  empty = "None at the moment.",
  extra,
}: {
  icon: React.ElementType;
  title: string;
  count: number;
  note: string;
  to: string;
  linkText: string;
  rows: Array<readonly [string, number]>;
  empty?: string;
  extra?: React.ReactNode;
}) {
  const shown = rows.filter(([, n]) => n > 0);
  return (
    <section className="card flex flex-col p-4">
      <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-text-secondary">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-surface-2 text-text-secondary">
          <Icon size={14} />
        </span>
        {title}
      </div>
      <p className="mt-3 text-[34px] font-semibold leading-none tabular-nums text-text-primary">{count}</p>
      <p className="mt-1 text-[12px] text-text-muted">{note}</p>

      <ul className="mt-4 flex-1 space-y-1.5 border-t border-border pt-3 text-[12.5px]">
        {shown.length ? (
          shown.map(([label, n]) => (
            <li key={label} className="flex items-center justify-between gap-3">
              <span className="text-text-secondary">{label}</span>
              <span className="font-medium tabular-nums text-text-primary">{n}</span>
            </li>
          ))
        ) : (
          <li className="text-text-muted">{empty}</li>
        )}
      </ul>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Link to={to} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-text-accent hover:underline">
          {linkText} <ArrowRight size={13} />
        </Link>
        {extra}
      </div>
    </section>
  );
}

/** The register, all three kinds, for a period. */
function RegisterDownload({ generatedBy }: { generatedBy: string | null }) {
  const [preset, setPreset] = useState<Preset>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = preset === "custom" ? { from: from || null, to: to || null } : presetRange(preset, todayIST());
  const backwards = Boolean(range.from && range.to && range.from > range.to);

  async function download() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const n = await downloadEnquiryRegister(range.from, range.to, generatedBy);
      setDone(n ? `Saved — ${n} ${n === 1 ? "enquiry" : "enquiries"} (${periodText(range.from, range.to)}).` : "Saved — no enquiries in that period.");
    } catch (e) {
      setError(failureText(e, "Could not build the register.").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mt-5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-text-primary">
            <FileSpreadsheet size={15} className="text-text-secondary" /> Enquiry register
          </h2>
          <p className="mt-1 max-w-2xl text-[12.5px] text-text-secondary">
            One Excel workbook: a summary, then <strong className="font-medium text-text-primary">Inbound</strong>,{" "}
            <strong className="font-medium text-text-primary">In process</strong> and{" "}
            <strong className="font-medium text-text-primary">Completed</strong> on sheets of their own — each in the register's columns, from date and
            customer to vessel, ETD, ETA and status.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || backwards}
          onClick={() => void download()}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[12.5px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
          {backwards ? "The start is after the end" : "Download Excel"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPreset(p.value)}
            aria-pressed={preset === p.value}
            className={`rounded-full border px-2.5 py-1 text-[12px] ${
              preset === p.value ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-secondary hover:text-text-primary"
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <span className="flex flex-wrap items-center gap-1.5">
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-7" aria-label="From" />
            <span className="text-[12px] text-text-muted">to</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-7" aria-label="To" />
          </span>
        )}
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-text-danger">
          <AlertCircle size={12} className="mt-px shrink-0" /> {error}
        </p>
      )}
      {done && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-text-success">
          <Check size={12} className="mt-px shrink-0" /> {done}
        </p>
      )}
    </section>
  );
}

/** Mail sent to the old queue and not yet pushed through. Gone once each is settled. */
function Waiting({ rows, onChanged }: { rows: Intake[]; onChanged: () => void }) {
  const [pushing, setPushing] = useState<Intake | null>(null);
  const [asideId, setAsideId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setAside(id: string) {
    setBusy(true);
    setError(null);
    try {
      await dismissIntake(id, reason.trim());
      setAsideId(null);
      setReason("");
      onChanged();
    } catch (e) {
      setError(failureText(e, "Could not set it aside.").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        <Mail size={12} /> Waiting from email <span className="text-text-muted">{rows.length}</span>
      </h2>
      <p className="mb-2 mt-1 text-[12px] text-text-muted">
        Sent on from the mail page before it pushed straight to inbound. Push each through, or set it aside.
      </p>
      {error && <p className="mb-2 text-[12px] text-text-danger">{error}</p>}
      <div className="card divide-y divide-border overflow-hidden">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-text-primary">{r.contact_name || r.company || r.email || "Unnamed"}</p>
              <p className="truncate text-[12px] text-text-secondary">{r.subject || [r.origin, r.destination].filter(Boolean).join(" → ") || "No subject"}</p>
              <p className="text-[11px] text-text-muted">
                {r.email ? `${r.email} · ` : ""}
                {dayLabel(istDay(r.received_at))}
              </p>
            </div>
            {asideId === r.id ? (
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why — e.g. not an enquiry" className="h-8 min-w-[200px] flex-1" autoFocus />
                <button
                  type="button"
                  disabled={busy || !reason.trim()}
                  onClick={() => void setAside(r.id)}
                  className="h-8 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-50"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : "Set aside"}
                </button>
                <button type="button" onClick={() => setAsideId(null)} className="h-8 px-2 text-[12px] text-text-muted hover:text-text-primary">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAsideId(r.id);
                    setReason("");
                  }}
                  className="h-8 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary"
                >
                  Set aside
                </button>
                <button
                  type="button"
                  onClick={() => setPushing(r)}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
                >
                  <ArrowRight size={13} /> Push to inbound
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {pushing && (
        <PushToInbound
          row={pushing}
          onClose={() => setPushing(null)}
          onPushed={() => {
            setPushing(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
