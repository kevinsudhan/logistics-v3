import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Check, Loader2, Plane, Ship, Truck, TrainFront, Warehouse } from "lucide-react";
import { milestoneBar } from "../lib/milestoneBar";
import { stageLabel, stagesFor, type Enquiry, type ShipmentStage } from "../services/enquiries";
import ShipmentRouteMap from "../components/ShipmentRouteMap";
import { trackingByToken, trackPointsByToken, type PublicTracking } from "../services/tracking";
import { customsByToken, type PublicCustoms } from "../services/customs";

/**
 * The customer's tracking page: /t/:token, no account needed.
 *
 * ---------------------------------------------------------------------------
 * Read-only, and everything on it comes from `shipment_tracking` (069, 072,
 * 074), which builds the answer field by field — the route, the milestones,
 * the schedule and the legs, collection and delivery, the warehouse, the
 * containers, where the cargo is and what the airline or carrier reported.
 * Money, notes, drivers and the office's own people are not in the answer, so
 * they cannot be on the page.
 *
 * It reads again every five minutes while it is open, and when the tab comes
 * back into view, so a customer who leaves it open sees the flight land.
 *
 * The same plain shell as the quotation page: somebody opening it on a phone
 * from a mail should see their shipment, not an application.
 * ---------------------------------------------------------------------------
 */

const INK = "#1f2937";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";
const BRAND = "#2f4f6f";
const DONE = "#2f7a4f";

const REFRESH_MS = 5 * 60_000;

const day = (d: string | null | undefined, time?: string | null) =>
  d
    ? `${new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}${
        time ? `, ${time.slice(0, 5)}` : ""
      }`
    : null;

/** A moment, or only its day when no time was recorded (filed as local midnight). */
const moment = (iso: string | null | undefined) => {
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
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return moment(iso) ?? "";
}

export default function TrackShipment() {
  const { token = "" } = useParams();
  const [t, setT] = useState<PublicTracking | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    void trackingByToken(token)
      .then((x) => {
        setT(x);
        setFailed(false);
      })
      // A refresh that fails keeps what is on screen; only a first load that
      // fails shows the "could not find" message, because `t` is still empty.
      .catch(() => setFailed(true));
  }, [token]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);

  const mode = (t?.mode ?? null) as Enquiry["transport_mode"];
  const air = mode === "air";

  return (
    <div className="min-h-screen bg-[#f4f5f7] px-4 py-8" style={{ color: INK }}>
      <div className="mx-auto w-full max-w-[680px]">
        <header className="rounded-t-xl px-6 py-5 text-white" style={{ background: BRAND }}>
          <p className="text-[22px] font-bold tracking-wide">SHIPMENT TRACKING</p>
          <p className="mt-0.5 text-[12.5px] opacity-90">Aashish Logistics Global</p>
        </header>

        <main className="rounded-b-xl border border-t-0 border-[#e5e7eb] bg-white px-5 py-6 sm:px-6">
          {!t && !failed ? (
            <p className="flex items-center gap-2 py-8 text-[13px]" style={{ color: MUTED }}>
              <Loader2 size={14} className="animate-spin" /> Loading…
            </p>
          ) : !t || t.state === "unknown" ? (
            <Ended
              title="We could not find this shipment"
              body="The link may be incomplete. Please reply to the email it came from and we will send it again."
            />
          ) : t.state === "revoked" ? (
            <Ended
              title="This tracking link is no longer active"
              body="Please contact us for the latest on your shipment and we will send a new link."
            />
          ) : (
            <Shipment t={t} mode={mode} air={air} token={token} />
          )}
        </main>
        <p className="mt-3 text-center text-[11px]" style={{ color: FAINT }}>
          This page updates by itself. No login is needed.
        </p>
      </div>
    </div>
  );
}

function Shipment({ t, mode, air, token }: { t: PublicTracking; mode: Enquiry["transport_mode"]; air: boolean; token: string }) {
  const cancelled = t.stage === "cancelled";
  const bar = milestoneBar(stagesFor(mode), (s) => stageLabel(s as ShipmentStage, mode), t.steps ?? [], t.stage ?? "booked");
  const pickup = t.movements?.find((m) => m.kind === "pickup");
  const delivery = t.movements?.find((m) => m.kind === "delivery");
  const legs = (t.legs ?? []).filter((l) => l.status !== "cancelled");
  const [customs, setCustoms] = useState<PublicCustoms[]>([]);
  useEffect(() => {
    void customsByToken(token)
      .then(setCustoms)
      .catch(() => setCustoms([]));
  }, [token, t.updated_at]);
  const mapLegs = useMemo(() => (t.legs ?? []).map((l) => ({ move: l.move, from: l.from, to: l.to, status: l.status })), [t.legs]);
  const cargo = [
    t.pieces ? `${t.pieces} pcs` : null,
    t.gross_weight_kg ? `${Number(t.gross_weight_kg).toLocaleString("en-IN")} kg` : null,
    t.volume_cbm ? `${Number(t.volume_cbm)} CBM` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <p className="text-[12px]" style={{ color: MUTED }}>
        {t.reference} · {t.shipment}
        {t.customer ? ` · ${t.customer}` : ""}
      </p>
      <p className="mt-1 text-[19px] font-semibold leading-snug">{[t.origin, t.destination].filter(Boolean).join(" → ")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="inline-block rounded-full px-3 py-1 text-[12.5px] font-semibold capitalize"
          style={cancelled ? { background: "#fdecec", color: "#b42318" } : { background: "#e8f0f7", color: BRAND }}
        >
          {t.stage_label}
          {t.stage === "delivered" && t.delivered_to ? ` — received by ${t.delivered_to}` : ""}
        </span>
        {t.updated_at && (
          <span className="text-[11.5px]" style={{ color: FAINT }}>
            Last updated {ago(t.updated_at)}
          </span>
        )}
      </div>

      {cancelled ? (
        <p className="mt-5 rounded-lg bg-[#fdecec] px-4 py-3 text-[13px] text-[#b42318]">
          This shipment has been cancelled. Please contact us if you were not expecting this.
        </p>
      ) : (
        <Milestones bar={bar} />
      )}

      {t.latest_eta && !cancelled && t.stage !== "delivered" && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-[#fff7e6] px-4 py-2.5 text-[12.5px] text-[#8a5a00]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            The {t.latest_eta.source} now expects arrival on <strong>{day(t.latest_eta.eta)}</strong>
            {t.eta ? ` (originally ${day(t.eta)})` : ""}.
          </span>
        </p>
      )}

      {!cancelled && (
        <div className="mt-5">
          <ShipmentRouteMap
            input={{
              mode,
              stage: t.stage ?? "booked",
              pol: t.port_of_loading ?? t.origin ?? null,
              pod: t.port_of_discharge ?? t.destination ?? null,
              finalDestination: t.destination ?? null,
              legs: mapLegs,
            }}
            loadPositions={() => trackPointsByToken(token)}
            canLookUp={false}
            refreshKey={t.updated_at}
            height={320}
          />
        </div>
      )}

      <Section title="Shipment details">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <Item label={air ? "Airline" : "Carrier"} value={t.carrier} />
          <Item label={air ? "Flight" : "Vessel"} value={air ? t.flight_number : [t.vessel, t.voyage].filter(Boolean).join(" / ") || null} />
          <Item label={air ? "Airport of loading" : "Port of loading"} value={t.port_of_loading} />
          <Item label={air ? "Airport of discharge" : "Port of discharge"} value={t.port_of_discharge} />
          <Item label="Departure (ETD)" value={day(t.etd, t.etd_time)} />
          <Item label="Arrival (ETA)" value={day(t.eta, t.eta_time)} />
          <Item label={air ? "HAWB" : "House B/L"} value={t.house_bill} />
          <Item label="Cargo" value={cargo || null} />
          {(t.containers ?? []).length > 0 && (
            <div className="col-span-2">
              <dt className="text-[11.5px]" style={{ color: MUTED }}>
                Container{t.containers!.length === 1 ? "" : "s"}
              </dt>
              <dd className="mt-0.5 flex flex-wrap gap-1.5">
                {t.containers!.map((c) => (
                  <span key={c.number} className="rounded bg-[#f3f4f6] px-2 py-0.5 font-mono text-[12px]">
                    {c.number}
                    {c.type ? <span style={{ color: MUTED }}> · {c.type}</span> : null}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </Section>

      {legs.length > 0 && (
        <Section title="Journey">
          <ol className="space-y-2.5">
            {legs.map((l, i) => {
              const Icon = l.move === "air" ? Plane : l.move === "sea" ? Ship : l.move === "rail" ? TrainFront : Truck;
              return (
                <li key={i} className="flex items-start gap-3 text-[13px]">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#f3f4f6]" style={{ color: BRAND }}>
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{[l.from, l.to].filter(Boolean).join(" → ") || "Leg"}</p>
                    <p className="text-[11.5px]" style={{ color: MUTED }}>
                      {[l.carrier, l.voyage_flight, [day(l.etd), day(l.eta)].filter(Boolean).join(" → ")].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={
                      l.status === "completed"
                        ? { background: "#e8f5ee", color: DONE }
                        : l.status === "in_transit"
                          ? { background: "#e8f0f7", color: BRAND }
                          : { background: "#f3f4f6", color: MUTED }
                    }
                  >
                    {l.status === "completed" ? "Completed" : l.status === "in_transit" ? "Under way" : "Planned"}
                  </span>
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      {(pickup || t.received || delivery) && (
        <Section title="Collection and delivery">
          <div className="grid gap-2.5 sm:grid-cols-3">
            {pickup && (
              <Card icon={<Truck size={13} />} title="Collection" done={Boolean(pickup.actual_at)}>
                {pickup.actual_at
                  ? `Collected ${moment(pickup.actual_at)}`
                  : pickup.planned_date
                    ? `Planned ${day(pickup.planned_date, pickup.planned_time)}`
                    : "To be arranged"}
                {pickup.pieces ? <span className="block">{pickup.pieces} pcs</span> : null}
              </Card>
            )}
            {t.received && (
              <Card icon={<Warehouse size={13} />} title="At the warehouse" done>
                Received {moment(t.received.first_at)}
                <span className="block">
                  {[
                    t.received.pieces ? `${t.received.pieces} pcs` : null,
                    t.received.gross_weight_kg ? `${Number(t.received.gross_weight_kg).toLocaleString("en-IN")} kg` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Card>
            )}
            {delivery && (
              <Card icon={<Truck size={13} />} title="Delivery" done={Boolean(delivery.actual_at)}>
                {delivery.actual_at
                  ? `Delivered ${moment(delivery.actual_at)}`
                  : delivery.planned_date
                    ? `Planned ${day(delivery.planned_date, delivery.planned_time)}`
                    : "To be arranged"}
                {delivery.received_by ? <span className="block">Received by {delivery.received_by}</span> : null}
              </Card>
            )}
          </div>
        </Section>
      )}

      {customs.length > 0 && (
        <Section title="Customs">
          <ul className="space-y-2">
            {customs.map((c) => {
              const exp = c.side === "export";
              const num = exp ? c.sb_number : c.be_number;
              const on = exp ? c.sb_date : c.be_date;
              const cleared = exp ? c.leo_date : c.ooc_date;
              return (
                <li key={c.side} className="flex items-start justify-between gap-3 rounded-lg border border-[#e5e7eb] px-3 py-2.5 text-[13px]">
                  <div className="min-w-0">
                    <p className="font-medium">{exp ? "Export customs" : "Import customs"}</p>
                    <p className="text-[11.5px]" style={{ color: MUTED }}>
                      {[num ? `${exp ? "Shipping bill" : "Bill of entry"} ${num}${on ? ` dated ${day(on)}` : ""}` : null, c.port_code].filter(Boolean).join(" · ") || "Being prepared"}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={c.status === "cleared" ? { background: "#e8f5ee", color: DONE } : { background: "#f3f4f6", color: MUTED }}
                  >
                    {c.status === "cleared" ? `Cleared ${day(cleared)}` : c.status === "filed" ? "Filed" : "In progress"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {(t.updates ?? []).length > 0 && (
        <Section title={`From the ${air ? "airline" : "carrier"}`}>
          <ul className="space-y-1.5">
            {t.updates!.map((u, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span>{u.what}</span>
                <span className="shrink-0 text-[11.5px]" style={{ color: FAINT }}>
                  {moment(u.at)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="All steps">
        <ol>
          {(t.steps ?? []).map((s, i) => (
            <li key={i} className="flex items-start gap-3 pb-3 last:pb-0">
              <span
                className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-white"
                style={s.done_at ? { borderColor: DONE, background: DONE } : { borderColor: "#d1d5db", background: "#fff" }}
              >
                {s.done_at && <Check size={11} />}
              </span>
              <div className="min-w-0">
                <p className={`text-[13px] ${s.milestone ? "font-semibold" : ""}`} style={{ color: s.done_at ? INK : MUTED }}>
                  {s.label}
                </p>
                <p className="text-[11.5px]" style={{ color: FAINT }}>
                  {s.done_at ? moment(s.done_at) : s.due_on && !cancelled ? `Expected ${day(s.due_on)}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <p className="mt-6 border-t border-[#e5e7eb] pt-4 text-[12px]" style={{ color: MUTED }}>
        Questions about this shipment? Reply to our last email and keep <strong>{t.reference}</strong> in the subject.
      </p>
    </>
  );
}

/** Booked → … → Delivered, with the date each was reached. */
function Milestones({ bar }: { bar: ReturnType<typeof milestoneBar> }) {
  return (
    <ol className="mt-6 flex items-start" aria-label="Progress">
      {bar.map((m, i) => (
        <li key={m.stage} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
          {/* The line from the previous milestone, drawn behind this one's dot. */}
          {i > 0 && (
            <span
              aria-hidden
              className="absolute right-1/2 top-[11px] h-[3px] w-full"
              style={{ background: m.done ? DONE : "#e5e7eb" }}
            />
          )}
          <span
            className="relative z-10 grid h-6 w-6 place-items-center rounded-full border-2 text-white"
            style={
              m.current
                ? { borderColor: DONE, background: DONE, boxShadow: "0 0 0 4px #e8f5ee" }
                : m.done
                  ? { borderColor: DONE, background: DONE }
                  : { borderColor: "#d1d5db", background: "#fff" }
            }
          >
            {m.done && <Check size={12} strokeWidth={3} />}
          </span>
          <span className={`mt-1.5 px-0.5 text-[11px] leading-tight ${m.current ? "font-semibold" : ""}`} style={{ color: m.done ? INK : FAINT }}>
            {m.label}
          </span>
          {m.at && (
            <span className="mt-0.5 text-[10.5px] leading-tight" style={{ color: FAINT }}>
              {moment(m.at)}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Card({ icon, title, done, children }: { icon: ReactNode; title: string; done: boolean; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[#e5e7eb] px-3 py-2.5 text-[12.5px]">
      <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: done ? DONE : MUTED }}>
        {icon}
        {title}
        {done && <Check size={12} />}
      </p>
      <div style={{ color: INK }}>{children}</div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px]" style={{ color: MUTED }}>
        {label}
      </dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function Ended({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-6">
      <p className="text-[16px] font-semibold">{title}</p>
      <p className="mt-2 text-[13px]" style={{ color: MUTED }}>
        {body}
      </p>
    </div>
  );
}
