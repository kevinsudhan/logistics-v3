import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CalendarClock, ClipboardList, Loader2, Plus, Route, Trash2 } from "lucide-react";
import RevertShipment from "../../components/RevertShipment";
import Collapsible from "../../components/Collapsible";
import CustomerDetailsPanel from "../../components/CustomerDetailsPanel";
import ServiceDetailsPanel from "../../components/ServiceDetailsPanel";
import { Field, Segmented, TextSave, YesNo } from "../../components/formControls";
import SchedulePicker from "../../components/SchedulePicker";
import { useShipment } from "../ShipmentDetail";
import { failureText } from "../../lib/errorText";
import { listPeople, updateShipment, type Person, type Shipment } from "../../services/enquiries";
import { listPartners, type Partner } from "../../services/partners";
import {
  addRouting,
  MOVE_LABEL,
  removeRouting,
  ROUTING_STATUS_LABEL,
  routingsFor,
  updateRouting,
  type Routing,
  type RoutingMove,
  type RoutingStatus,
} from "../../services/shipmentExtras";
import { useLiveVersion } from "../../lib/liveVersions";

/**
 * The shipment's details, in the order the desk fills them in.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FIRST TWO SECTIONS ARE THE ENQUIRY'S PANELS
 *
 * Customer and service are the job's facts, and the job is one record from
 * enquiry to delivery. They are the same panels the inbound page uses, editing
 * the same row; the database keeps the booking's copies in step (065). A
 * second set of fields here would be a second answer to "which port", and the
 * first time the two disagreed the documents would print the wrong one.
 *
 * WHAT IS THE SHIPMENT'S OWN
 *
 * The booking details, the schedule and the routings exist only once there is
 * a booking — they are written to the shipment and nowhere else.
 * ---------------------------------------------------------------------------
 */
export default function ShipmentOverview() {
  const { shipment: s, enquiry, reload } = useShipment();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listPartners()
      .then(setPartners)
      .catch(() => setPartners([]));
    void listPeople()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  const mode = s.transport_mode ?? enquiry?.transport_mode ?? null;

  async function save(key: string, patch: Partial<Shipment>) {
    setBusy(key);
    setError(null);
    try {
      await updateShipment(s.id, patch as Record<string, unknown>);
      await reload();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  const agents = partners.filter((p) => p.role === "overseas_agent" || p.role === "consol_partner");
  const carriers = partners.filter((p) => p.role === "carrier" || p.role === "consol_partner");
  const salesman = people.find((p) => p.id === enquiry?.assigned_to);

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- the job's facts: the enquiry's own panels ---- */}
      {enquiry ? (
        <>
          <CustomerDetailsPanel enquiry={enquiry} customer={enquiry.customer} onSaved={reload} />
          <ServiceDetailsPanel enquiry={enquiry} onSaved={reload} />
        </>
      ) : (
        <p className="card p-4 text-[12px] text-text-muted">
          The enquiry this booking came from could not be read, so its customer and service details
          are not shown.
        </p>
      )}

      {/* ---- the booking ---- */}
      <Collapsible
        id="shipment:booking"
        title="Booking details"
        icon={<ClipboardList size={12} className="shrink-0 text-text-muted" />}
      >
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-3">
          <Field label="Shipment date">
            <TextSave
              type="date"
              value={(s.shipment_date ?? "").slice(0, 10)}
              busy={busy === "shipment_date"}
              onSave={(v) => void save("shipment_date", { shipment_date: v || null })}
            />
          </Field>

          <Field label="Freight">
            <Segmented
              options={[
                { value: "prepaid", label: "Prepaid" },
                { value: "collect", label: "Collect" },
              ]}
              value={s.freight_terms}
              busy={busy === "freight"}
              onChange={(v) => void save("freight", { freight_terms: v })}
            />
          </Field>

          <Field
            label="Direct"
            hint={s.direct ? "The carrier's bill goes to the shipper; no house bill." : undefined}
          >
            <YesNo
              value={s.direct}
              busy={busy === "direct"}
              onChange={(v) => void save("direct", { direct: v })}
            />
          </Field>

          <Field label="Routed">
            <Segmented
              options={[
                { value: "self", label: "Self" },
                { value: "agent", label: "Agent" },
              ]}
              value={s.routed}
              busy={busy === "routed"}
              onChange={(v) =>
                void save("routed", { routed: v, ...(v === "self" ? { routed_agent_id: null } : {}) })
              }
            />
          </Field>

          <Field
            label="Routed by"
            hint={
              s.routed === "self"
                ? "The salesperson on the enquiry — change it under Customer details."
                : "The agent who nominated this cargo to us."
            }
          >
            {s.routed === "self" ? (
              <span
                className={`flex h-9 items-center rounded-lg bg-surface-2 px-3 text-[13px] ${
                  salesman ? "text-text-primary" : "text-text-muted"
                }`}
              >
                {salesman ? salesman.full_name || salesman.email : "Nobody assigned"}
              </span>
            ) : (
              <select
                value={s.routed_agent_id ?? ""}
                disabled={busy !== null}
                onChange={(e) => void save("routed_agent", { routed_agent_id: e.target.value || null })}
                className="h-9 w-full"
              >
                <option value="">Choose the agent</option>
                {agents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.organisation || p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="hidden md:block" />

          <Field label="Origin booking person">
            <TextSave
              value={s.origin_booking_person ?? ""}
              placeholder="Who booked it at origin"
              busy={busy === "obp"}
              onSave={(v) => void save("obp", { origin_booking_person: v || null })}
            />
          </Field>
          <Field label="Destination booking person">
            <TextSave
              value={s.destination_booking_person ?? ""}
              placeholder="Who handles it at destination"
              busy={busy === "dbp"}
              onSave={(v) => void save("dbp", { destination_booking_person: v || null })}
            />
          </Field>
        </div>
      </Collapsible>

      <Schedule shipment={s} mode={mode} carriers={carriers} busy={busy} save={save} />

      <Routings shipmentId={s.id} carriers={carriers} />

      {/*
        At the foot of the page, not in the toolbar.

        It deletes the booking, so it should take a decision to reach rather
        than sit beside the things somebody presses all day.
      */}
      <section className="card mt-4 p-5">
        <h2 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Not ready to be a booking?
        </h2>
        <p className="mb-3 max-w-prose text-[12px] text-text-secondary">
          Send it back to the enquiry and start it again when it is. Refused once an invoice has
          been raised against it — that takes a credit note, not a deletion.
        </p>
        <RevertShipment shipmentId={s.id} enquiryRef={s.enquiry_ref} />
      </section>
    </div>
  );
}

/**
 * When and on what it moves — named for the mode.
 *
 * The ETD is also written to the sailing date the quote set, so the two dates
 * a booking carries cannot tell different stories about the same departure.
 */
function Schedule({
  shipment: s,
  mode,
  carriers,
  busy,
  save,
}: {
  shipment: Shipment;
  mode: Shipment["transport_mode"];
  carriers: Partner[];
  busy: string | null;
  save: (key: string, patch: Partial<Shipment>) => Promise<void>;
}) {
  const air = mode === "air";
  const sea = mode === "sea_lcl" || mode === "sea_fcl";
  const title = air ? "Flight schedule" : sea ? "Vessel schedule" : "Schedule";
  const place = air ? "Airport" : sea ? "Port" : "Place";

  return (
    <Collapsible
      id="shipment:schedule"
      title={title}
      icon={<CalendarClock size={12} className="shrink-0 text-text-muted" />}
    >
      {/*
        From the sailing schedule: the departure's carrier, vessel or flight,
        ports, dates and cut-offs in one go, and the link to it kept. Picked
        values are copied, so a later change to the schedule is something the
        desk sees and decides on, not a silent change to this booking.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SchedulePicker
          mode={air ? "air" : sea ? "sea" : null}
          from={s.port_of_loading ?? s.origin}
          to={s.port_of_discharge ?? s.destination}
          onPick={(x) =>
            save("schedule", {
              schedule_id: x.id,
              carrier: x.carrier ?? s.carrier,
              ...(x.mode === "air"
                ? { flight_number: x.flight_number ?? s.flight_number }
                : { vessel: x.vessel ?? s.vessel, voyage: x.voyage ?? s.voyage }),
              etd: x.etd,
              sailing_date: x.etd,
              eta: x.eta ?? s.eta,
              port_of_loading: x.port_of_loading,
              port_of_discharge: x.port_of_discharge,
              cargo_cutoff: x.cfs_cutoff ?? x.port_cutoff ?? s.cargo_cutoff,
              si_cutoff: x.si_cutoff ?? s.si_cutoff,
            })
          }
        />
        {s.schedule_id && (
          <Link to="/sailing-schedule" className="font-mono text-[11.5px] text-text-accent hover:underline">
            From {s.schedule_id}
          </Link>
        )}
      </div>

      <datalist id="carrier-names">
        {carriers.map((c) => (
          <option key={c.id} value={c.organisation || c.name} />
        ))}
      </datalist>

      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-4">
        <Field label={air ? "Airline" : sea ? "Shipping line / co-loader" : "Transporter"}>
          <TextSave
            value={s.carrier ?? ""}
            list="carrier-names"
            placeholder={air ? "Emirates SkyCargo" : sea ? "MSC" : ""}
            busy={busy === "carrier"}
            onSave={(v) => void save("carrier", { carrier: v || null })}
          />
        </Field>

        {air ? (
          <Field label="Flight number">
            <TextSave
              value={s.flight_number ?? ""}
              placeholder="EK 543"
              busy={busy === "flight"}
              onSave={(v) => void save("flight", { flight_number: v ? v.toUpperCase() : null })}
            />
          </Field>
        ) : sea ? (
          <>
            <Field label="Vessel">
              <TextSave
                value={s.vessel ?? ""}
                busy={busy === "vessel"}
                onSave={(v) => void save("vessel", { vessel: v || null })}
              />
            </Field>
            <Field label="Voyage">
              <TextSave
                value={s.voyage ?? ""}
                busy={busy === "voyage"}
                onSave={(v) => void save("voyage", { voyage: v || null })}
              />
            </Field>
          </>
        ) : null}

        <Field label="Carrier booking number">
          <TextSave
            value={s.booking_number ?? ""}
            busy={busy === "booking"}
            onSave={(v) => void save("booking", { booking_number: v || null })}
          />
        </Field>

        <Field label="ETD date">
          <TextSave
            type="date"
            value={(s.etd ?? "").slice(0, 10)}
            busy={busy === "etd"}
            onSave={(v) => void save("etd", { etd: v || null, sailing_date: v || null })}
          />
        </Field>
        <Field label="ETD time">
          <TextSave
            type="time"
            value={(s.etd_time ?? "").slice(0, 5)}
            busy={busy === "etd_time"}
            onSave={(v) => void save("etd_time", { etd_time: v || null })}
          />
        </Field>
        <Field label="ETA date">
          <TextSave
            type="date"
            value={(s.eta ?? "").slice(0, 10)}
            busy={busy === "eta"}
            onSave={(v) => void save("eta", { eta: v || null })}
          />
        </Field>
        <Field label="ETA time">
          <TextSave
            type="time"
            value={(s.eta_time ?? "").slice(0, 5)}
            busy={busy === "eta_time"}
            onSave={(v) => void save("eta_time", { eta_time: v || null })}
          />
        </Field>

        <Field label={`${place} of loading`}>
          <TextSave
            value={s.port_of_loading ?? ""}
            busy={busy === "pol"}
            onSave={(v) => void save("pol", { port_of_loading: v || null })}
          />
        </Field>
        <Field label={`${place} of discharge`}>
          <TextSave
            value={s.port_of_discharge ?? ""}
            busy={busy === "pod"}
            onSave={(v) => void save("pod", { port_of_discharge: v || null })}
          />
        </Field>

        {sea && (
          <>
            <Field label="CFS location">
              <TextSave
                value={s.cfs_location ?? ""}
                busy={busy === "cfs"}
                onSave={(v) => void save("cfs", { cfs_location: v || null })}
              />
            </Field>
            <Field label="Cargo cut-off">
              <TextSave
                type="date"
                value={(s.cargo_cutoff ?? "").slice(0, 10)}
                busy={busy === "cutoff"}
                onSave={(v) => void save("cutoff", { cargo_cutoff: v || null })}
              />
            </Field>
            <Field label="SI cut-off">
              <TextSave
                type="date"
                value={(s.si_cutoff ?? "").slice(0, 10)}
                busy={busy === "si"}
                onSave={(v) => void save("si", { si_cutoff: v || null })}
              />
            </Field>
          </>
        )}
      </div>
    </Collapsible>
  );
}

/**
 * Every leg, with who carries it and whether it has happened.
 *
 * A new leg starts where the last one ended — the desk types the next place,
 * not the same one twice.
 */
function Routings({ shipmentId, carriers }: { shipmentId: string; carriers: Partner[] }) {
  const [rows, setRows] = useState<Routing[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await routingsFor(shipmentId));
    } catch (e) {
      setError(failureText(e, "Could not load the routings.").message);
    }
  }, [shipmentId]);

  // Changed by anybody, read again (the page's subscription, 084).
  const live = useLiveVersion("shipment_routings");
  useEffect(() => {
    void load();
  }, [load, live]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  const last = rows[rows.length - 1];

  return (
    <Collapsible
      id="shipment:routings"
      title="Routings"
      icon={<Route size={12} className="shrink-0 text-text-muted" />}
      badge={rows.length ? `${rows.length} ${rows.length === 1 ? "leg" : "legs"}` : undefined}
    >
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-surface-2 text-left text-[11px] font-medium text-text-secondary">
                {["Move", "From", "To", "ETD", "ETA", "Carrier / vessel", "Voyage / flight", "Vehicle no.", "Driver", "Status", ""].map(
                  (h) => (
                    <th key={h} className="px-2 py-2 font-medium">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-1 py-1">
                    <select
                      value={r.move}
                      onChange={(e) =>
                        void run(r.id, () => updateRouting(r.id, { move: e.target.value as RoutingMove }))
                      }
                      className="h-8 w-full"
                    >
                      {(Object.keys(MOVE_LABEL) as RoutingMove[]).map((m) => (
                        <option key={m} value={m}>
                          {MOVE_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <Cell value={r.from_place} onSave={(v) => run(r.id, () => updateRouting(r.id, { from_place: v }))} />
                  <Cell value={r.to_place} onSave={(v) => run(r.id, () => updateRouting(r.id, { to_place: v }))} />
                  <Cell type="date" value={r.etd} onSave={(v) => run(r.id, () => updateRouting(r.id, { etd: v }))} />
                  <Cell type="date" value={r.eta} onSave={(v) => run(r.id, () => updateRouting(r.id, { eta: v }))} />
                  <Cell list="carrier-names" value={r.carrier} onSave={(v) => run(r.id, () => updateRouting(r.id, { carrier: v }))} />
                  <Cell value={r.voyage_flight} onSave={(v) => run(r.id, () => updateRouting(r.id, { voyage_flight: v }))} />
                  <Cell value={r.vehicle_number} onSave={(v) => run(r.id, () => updateRouting(r.id, { vehicle_number: v ? v.toUpperCase() : null }))} />
                  <Cell value={r.driver_name} onSave={(v) => run(r.id, () => updateRouting(r.id, { driver_name: v }))} />
                  <td className="px-1 py-1">
                    <select
                      value={r.status}
                      onChange={(e) =>
                        void run(r.id, () =>
                          updateRouting(r.id, { status: e.target.value as RoutingStatus })
                        )
                      }
                      className="h-8 w-full"
                    >
                      {(Object.keys(ROUTING_STATUS_LABEL) as RoutingStatus[]).map((st) => (
                        <option key={st} value={st}>
                          {ROUTING_STATUS_LABEL[st]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => void run(`rm:${r.id}`, () => removeRouting(r.id))}
                      disabled={busy !== null}
                      className="rounded p-1 text-text-muted hover:text-text-danger disabled:opacity-60"
                      aria-label="Remove this leg"
                    >
                      {busy === `rm:${r.id}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        onClick={() =>
          void run("add", () =>
            addRouting(shipmentId, (last?.position ?? 0) + 1, {
              from_place: last?.to_place ?? null,
              move: last?.move ?? "road",
            })
          )
        }
        disabled={busy !== null}
        className={`${rows.length ? "mt-3" : ""} flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60`}
      >
        {busy === "add" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        Add routing
      </button>
      {!rows.length && (
        <p className="mt-2 text-[11.5px] text-text-muted">
          For a job with more than one leg — a truck to the airport, the flight, a truck to the
          consignee — each with its own carrier, dates and status.
        </p>
      )}
    </Collapsible>
  );
}

/** One cell of the routings table: saved when you leave it. */
function Cell({
  value,
  onSave,
  type = "text",
  list,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  type?: string;
  list?: string;
}) {
  const shown = type === "date" ? (value ?? "").slice(0, 10) : (value ?? "");
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = (v: string) => v.trim() !== shown && onSave(v.trim() || null);
  return (
    <td className="px-1 py-1">
      <input
        type={type}
        value={draft}
        list={list}
        onChange={(e) => {
          setDraft(e.target.value);
          if (type === "date") commit(e.target.value);
        }}
        onBlur={() => type !== "date" && commit(draft)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-8 w-full min-w-[90px]"
      />
    </td>
  );
}
