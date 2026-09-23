import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CircleDot,
  Copy,
  ExternalLink,
  Flag,
  Link2,
  Loader2,
  Map as MapIcon,
  Radar,
} from "lucide-react";
import Collapsible from "../../components/Collapsible";
import LiveTracking from "../../components/LiveTracking";
import ShipmentRouteMap from "../../components/ShipmentRouteMap";
import SendTrackingLink from "../../components/SendTrackingLink";
import { useShipment } from "../ShipmentDetail";
import { failureText } from "../../lib/errorText";
import { DUE_TONE, dueState, dueText, todayIST } from "../../lib/progress";
import { when } from "../../lib/shipmentUpdateMail";
import { buildTimeline, upcoming, type Entry } from "../../lib/trackingTimeline";
import { checkpointsFor, type Checkpoint } from "../../services/checkpoints";
import { eventsFor, stageLabel } from "../../services/enquiries";
import { movementsFor } from "../../services/movements";
import { isReachable } from "../../services/publicQuote";
import { routingsFor } from "../../services/shipmentExtras";
import { positionsFor, snapshotsFor, trackingEventsFor, type Snapshot, type TrackingEvent } from "../../services/liveTracking";
import { currentTrackLink, issueTrackLink, revokeTrackLink, trackUrl, type TrackLink } from "../../services/tracking";
import { receiptsFor } from "../../services/warehouse";

/**
 * Where the cargo is, and everything that has happened to it.
 *
 * ---------------------------------------------------------------------------
 * One line, newest first, from every record that says something happened —
 * the steps, the pickup and delivery, the warehouse receipts, the legs — and
 * what the desk did about it. The steps still open and dated follow it, so the
 * page answers both "what happened" and "what next".
 *
 * THE CUSTOMER'S LINK
 *
 * The same answer, without the internals, on a page the customer can open
 * without an account (069). Copied from here and pasted into a mail or a chat;
 * withdrawn from here when it should stop working.
 *
 * LIVE TRACKING (072)
 *
 * What the airline, the carrier and the ship say, and what the job's mail
 * says, sit between the two: their news ticks steps (a carrier's container
 * events on their own, the rest on a click) and so arrives on the line.
 * ---------------------------------------------------------------------------
 */
export default function ShipmentTracking() {
  const { shipment: s, enquiry, reload } = useShipment();
  const [steps, setSteps] = useState<Checkpoint[]>([]);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [reports, setReports] = useState<TrackingEvent[]>([]);
  const [legs, setLegs] = useState<Array<{ move: string; from: string | null; to: string | null; status: string }>>([]);
  const [line, setLine] = useState<Entry[]>([]);
  const [link, setLink] = useState<TrackLink | null>(null);
  const [lastSent, setLastSent] = useState<{ at: string; summary: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayIST();
  const mode = s.transport_mode ?? enquiry?.transport_mode ?? null;

  const load = useCallback(async () => {
    try {
      const [cp, mv, rc, lg, ev, ln, sn, tr] = await Promise.all([
        checkpointsFor(s.id),
        movementsFor(s.id).catch(() => []),
        receiptsFor(s.id).catch(() => []),
        routingsFor(s.id).catch(() => []),
        eventsFor(s.enquiry_ref).catch(() => []),
        currentTrackLink(s.id).catch(() => null),
        snapshotsFor(s.id).catch(() => []),
        trackingEventsFor(s.id).catch(() => []),
      ]);
      setSteps(cp);
      setSnaps(sn);
      setReports(tr);
      setLegs(lg.map((l) => ({ move: l.move, from: l.from_place, to: l.to_place, status: l.status })));
      setLine(buildTimeline({ steps: cp, moves: mv, receipts: rc, legs: lg, events: ev, tracking: tr }));
      setLink(ln);
      const sent = ev.filter((e) => e.kind === "tracking_link_sent").sort((a, b) => (a.at < b.at ? 1 : -1))[0];
      setLastSent(sent ? { at: sent.at, summary: sent.summary } : null);
    } catch (e) {
      setError(failureText(e, "Could not load the tracking.").message);
    }
  }, [s.id, s.enquiry_ref]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  const lastMilestone = [...steps].filter((c) => c.done_at && c.stage).sort((a, b) => (a.done_at! < b.done_at! ? 1 : -1))[0];
  const next = steps.find((c) => !c.done_at);
  const soon = upcoming(steps);
  const url = link ? trackUrl(link.token) : null;
  const air = mode === "air";

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- where it is now ---- */}
      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          <Radar size={12} /> Where it is now
        </h2>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Status" value={stageLabel(s.stage, mode)} strong />
          <Fact
            label="Last milestone"
            value={lastMilestone ? `${lastMilestone.label} — ${when(lastMilestone.done_at!.slice(0, 10))}` : null}
          />
          <Fact
            label="Next"
            value={next ? `${next.label}${next.due_on ? ` · ${dueText(next.due_on, false, today)}` : ""}` : "Nothing left open"}
            tone={next ? DUE_TONE[dueState(next.due_on, false, today)] : undefined}
          />
          <Fact label={air ? "Flight" : "Vessel"} value={[s.carrier, air ? s.flight_number : [s.vessel, s.voyage].filter(Boolean).join(" / ")].filter(Boolean).join(" · ") || null} />
          <Fact label="ETD" value={when(s.etd ?? s.sailing_date, s.etd_time)} />
          <Fact label="ETA" value={when(s.eta, s.eta_time)} />
          <Fact label={air ? "HAWB" : "House B/L"} value={s.bl_number} mono />
          <Fact label="Container" value={s.container_number} mono />
        </div>
      </section>

      {/* ---- the route map ---- */}
      <section className="card mt-3 p-5">
        <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          <MapIcon size={12} /> Tracking events
        </h2>
        <ShipmentRouteMap
          input={{
            mode,
            stage: s.stage,
            pol: s.port_of_loading ?? s.origin,
            pod: s.port_of_discharge ?? s.destination,
            finalDestination: s.destination,
            legs,
          }}
          loadPositions={() => positionsFor(s.id)}
          canLookUp
          refreshKey={snaps.reduce((a, x) => (x.fetched_at > a ? x.fetched_at : a), "")}
        />
        <p className="mt-1.5 text-[11px] text-text-muted">
          The expected route follows the main shipping lanes (or the great circle for a flight); the actual service may call elsewhere.
        </p>
      </section>

      <LiveTracking
        shipment={s}
        steps={steps}
        snapshots={snaps}
        events={reports}
        onChanged={async () => {
          // A tick moves the stage and a date move the ETA: the header reads both.
          await Promise.all([load(), reload()]);
        }}
      />

      {/* ---- the customer's link ---- */}
      <Collapsible
        id="shipment:tracklink"
        title="Customer tracking link"
        icon={<Link2 size={12} className="shrink-0 text-text-muted" />}
        badge={link ? (link.opened_at ? "Opened" : "Issued") : undefined}
      >
        <p className="mb-3 max-w-prose text-[12px] text-text-secondary">
          A page the customer opens without an account: the route, where the cargo is, the steps
          and the dates. No prices, notes or names from the office.
        </p>
        {url ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-3 py-2 text-[12px]">{url}</code>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(url).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  })
                }
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary"
              >
                {copied ? <Check size={13} className="text-text-success" /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary"
              >
                <ExternalLink size={13} /> Open
              </a>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm("Withdraw this link? Anyone holding it will see that it no longer works.")) void run("revoke", () => revokeTrackLink(s.id));
                }}
                className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:text-text-danger disabled:opacity-60"
              >
                Withdraw
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-text-muted">
              {link!.opened_at
                ? `Opened by the customer: first ${stamp(link!.opened_at)}${
                    link!.last_opened_at && link!.last_opened_at !== link!.opened_at ? `, last ${stamp(link!.last_opened_at)}` : ""
                  }.`
                : "Not opened yet."}
              {lastSent ? ` ${lastSent.summary}, ${stamp(lastSent.at)}.` : ""}
            </p>
            {!isReachable(url) && (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
                <AlertTriangle size={13} className="mt-px shrink-0" />
                This address only works on this machine. Set VITE_PUBLIC_APP_URL to the public site
                before sending it to a customer.
              </p>
            )}
          </>
        ) : (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("issue", () => issueTrackLink(s.id))}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy === "issue" ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
            Create a tracking link
          </button>
        )}
        <SendTrackingLink shipment={s} customer={s.customer} onSent={() => void load()} />
      </Collapsible>

      {/* ---- what comes next ---- */}
      {soon.length > 0 && (
        <Collapsible
          id="shipment:upcoming"
          title="Coming up"
          icon={<CircleDot size={12} className="shrink-0 text-text-muted" />}
          badge={`${soon.length}`}
        >
          <ul className="space-y-1.5">
            {soon.map((u) => {
              const st = dueState(u.due_on, false, today);
              return (
                <li key={u.label} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="flex items-center gap-1.5 text-text-primary">
                    {u.milestone && <Flag size={10} className="text-text-accent" />}
                    {u.label}
                  </span>
                  <span className={`shrink-0 tabular-nums ${DUE_TONE[st]}`}>{dueText(u.due_on, false, today)}</span>
                </li>
              );
            })}
          </ul>
        </Collapsible>
      )}

      {/* ---- what happened ---- */}
      <Collapsible
        id="shipment:timeline"
        title="What has happened"
        icon={<Radar size={12} className="shrink-0 text-text-muted" />}
        badge={line.length ? `${line.length}` : undefined}
      >
        {!line.length ? (
          <p className="text-[12px] text-text-muted">Nothing recorded yet beyond the booking.</p>
        ) : (
          <ol className="relative ml-2 border-l border-border">
            {line.map((e, i) => (
              <li key={i} className="relative mb-3 pl-4 last:mb-0">
                <span
                  className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${
                    e.tone === "milestone" ? "bg-text-success" : e.tone === "warning" ? "bg-text-warning" : "bg-border-strong"
                  }`}
                />
                <p className="text-[12.5px] text-text-primary">{e.title}</p>
                <p className="text-[11px] text-text-muted">
                  {new Date(e.at).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    // A day with no time — a leg's date, a mail that gave none — shows as the day.
                    ...(isMidnight(e.at) ? {} : { hour: "2-digit", minute: "2-digit" }),
                  })}
                  {e.detail ? ` · ${e.detail}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Collapsible>
    </div>
  );
}

function Fact({
  label,
  value,
  strong,
  mono,
  tone,
}: {
  label: string;
  value: string | null;
  strong?: boolean;
  mono?: boolean;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p
        className={`truncate text-[13px] ${strong ? "font-semibold capitalize" : ""} ${mono ? "font-mono" : ""} ${
          value ? (tone ?? "text-text-primary") : "text-text-muted"
        }`}
      >
        {value || "—"}
      </p>
    </div>
  );
}

/** Local midnight: a day with no time given. */
function isMidnight(at: string): boolean {
  const d = new Date(at);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
