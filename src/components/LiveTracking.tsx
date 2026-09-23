import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Plane,
  RefreshCw,
  Satellite,
  Ship,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { failureText } from "../lib/errorText";
import { when } from "../lib/shipmentUpdateMail";
import { mailIsLive, type MailMessage } from "../services/backend";
import type { Checkpoint } from "../services/checkpoints";
import { correspondenceFor, updateShipment, type Shipment } from "../services/enquiries";
import {
  EVENT_STAGE,
  SOURCE_NAME,
  applyTrackingEvent,
  dismissTrackingEvent,
  mailReadFor,
  readMailForTracking,
  refreshTracking,
  setVesselIds,
  unreadForTracking,
  type Snapshot,
  type TrackSource,
  type TrackingEvent,
} from "../services/liveTracking";

/**
 * What the airline, the carrier, the ship and the mail say — on the Tracking tab.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS ON ONE PANEL
 *
 * Where it is: each source's latest answer, and a map when one of them gave a
 * position. What they reported: offers to tick a step or move a date, each
 * with where it came from, for one click — or "not ours". And the mail: the
 * job's messages since the booking, read once each for the same kind of news.
 *
 * WHAT TICKS ON ITS OWN
 *
 * Only a carrier's container event (it is about our box). Everything else is
 * offered here, because a flight taking off does not prove our cargo was on
 * it and a line a model read from a mail is a reading, not a record.
 * ---------------------------------------------------------------------------
 */

const SOURCES: Record<string, TrackSource[]> = {
  air: ["aerodatabox", "adsb"],
  sea_fcl: ["hapag_lloyd", "aisstream"],
  sea_lcl: ["hapag_lloyd", "aisstream"],
};

const WHAT: Record<TrackSource, string> = {
  aerodatabox: "Flight status",
  adsb: "Aircraft position",
  hapag_lloyd: "Container events",
  aisstream: "Vessel position",
};

const STATE: Record<Snapshot["state"], { label: string; tone: string }> = {
  ok: { label: "Live", tone: "bg-bg-success text-text-success" },
  not_found: { label: "No answer", tone: "bg-surface-2 text-text-secondary" },
  not_configured: { label: "Not connected", tone: "bg-surface-2 text-text-muted" },
  not_applicable: { label: "Needs details", tone: "bg-bg-warning text-text-warning" },
  error: { label: "Error", tone: "bg-bg-danger text-text-danger" },
};

/** How many mails one press reads: the model's free tier allows about fifteen a minute. */
const MAIL_BATCH = 8;

/** A time, or only the day when the source gave no time (filed as local midnight). */
const clock = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  const dayOnly = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", ...(dayOnly ? {} : { hour: "2-digit", minute: "2-digit" }) });
};

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export default function LiveTracking({
  shipment: s,
  steps,
  snapshots,
  events,
  onChanged,
}: {
  shipment: Shipment;
  steps: Checkpoint[];
  snapshots: Snapshot[];
  events: TrackingEvent[];
  /** Reload the tab: a tick or a date move changes the steps and the header. */
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const mailbox = session?.email ?? "";
  const mode = s.transport_mode ?? "";
  const sources = SOURCES[mode] ?? [];
  const air = mode === "air";

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [unread, setUnread] = useState<MailMessage[] | null>(null);
  const [mailProgress, setMailProgress] = useState<string | null>(null);

  const bySource = useMemo(() => new Map(snapshots.map((x) => [x.source, x])), [snapshots]);
  const lastChecked = snapshots.reduce<string | null>((a, x) => (!a || x.fetched_at > a ? x.fetched_at : a), null);

  const stepFor = useCallback(
    (kind: TrackingEvent["kind"]) => {
      const stage = EVENT_STAGE[kind];
      return stage ? steps.find((c) => c.stage === stage) : undefined;
    },
    [steps]
  );
  // An offer for a step somebody has since ticked by hand asks nothing.
  const offers = events.filter((e) => e.status === "new" && !(stepFor(e.kind)?.done_at));

  const { id, enquiry_ref: ref, created_at: booked } = s;
  const loadMail = useCallback(async () => {
    if (!mailIsLive() || !mailbox) return setUnread(null);
    try {
      const [mail, read] = await Promise.all([correspondenceFor(ref, mailbox), mailReadFor(id)]);
      setUnread(unreadForTracking(mail.map((f) => f.message), { created_at: booked }, read));
    } catch {
      // Best-effort: a mailbox that will not load must not blank the panel.
      setUnread(null);
    }
  }, [id, ref, booked, mailbox]);

  useEffect(() => {
    void loadMail();
  }, [loadMail]);

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const said = await fn();
      if (said) setNote(said);
      await onChanged();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  const refresh = () =>
    run("refresh", async () => {
      const out = await refreshTracking(s.id);
      const added = out.reduce((n, o) => n + (o.added ?? 0), 0);
      const ticked = out.reduce((n, o) => n + (o.ticked ?? 0), 0);
      if (ticked) return `${ticked} step${ticked === 1 ? "" : "s"} ticked from the carrier's events.`;
      if (added) return `${added} new update${added === 1 ? "" : "s"} below.`;
    });

  const readMail = () =>
    run("mail", async () => {
      const batch = (unread ?? []).slice(0, MAIL_BATCH);
      let found = 0;
      try {
        for (let i = 0; i < batch.length; i++) {
          setMailProgress(`Reading ${i + 1} of ${batch.length}…`);
          found += await readMailForTracking(s, batch[i]);
        }
      } finally {
        setMailProgress(null);
        await loadMail();
      }
      return found ? `Found ${found} update${found === 1 ? "" : "s"} in the mail.` : `Nothing new in ${batch.length} message${batch.length === 1 ? "" : "s"}.`;
    });

  // Where it is: the freshest position any source gave in the last day.
  const position = snapshots
    .filter((x) => x.state === "ok" && typeof x.summary.lat === "number" && typeof x.summary.lon === "number")
    .filter((x) => Date.now() - Date.parse(String(x.summary.position_at ?? x.fetched_at)) < 86_400_000)
    .sort((a, b) => (String(b.summary.position_at ?? b.fetched_at) > String(a.summary.position_at ?? a.fetched_at) ? 1 : -1))[0];

  // What the airline or carrier now expects, against the booking's ETA. Not the
  // ship's own AIS ETA: the crew types it for the next port, which is often a
  // transhipment and not ours.
  const newer = snapshots
    .filter((x) => x.state === "ok" && x.source !== "aisstream" && typeof x.summary.eta_local === "string")
    .map((x) => ({ source: x.source, eta: String(x.summary.eta_local) }))
    .find((x) => x.eta !== s.eta);

  return (
    <section className="card mt-3 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          <Satellite size={12} /> Live tracking
        </h2>
        {sources.length > 0 && (
          <div className="flex items-center gap-2">
            {lastChecked && <span className="text-[11px] text-text-muted">Checked {ago(lastChecked)}</span>}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void refresh()}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-60"
            >
              {busy === "refresh" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {busy === "refresh" ? (mode.startsWith("sea") ? "Listening…" : "Checking…") : "Refresh"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" /> {error}
        </p>
      )}
      {note && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">
          <Check size={13} className="mt-px shrink-0" /> {note}
        </p>
      )}

      {!sources.length ? (
        <p className="text-[12px] text-text-muted">
          Live tracking covers air and sea bookings. Set the mode on Shipment details; the mail can still be read below.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sources.map((src) => (
            <SourceCard key={src} source={src} snap={bySource.get(src)} air={air} />
          ))}
        </div>
      )}

      {mode.startsWith("sea") && <VesselIds shipment={s} onSaved={onChanged} />}

      {newer && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
          <span className="flex items-center gap-1.5">
            <CalendarClock size={13} />
            {SOURCE_NAME[newer.source]} now expects arrival {when(newer.eta)}
            {s.eta ? `; the booking says ${when(s.eta)}.` : "; the booking has no ETA."}
          </span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run("eta", async () => {
                await updateShipment(s.id, { eta: newer.eta });
                return `ETA set to ${when(newer.eta)}. Due dates follow it.`;
              })
            }
            className="h-7 rounded-lg border border-current px-2.5 text-[11.5px] font-medium disabled:opacity-60"
          >
            Use this ETA
          </button>
        </div>
      )}

      {position && <PositionMap snap={position} />}

      {/* ---- offers ---- */}
      {offers.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            Updates to confirm <span className="ml-1 rounded-full bg-bg-accent px-1.5 text-text-accent">{offers.length}</span>
          </p>
          <ul className="space-y-2">
            {offers.map((e) => {
              const step = stepFor(e.kind);
              const moves = ["schedule_changed", "rolled_over", "delayed"].includes(e.kind) && (e.data?.etd || e.data?.eta);
              return (
                <li key={e.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12.5px] text-text-primary">{e.detail}</p>
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        {SOURCE_NAME[e.source]}
                        {e.occurred_at ? ` · ${clock(e.occurred_at)}` : ""}
                        {e.location && !e.detail.includes(e.location) ? ` · ${e.location}` : ""}
                        {e.source === "mail" && e.data?.subject ? ` · “${e.data.subject}”` : ""}
                      </p>
                      {e.data?.evidence && <p className="mt-1 border-l-2 border-border pl-2 text-[11.5px] italic text-text-secondary">{e.data.evidence}</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {moves ? (
                        <ActButton
                          busy={busy === e.id}
                          disabled={busy !== null}
                          primary
                          onClick={() =>
                            void run(e.id, async () => {
                              await applyTrackingEvent(e.id);
                              return "Dates moved. Due dates follow them.";
                            })
                          }
                        >
                          Use {[e.data.etd && `ETD ${when(e.data.etd)}`, e.data.eta && `ETA ${when(e.data.eta)}`].filter(Boolean).join(", ")}
                        </ActButton>
                      ) : step && !e.estimated ? (
                        <ActButton
                          busy={busy === e.id}
                          disabled={busy !== null}
                          primary
                          onClick={() =>
                            void run(e.id, async () => {
                              const r = await applyTrackingEvent(e.id);
                              return r === "applied" ? `Ticked “${step.label}”.` : r === "already" ? "That step was already ticked." : undefined;
                            })
                          }
                        >
                          Tick “{step.label}”
                        </ActButton>
                      ) : (
                        <ActButton busy={busy === e.id} disabled={busy !== null} onClick={() => void run(e.id, () => dismissTrackingEvent(e.id, true))}>
                          Keep as a note
                        </ActButton>
                      )}
                      <button
                        type="button"
                        title="Not about this shipment, or not true"
                        disabled={busy !== null}
                        onClick={() => void run(`x${e.id}`, () => dismissTrackingEvent(e.id))}
                        className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] text-text-muted hover:text-text-danger disabled:opacity-60"
                      >
                        <X size={12} /> Not ours
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ---- the mail ---- */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="flex items-center gap-1.5 text-[12px] text-text-secondary">
          <Mail size={13} className="text-text-muted" />
          {!mailIsLive()
            ? "Connect the mailbox to read agents' and carriers' mail for updates."
            : unread === null
              ? "Looking through this job's mail…"
              : unread.length
                ? `${unread.length} message${unread.length === 1 ? "" : "s"} since the booking not yet read for updates.`
                : "Every message on this job has been read for updates."}
        </p>
        {unread && unread.length > 0 && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void readMail()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-60"
          >
            {busy === "mail" ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            {mailProgress ?? `Read ${Math.min(unread.length, MAIL_BATCH)} for updates`}
          </button>
        )}
      </div>
    </section>
  );
}

function ActButton({
  children,
  onClick,
  busy,
  disabled,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11.5px] font-medium disabled:opacity-60 ${
        primary ? "bg-brand text-white hover:bg-brand-dark" : "border border-border text-text-secondary hover:text-text-primary"
      }`}
    >
      {busy && <Loader2 size={11} className="animate-spin" />}
      {children}
    </button>
  );
}

function SourceCard({ source, snap, air }: { source: TrackSource; snap?: Snapshot; air: boolean }) {
  const Icon = source === "aerodatabox" || source === "adsb" ? Plane : source === "aisstream" ? Ship : MapPin;
  const st = snap ? STATE[snap.state] : null;
  const x = snap?.summary ?? {};
  const facts: Array<[string, string | null]> =
    snap?.state !== "ok"
      ? []
      : source === "aerodatabox"
        ? [
            ["Took off", clock(x.dep_actual as string) ?? (x.dep_revised ? `due ${clock(x.dep_revised as string)}` : null)],
            [x.arr_actual ? "Landed" : "Landing", clock((x.arr_actual ?? x.arr_expected ?? x.arr_scheduled) as string)],
            ["Route", [x.from, x.to].filter(Boolean).join(" → ") || null],
            ["Callsign", (x.callsign as string) ?? null],
          ]
        : source === "adsb"
          ? [
              ["Altitude", typeof x.altitude_m === "number" ? `${Math.round(x.altitude_m).toLocaleString("en-IN")} m` : null],
              ["Speed", typeof x.speed_kmh === "number" ? `${x.speed_kmh} km/h` : null],
              ["Aircraft", [x.aircraft, x.registration].filter(Boolean).join(" · ") || null],
              ["Heard", clock(x.position_at as string)],
            ]
          : source === "hapag_lloyd"
            ? [
                ["Last", (x.last_event as string) ?? null],
                ["When", clock(x.last_at as string)],
                ["Vessel", [x.vessel, x.voyage].filter(Boolean).join(" ") || null],
                ["Carrier ETA", when((x.eta_local as string) ?? null)],
              ]
            : [
                ["Doing", [x.nav_status, typeof x.speed_kn === "number" ? `${x.speed_kn} kn` : null].filter(Boolean).join(" · ") || null],
                ["Bound for", (x.destination as string) ?? null],
                ["AIS ETA", when((x.eta_local as string) ?? null)],
                ["Heard", clock(x.position_at as string)],
              ];

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-primary">
          <Icon size={13} className="text-text-muted" />
          {WHAT[source]}
          <span className="text-[11px] font-normal text-text-muted">· {SOURCE_NAME[source]}</span>
        </p>
        {st && <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${st.tone}`}>{st.label}</span>}
      </div>
      <p className="text-[12px] text-text-secondary">{snap ? snap.message : `Not checked yet. Refresh to ask ${SOURCE_NAME[source]}.`}</p>
      {typeof x.name_mismatch === "string" && (
        <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-text-warning">
          <AlertTriangle size={12} className="mt-px shrink-0" /> {x.name_mismatch}
        </p>
      )}
      {facts.some(([, v]) => v) && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[10.5px] text-text-muted">{k}</dt>
                <dd className="truncate text-[12px] text-text-primary">{v}</dd>
              </div>
            ))}
        </dl>
      )}
      {!air && source === "aisstream" && snap?.state === "not_found" && (
        <p className="mt-1 text-[11px] text-text-muted">Try again when the ship is near a coast; the last known port call is on the carrier's events.</p>
      )}
    </div>
  );
}

/** OpenStreetMap's own embed: no key, no script, one marker. */
function PositionMap({ snap }: { snap: Snapshot }) {
  const lat = snap.summary.lat as number;
  const lon = snap.summary.lon as number;
  const d = snap.source === "aisstream" ? 4 : 3;
  const bbox = [lon - d, lat - d * 0.7, lon + d, lat + d * 0.7].map((n) => n.toFixed(4)).join(",");
  const what = snap.source === "aisstream" ? (snap.summary.name as string) || "The vessel" : (snap.summary.callsign as string) || "The aircraft";
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border">
      <iframe
        title={`${what} on the map`}
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`}
        className="block h-56 w-full border-0"
        loading="lazy"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2 px-3 py-1.5 text-[11px] text-text-muted">
        <span>
          {what} at {lat.toFixed(3)}, {lon.toFixed(3)} · heard {clock(String(snap.summary.position_at ?? snap.fetched_at))}
        </span>
        <span className="flex items-center gap-2">
          <span>
            Map © OpenStreetMap{snap.source === "adsb" ? " · position adsb.lol (ODbL)" : ""}
          </span>
          <a
            href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=7/${lat}/${lon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-0.5 text-text-accent hover:underline"
          >
            Larger <ExternalLink size={10} />
          </a>
        </span>
      </div>
    </div>
  );
}

/** The ship's identities: the MMSI is what AIS files positions under. */
function VesselIds({ shipment: s, onSaved }: { shipment: Shipment; onSaved: () => Promise<void> | void }) {
  const [mmsi, setMmsi] = useState(s.vessel_mmsi ?? "");
  const [imo, setImo] = useState(s.vessel_imo ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = mmsi.trim() !== (s.vessel_mmsi ?? "") || imo.trim() !== (s.vessel_imo ?? "");

  useEffect(() => {
    setMmsi(s.vessel_mmsi ?? "");
    setImo(s.vessel_imo ?? "");
  }, [s.vessel_mmsi, s.vessel_imo]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setVesselIds(s.id, { vessel_mmsi: mmsi.trim() || null, vessel_imo: imo.trim() || null });
      await onSaved();
    } catch (e) {
      setError(failureText(e, "Could not save.").message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="text-[11px] text-text-secondary">
        Vessel MMSI
        <input
          value={mmsi}
          onChange={(e) => setMmsi(e.target.value.replace(/\D/g, "").slice(0, 9))}
          inputMode="numeric"
          placeholder="9 digits"
          className="mt-0.5 block h-8 w-32 font-mono"
        />
      </label>
      <label className="text-[11px] text-text-secondary">
        IMO
        <input
          value={imo}
          onChange={(e) => setImo(e.target.value.replace(/\D/g, "").slice(0, 7))}
          inputMode="numeric"
          placeholder="7 digits"
          className="mt-0.5 block h-8 w-28 font-mono"
        />
      </label>
      {dirty && (
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {saving && <Loader2 size={12} className="animate-spin" />} Save
        </button>
      )}
      <p className="basis-full text-[11px] text-text-muted">
        On the carrier's booking confirmation, or search the vessel's name on a ship-tracking site.
        {s.vessel ? ` Booking says ${s.vessel}.` : ""}
      </p>
      {error && <p className="basis-full text-[11.5px] text-text-danger">{error}</p>}
    </div>
  );
}
