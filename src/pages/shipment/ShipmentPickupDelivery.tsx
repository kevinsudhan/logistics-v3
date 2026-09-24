import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Plus,
  Receipt,
  Send,
  Trash2,
  Truck,
  Undo2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import Collapsible from "../../components/Collapsible";
import ComposeMail from "../../components/ComposeMail";
import Select from "../../components/Select";
import StatusPill from "../../components/StatusPill";
import { Field, Segmented, TextSave } from "../../components/formControls";
import { useShipment } from "../ShipmentDetail";
import { useAuth } from "../../lib/auth";
import { failureText } from "../../lib/errorText";
import { STATUS_WORDS, ewayState, handoverIssues, movementStatus, moveTitle, readEwayBill, statusStrip, type MovementStatus } from "../../lib/movements";
import { movementOrderHtml, movementOrderSubject } from "../../lib/shipmentUpdateMail";
import { fileUrl, listFiles, uploadFile, type EnquiryFile } from "../../services/attachments";
import { logEvent, updateEnquiry } from "../../services/enquiries";
import {
  addMovement,
  movementsFor,
  recordAttempt,
  recordMovementCost,
  removeMovement,
  updateMovement,
  type Movement,
  type MovementKind,
} from "../../services/movements";
import { listPartners, type Partner } from "../../services/partners";

/**
 * Collecting the cargo, and handing it over at the other end.
 *
 * ---------------------------------------------------------------------------
 * AS A TRANSPORT DESK RUNS IT (079)
 *
 * A job has as many pickups and deliveries as it needs — a consolidation
 * collects from two or three suppliers, a delivery can go in parts. Each one
 * moves through planned → requested → vehicle assigned → done, worked out
 * from what is filled in, with failed attempts kept and a new day planned.
 *
 * Each carries its papers: the lorry receipt, and the e-way bill that Indian
 * road movement of goods over ₹50,000 needs — with its validity worked out
 * (GST Rule 138) and a warning before it runs out. The handover is counted
 * against the booking; the signed LR or POD is filed with the job; the
 * transporter's charge becomes a draft bill on the Costs tab.
 *
 * WHAT LIVES WHERE
 *
 * The first pickup's and first delivery's address are the job's own, on the
 * enquiry (Service details shows the same), and are edited here in place.
 * The workflow step is done when the last of its moves is done, and due on
 * the earliest planned day.
 * ---------------------------------------------------------------------------
 */

type Ctx = ReturnType<typeof useShipment>;

export default function ShipmentPickupDelivery() {
  const { shipment, enquiry, reload } = useShipment();
  const [moves, setMoves] = useState<Movement[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [files, setFiles] = useState<EnquiryFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, f] = await Promise.all([movementsFor(shipment.id), listFiles(shipment.enquiry_ref).catch(() => [] as EnquiryFile[])]);
      setMoves(m);
      setFiles(f);
    } catch (e) {
      setError(failureText(e, "Could not load the pickups and deliveries.").message);
    } finally {
      setLoaded(true);
    }
  }, [shipment.id, shipment.enquiry_ref]);

  useEffect(() => {
    void load();
    void listPartners()
      .then(setPartners)
      .catch(() => setPartners([]));
  }, [load]);

  const transporters = partners.filter((p) => p.role === "cfs_transport" || p.role === "other");
  const locked = Boolean(shipment.signed_off_at);

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0 underline">
            Dismiss
          </button>
        </div>
      )}
      {locked && (
        <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] text-text-secondary">
          This job is signed off; its pickups and deliveries are closed with it.
        </p>
      )}
      {!loaded ? (
        <p className="flex items-center gap-2 py-6 text-[12px] text-text-muted">
          <Loader2 size={13} className="animate-spin" /> Loading…
        </p>
      ) : (
        (["pickup", "delivery"] as MovementKind[]).map((kind) => (
          <KindSection
            key={kind}
            kind={kind}
            moves={moves.filter((m) => m.kind === kind)}
            all={moves}
            ctx={{ shipment, enquiry, reload }}
            transporters={transporters}
            files={files}
            locked={locked}
            onSaved={async () => {
              await load();
              // The step, and perhaps the stage, moved with it.
              await reload();
            }}
            onError={setError}
          />
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One kind: every pickup, or every delivery
// ---------------------------------------------------------------------------

function KindSection({
  kind,
  moves,
  all,
  ctx,
  transporters,
  files,
  locked,
  onSaved,
  onError,
}: {
  kind: MovementKind;
  moves: Movement[];
  all: Movement[];
  ctx: Pick<Ctx, "shipment" | "enquiry" | "reload">;
  transporters: Partner[];
  files: EnquiryFile[];
  locked: boolean;
  onSaved: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const pickup = kind === "pickup";
  const required = pickup ? ctx.enquiry?.pickup_required : ctx.enquiry?.delivery_required;
  const done = moves.filter((m) => m.actual_at).length;

  const badge =
    moves.length === 0 ? (required === false ? "Not required" : "Not arranged") : moves.length > 1 ? `${done} of ${moves.length} done` : badgeFor(moves[0]);

  async function add() {
    setAdding(true);
    onError(null);
    try {
      await addMovement(ctx.shipment.id, kind, all);
      await onSaved();
    } catch (e) {
      onError(failureText(e, `Could not add the ${kind}.`).message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <Collapsible
      id={`shipment:${kind}`}
      title={pickup ? "Pickups" : "Deliveries"}
      icon={pickup ? <Truck size={12} className="shrink-0 text-text-muted" /> : <MapPin size={12} className="shrink-0 text-text-muted" />}
      badge={badge}
      defaultOpen={required !== false}
    >
      {required === false && (
        <p className="mb-3 text-[12px] text-text-secondary">
          {pickup ? "Not required — the shipper delivers the cargo to us." : "Not required — the job ends at the port or airport of discharge."} Change this
          under Service details on the Shipment details tab.
        </p>
      )}
      {required == null && (
        <p className="mb-3 text-[11.5px] text-text-muted">
          Nobody has said whether a {kind} is needed — Service details on the Shipment details tab records it.
        </p>
      )}

      {moves.length === 0 ? (
        required !== false && (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
            <p className="text-[12.5px] text-text-secondary">{pickup ? "No pickup arranged yet." : "No delivery arranged yet."}</p>
            <button
              type="button"
              disabled={adding || locked}
              onClick={() => void add()}
              className="mx-auto mt-3 flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Arrange the {kind}
            </button>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {moves.map((m, i) => (
            <MoveCard
              key={m.id}
              m={m}
              index={i}
              count={moves.length}
              ctx={ctx}
              transporters={transporters}
              files={files}
              locked={locked}
              onSaved={onSaved}
              onError={onError}
            />
          ))}
          {!locked && (
            <button
              type="button"
              disabled={adding}
              onClick={() => void add()}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
              title={pickup ? "Collecting from another supplier or address" : "Delivering part of the cargo somewhere else, or on another day"}
            >
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {pickup ? "Add another pickup" : "Add another delivery"}
            </button>
          )}
        </div>
      )}
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// One pickup or delivery
// ---------------------------------------------------------------------------

const TONE: Record<MovementStatus, "success" | "warning" | "danger" | "accent" | "neutral"> = {
  not_arranged: "neutral",
  planned: "neutral",
  requested: "accent",
  assigned: "accent",
  failed: "danger",
  done: "success",
};

function MoveCard({
  m,
  index,
  count,
  ctx,
  transporters,
  files,
  locked,
  onSaved,
  onError,
}: {
  m: Movement;
  index: number;
  count: number;
  ctx: Pick<Ctx, "shipment" | "enquiry">;
  transporters: Partner[];
  files: EnquiryFile[];
  locked: boolean;
  onSaved: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const { shipment, enquiry } = ctx;
  const { session } = useAuth();
  const kind = m.kind;
  const pickup = kind === "pickup";
  const status = movementStatus(m);
  const done = status === "done";

  const [open, setOpen] = useState(!done);
  const [busy, setBusy] = useState<string | null>(null);
  const [actual, setActual] = useState(() => toLocalInput(new Date().toISOString()));
  const [composing, setComposing] = useState(false);
  const [failing, setFailing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [ewbError, setEwbError] = useState<string | null>(null);
  const proofInput = useRef<HTMLInputElement>(null);

  // The first of each kind keeps its address on the enquiry: one record for the job.
  const first = m.seq === 1;
  const door = (first ? (pickup ? enquiry?.pickup_location : enquiry?.delivery_location) : m.place) ?? "";
  const transporter = transporters.find((p) => p.id === m.transporter_partner_id);
  const transporterEmail = transporter?.emails?.[0] ?? null;
  const proof = files.find((f) => f.id === m.pod_file_id);
  const direction = shipment.trade_direction;
  // An e-way bill is Indian road movement: the pickup on an export, the delivery on an import.
  const ewayApplies = direction === "export" ? pickup : direction === "import" ? !pickup : direction !== "cross_trade";
  const cargoValue = shipment.invoice_value_inr === null ? null : Number(shipment.invoice_value_inr);
  const eway = ewayApplies ? ewayState(m, cargoValue, new Date()) : ({ state: "not_needed" } as const);
  const issues = handoverIssues(
    m,
    {
      pieces: shipment.piece_count,
      grossKg: shipment.gross_weight_kg === null ? null : Number(shipment.gross_weight_kg),
    },
    count > 1 ? 1 / count : 1,
  );
  const fcl = shipment.transport_mode === "sea_fcl";
  const lastAttempt = [...(m.attempts ?? [])].sort((a, b) => (a.at < b.at ? -1 : 1)).pop();

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    onError(null);
    try {
      await fn();
      await onSaved();
    } catch (e) {
      onError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }
  const save = (key: string, patch: Partial<Movement>) => run(key, () => updateMovement(m.id, patch));
  const text = (k: keyof Movement) => {
    const x = m[k];
    return x === null || x === undefined ? "" : String(x);
  };

  const title = moveTitle(kind, index + 1, count);
  const summary = [
    m.actual_at ? shortWhen(m.actual_at) : m.planned_date ? `Planned ${shortDay(m.planned_date)}` : null,
    m.vehicle_number,
    m.lr_number ? `LR ${m.lr_number}` : null,
    door ? door.split(",")[0] : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`rounded-xl border bg-surface-1 ${status === "failed" ? "border-text-danger/40" : "border-border"}`}>
      {/* ---- the line the desk scans ---- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 text-left text-[13px] font-semibold text-text-primary"
        >
          <ChevronDown size={14} className={`shrink-0 text-text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
          {title}
        </button>
        <StatusPill tone={TONE[status]}>{done ? (pickup ? "Picked up" : "Delivered") : STATUS_WORDS[status]}</StatusPill>
        {eway.state === "expired" || eway.state === "expiring" || eway.state === "needed" ? (
          <StatusPill tone={eway.state === "expired" ? "danger" : "warning"}>
            {eway.state === "needed" ? "E-way bill needed" : eway.state === "expired" ? "E-way bill expired" : "E-way bill expiring"}
          </StatusPill>
        ) : null}
        {issues.length > 0 && <StatusPill tone="warning">Handover exception</StatusPill>}
        {/* Its own line on a phone, where the pills leave it no room. */}
        <span className="order-last w-full min-w-0 truncate text-[11.5px] text-text-muted sm:order-none sm:w-auto sm:flex-1">{summary}</span>
        {!locked &&
          (confirmRemove ? (
            <span className="ml-auto flex items-center gap-1.5 text-[11.5px]">
              Remove {title.toLowerCase()}?
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run("remove", () => removeMovement(m.id))}
                className="rounded-md bg-bg-danger px-2 py-1 font-medium text-text-danger"
              >
                {busy === "remove" ? <Loader2 size={12} className="animate-spin" /> : "Remove"}
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)} className="px-1 text-text-muted hover:text-text-primary">
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              title={`Remove ${title.toLowerCase()}`}
              aria-label={`Remove ${title.toLowerCase()}`}
              className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-danger"
            >
              <Trash2 size={13} />
            </button>
          ))}
      </div>

      {open && (
        <div className="border-t border-border px-3 pb-4 pt-3 sm:px-4">
          {/* ---- where it stands ---- */}
          <ol className="mb-4 grid grid-cols-4" aria-label="Progress">
            {statusStrip(m).map((st, i) => (
              <li key={st.label} className="relative flex min-w-0 flex-col items-center text-center">
                {i > 0 && <span aria-hidden className={`absolute right-1/2 top-[11px] h-0.5 w-full ${st.done ? "bg-brand" : "bg-border"}`} />}
                <span
                  className={`relative grid h-6 w-6 place-items-center rounded-full border-2 text-[11px] ${
                    st.done ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-muted"
                  }`}
                >
                  {st.done ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                <span className={`mt-1 px-0.5 text-[11px] leading-tight ${st.done ? "font-medium text-text-primary" : "text-text-muted"}`}>
                  {i === 3 ? (pickup ? "Picked up" : "Delivered") : st.label}
                </span>
              </li>
            ))}
          </ol>

          {/* ---- what to do next ---- */}
          <div className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5 ${done ? "bg-bg-success" : "bg-surface-2"}`}>
            {done ? (
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-success">
                <Check size={14} />
                {pickup ? "Picked up" : "Delivered"} {longWhen(m.actual_at!)}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="datetime-local"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  disabled={locked}
                  className="h-8"
                  aria-label={`When it was ${pickup ? "picked up" : "delivered"}`}
                />
                <button
                  type="button"
                  disabled={busy !== null || !actual || locked}
                  onClick={() =>
                    void save("done", {
                      actual_at: new Date(actual).toISOString(),
                    })
                  }
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {busy === "done" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Mark {pickup ? "picked up" : "delivered"}
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {done ? (
                <button
                  type="button"
                  disabled={busy !== null || locked}
                  onClick={() => void save("undo", { actual_at: null })}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-60"
                >
                  <Undo2 size={13} /> Undo
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null || locked}
                  onClick={() => setFailing((f) => !f)}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
                >
                  <XCircle size={13} /> Failed attempt
                </button>
              )}
              {!done && (
                <button
                  type="button"
                  disabled={!transporterEmail || locked}
                  onClick={() => setComposing(true)}
                  title={transporterEmail ? `Send ${transporterEmail} the ${kind} order` : "Choose a transporter from the partner book, with an email, first"}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50"
                >
                  <Send size={13} /> {m.requested_at ? "Send the order again" : "Send transport order"}
                </button>
              )}
            </div>
          </div>

          {failing && !done && (
            <AttemptForm
              kind={kind}
              busy={busy === "attempt"}
              onCancel={() => setFailing(false)}
              onSave={(reason, again) =>
                void run("attempt", async () => {
                  await recordAttempt(m, reason, again);
                  setFailing(false);
                })
              }
            />
          )}

          {m.requested_at && (
            <p className="-mt-2 mb-3 text-[11.5px] text-text-muted">
              Transport order sent {longWhen(m.requested_at)}
              {m.transporter ? ` to ${m.transporter}` : ""}.
            </p>
          )}

          {(m.attempts ?? []).length > 0 && (
            <div className="mb-4 rounded-lg border border-text-danger/25 bg-bg-danger/40 px-3 py-2">
              <p className="mb-1 text-[11.5px] font-medium text-text-danger">
                {m.attempts.length === 1 ? "One failed attempt" : `${m.attempts.length} failed attempts`}
                {status === "failed" && lastAttempt && " — plan a new day to go again"}
              </p>
              <ul className="space-y-0.5 text-[11.5px] text-text-secondary">
                {[...m.attempts]
                  .sort((a, b) => (a.at < b.at ? -1 : 1))
                  .map((a) => (
                    <li key={a.at}>
                      <span className="text-text-muted">{longWhen(a.at)}</span> — {a.reason}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {/* ---- the route and the time ---- */}
          <Group title="Route and time">
            <Field
              label={pickup ? "Collect from" : "Deliver to"}
              className="sm:col-span-2"
              hint={first ? "The job's own address — Service details shows the same." : undefined}
            >
              <TextSave
                value={door}
                placeholder={pickup ? "The supplier's factory or warehouse" : "The consignee's door"}
                busy={busy === "door"}
                onSave={(x) =>
                  void run("door", () =>
                    first
                      ? updateEnquiry(shipment.enquiry_ref, pickup ? { pickup_location: x || null } : { delivery_location: x || null })
                      : updateMovement(m.id, { place: x || null }),
                  )
                }
              />
            </Field>
            <Field label={pickup ? "Deliver to" : "Collect from"} className="sm:col-span-2">
              <TextSave
                value={text("drop_point")}
                placeholder={pickup ? "CFS, air cargo terminal or our warehouse" : "Airport, CFS or our warehouse"}
                busy={busy === "drop_point"}
                onSave={(x) => void save("drop_point", { drop_point: x || null })}
              />
            </Field>
            <Field label="Planned date" hint={index === 0 ? "The earliest planned day is the step's due date." : undefined}>
              <TextSave
                type="date"
                value={text("planned_date").slice(0, 10)}
                busy={busy === "planned_date"}
                onSave={(x) => void save("planned_date", { planned_date: x || null })}
              />
            </Field>
            <Field label="Window">
              <div className="flex items-center gap-1.5">
                <TextSave
                  type="time"
                  ariaLabel="From"
                  value={text("planned_time").slice(0, 5)}
                  busy={busy === "planned_time"}
                  onSave={(x) => void save("planned_time", { planned_time: x || null })}
                />
                <span className="text-[11px] text-text-muted">to</span>
                <TextSave
                  type="time"
                  ariaLabel="Until"
                  value={text("window_end").slice(0, 5)}
                  busy={busy === "window_end"}
                  onSave={(x) => void save("window_end", { window_end: x || null })}
                />
              </div>
            </Field>
            <Field label="Contact at the door">
              <TextSave value={text("contact_name")} busy={busy === "contact_name"} onSave={(x) => void save("contact_name", { contact_name: x || null })} />
            </Field>
            <Field label="Contact phone">
              <TextSave
                type="tel"
                value={text("contact_phone")}
                busy={busy === "contact_phone"}
                onSave={(x) => void save("contact_phone", { contact_phone: x || null })}
              />
            </Field>
          </Group>

          {/* ---- the truck ---- */}
          <Group title="Transport">
            <Field label="Transporter" className="sm:col-span-2">
              {transporters.length ? (
                <Select
                  label="Transporter"
                  value={m.transporter_partner_id ?? ""}
                  options={[
                    { value: "", label: "Choose from the partner book" },
                    ...transporters.map((p) => ({
                      value: p.id,
                      label: p.organisation || p.name,
                      hint: p.emails?.[0] ?? "no email",
                    })),
                  ]}
                  onChange={(id) => {
                    const p = transporters.find((t) => t.id === id);
                    void save("transporter", {
                      transporter_partner_id: p?.id ?? null,
                      transporter: p ? p.organisation || p.name : null,
                    });
                  }}
                />
              ) : (
                <TextSave
                  value={text("transporter")}
                  placeholder="No transporters in the partner book"
                  busy={busy === "transporter"}
                  onSave={(x) => void save("transporter", { transporter: x || null })}
                />
              )}
            </Field>
            <Field label="Vehicle number">
              <TextSave
                value={text("vehicle_number")}
                placeholder="TN 01 AB 1234"
                busy={busy === "vehicle"}
                onSave={(x) =>
                  void save("vehicle", {
                    vehicle_number: x ? x.toUpperCase() : null,
                  })
                }
              />
            </Field>
            <Field label="Driver">
              <TextSave value={text("driver_name")} busy={busy === "driver"} onSave={(x) => void save("driver", { driver_name: x || null })} />
            </Field>
            <Field label="Driver phone">
              <TextSave
                type="tel"
                value={text("driver_phone")}
                busy={busy === "driver_phone"}
                onSave={(x) => void save("driver_phone", { driver_phone: x || null })}
              />
            </Field>
            <Field label="LR number" hint="The lorry receipt the transporter issues.">
              <TextSave value={text("lr_number")} busy={busy === "lr_number"} onSave={(x) => void save("lr_number", { lr_number: x || null })} />
            </Field>
            <Field label="LR date">
              <TextSave type="date" value={text("lr_date")} busy={busy === "lr_date"} onSave={(x) => void save("lr_date", { lr_date: x || null })} />
            </Field>
          </Group>

          {/* ---- the e-way bill ---- */}
          {ewayApplies && (
            <Group title="E-way bill" note={<EwayNote state={eway} />}>
              <Field label="E-way bill number">
                <TextSave
                  value={text("eway_bill_no")}
                  placeholder="12 digits"
                  busy={busy === "eway_bill_no"}
                  onSave={(x) => {
                    const r = readEwayBill(x);
                    setEwbError(r.error);
                    if (!r.error) void save("eway_bill_no", { eway_bill_no: r.value });
                  }}
                />
                {ewbError && <p className="mt-1 text-[11px] text-text-danger">{ewbError}</p>}
              </Field>
              <Field label="Generated (with vehicle)" hint="When Part B was entered; the validity runs from here.">
                <DateTimeSave value={m.eway_bill_at} busy={busy === "eway_bill_at"} onSave={(iso) => void save("eway_bill_at", { eway_bill_at: iso })} />
              </Field>
              <Field label="Distance (km)">
                <TextSave
                  type="number"
                  value={text("eway_distance_km")}
                  placeholder="As on the bill"
                  busy={busy === "eway_distance_km"}
                  onSave={(x) =>
                    void save("eway_distance_km", {
                      eway_distance_km: x === "" ? null : Math.round(Number(x)),
                    })
                  }
                />
              </Field>
              <Field label="Over-dimensional cargo">
                <Segmented
                  options={[
                    { value: "no", label: "No" },
                    { value: "yes", label: "Yes — ODC" },
                  ]}
                  value={m.eway_odc ? "yes" : "no"}
                  busy={busy === "eway_odc"}
                  onChange={(v) => void save("eway_odc", { eway_odc: v === "yes" })}
                />
              </Field>
            </Group>
          )}

          {/* ---- the handover ---- */}
          <Group
            title="Handover"
            note={
              issues.length > 0 ? (
                <p className="flex items-start gap-1.5 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
                  <AlertTriangle size={13} className="mt-px shrink-0" />
                  {issues.join(" · ")}
                </p>
              ) : null
            }
          >
            <Field label={pickup ? "Pieces collected" : "Pieces delivered"}>
              <TextSave
                type="number"
                value={text("pieces")}
                placeholder={shipment.piece_count ? `${shipment.piece_count} booked` : ""}
                busy={busy === "pieces"}
                onSave={(x) =>
                  void save("pieces", {
                    pieces: x === "" ? null : Math.max(0, Math.round(Number(x))),
                  })
                }
              />
            </Field>
            <Field label="Gross weight (kg)">
              <TextSave
                type="number"
                value={text("gross_weight_kg")}
                placeholder={shipment.gross_weight_kg ? `${Number(shipment.gross_weight_kg).toLocaleString("en-IN")} booked` : ""}
                busy={busy === "gross_weight_kg"}
                onSave={(x) =>
                  void save("gross_weight_kg", {
                    gross_weight_kg: x === "" ? null : Math.max(0, Number(x)),
                  })
                }
              />
            </Field>
            <Field label="Condition" className="sm:col-span-2">
              <Segmented
                options={[
                  { value: "good", label: "Good" },
                  { value: "damaged", label: "Damaged" },
                  { value: "short", label: "Short" },
                ]}
                value={m.condition}
                busy={busy === "condition"}
                onChange={(v) => void save("condition", { condition: v })}
              />
            </Field>
            {(m.condition === "damaged" || m.condition === "short" || m.exception_note) && (
              <Field label="What was wrong" className="sm:col-span-2 lg:col-span-4">
                <TextSave
                  value={text("exception_note")}
                  placeholder="Two cartons crushed; noted on the LR"
                  busy={busy === "exception_note"}
                  onSave={(x) => void save("exception_note", { exception_note: x || null })}
                />
              </Field>
            )}
            {(fcl || m.container_number || m.seal_number) && (
              <>
                <Field label="Container number">
                  <TextSave
                    value={text("container_number")}
                    placeholder={shipment.container_number ?? "ABCU 123456 7"}
                    busy={busy === "container_number"}
                    onSave={(x) =>
                      void save("container_number", {
                        container_number: x ? x.replace(/\s+/g, "").toUpperCase() : null,
                      })
                    }
                  />
                </Field>
                <Field label="Seal number">
                  <TextSave
                    value={text("seal_number")}
                    busy={busy === "seal_number"}
                    onSave={(x) =>
                      void save("seal_number", {
                        seal_number: x ? x.toUpperCase() : null,
                      })
                    }
                  />
                </Field>
              </>
            )}
            <Field label={pickup ? "Handed over by" : "Received by"}>
              <TextSave
                value={text("received_by")}
                placeholder={pickup ? "Who released the cargo" : "Who signed for it"}
                busy={busy === "received_by"}
                onSave={(x) => void save("received_by", { received_by: x || null })}
              />
            </Field>
            <Field label={pickup ? "Signed LR" : "Proof of delivery"} className="sm:col-span-2 lg:col-span-3" hint="Filed with the job's documents, protected.">
              <div className="flex h-9 items-center gap-2">
                {proof ? (
                  <button
                    type="button"
                    onClick={() =>
                      void fileUrl(proof.path)
                        .then((u) => window.open(u, "_blank", "noopener"))
                        .catch((e) => onError(failureText(e, "Could not open it.").message))
                    }
                    className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-text-accent hover:underline"
                  >
                    <ExternalLink size={12} className="shrink-0" />
                    <span className="truncate">{proof.name}</span>
                  </button>
                ) : (
                  <span className="text-[12px] text-text-muted">None attached</span>
                )}
                <button
                  type="button"
                  disabled={busy !== null || locked}
                  onClick={() => proofInput.current?.click()}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
                >
                  {busy === "proof" ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
                  {proof ? "Replace" : pickup ? "Attach LR" : "Attach POD"}
                </button>
                <input
                  ref={proofInput}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void run("proof", async () => {
                      const f = await uploadFile({
                        enquiryRef: shipment.enquiry_ref,
                        file,
                        documentType: pickup ? "Lorry receipt (LR)" : "Proof of delivery",
                        referenceNumber: m.lr_number || shipment.id,
                        protected: true,
                      });
                      await updateMovement(m.id, { pod_file_id: f.id });
                    });
                  }}
                />
              </div>
            </Field>
          </Group>

          {/* ---- what it costs ---- */}
          <Group title="Cost">
            <Field label="Transporter's charge (₹)" hint={m.bill_id ? "On the bill now; change the amount there." : undefined}>
              <TextSave
                type="number"
                value={text("cost_inr")}
                placeholder="Freight for the trip"
                busy={busy === "cost_inr"}
                onSave={(x) =>
                  void save("cost_inr", {
                    cost_inr: x === "" ? null : Math.max(0, Number(x)),
                  })
                }
              />
            </Field>
            <div className="flex items-end sm:col-span-2 lg:col-span-3">
              {m.bill_id ? (
                <Link
                  to="../costs"
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-bg-success px-3 text-[12px] font-medium text-text-success hover:underline"
                >
                  <Receipt size={13} /> Recorded as a draft bill on Costs
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null || locked || !m.cost_inr || !m.transporter_partner_id}
                  title={
                    !m.transporter_partner_id
                      ? "Choose the transporter from the partner book first"
                      : !m.cost_inr
                        ? "Enter the charge first"
                        : "A draft vendor bill for this trip, on the Costs tab"
                  }
                  onClick={() => void run("cost", () => recordMovementCost(m.id))}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50"
                >
                  {busy === "cost" ? <Loader2 size={13} className="animate-spin" /> : <Receipt size={13} />}
                  Record as a cost
                </button>
              )}
            </div>
          </Group>

          <Field label="Instructions">
            <TextSave
              value={text("notes")}
              placeholder={pickup ? "Loading dock, timings, what to bring" : "Unloading, appointment, who to ask for"}
              busy={busy === "notes"}
              onSave={(x) => void save("notes", { notes: x || null })}
            />
          </Field>
        </div>
      )}

      {composing && transporterEmail && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          enquiryRef={shipment.enquiry_ref}
          reference={shipment.enquiry_ref}
          partnerId={transporter?.id ?? null}
          initial={{
            to: transporterEmail,
            subject: movementOrderSubject({
              kind,
              ref: shipment.enquiry_ref,
              date: m.planned_date,
            }),
            body: movementOrderHtml({
              kind,
              ref: shipment.enquiry_ref,
              shipmentId: shipment.id,
              partyName: transporter ? transporter.organisation || transporter.name : null,
              address: door || null,
              date: m.planned_date,
              time: m.planned_time,
              windowEnd: m.window_end,
              dropPoint: m.drop_point,
              contactName: m.contact_name,
              contactPhone: m.contact_phone,
              cargo: shipment.cargo,
              pieces: m.pieces ?? shipment.piece_count,
              grossKg: m.gross_weight_kg !== null ? Number(m.gross_weight_kg) : shipment.gross_weight_kg === null ? null : Number(shipment.gross_weight_kg),
              volumeCbm: shipment.volume_cbm === null ? null : Number(shipment.volume_cbm),
              hazardous: Boolean(enquiry?.hazardous),
              unNumber: shipment.un_number,
              ewayBill: m.eway_bill_no,
              containerNumber: m.container_number,
              sealNumber: m.seal_number,
              notes: m.notes,
            }),
          }}
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false);
            void run("requested", async () => {
              await updateMovement(m.id, {
                requested_at: new Date().toISOString(),
              });
              await logEvent(shipment.enquiry_ref, `${kind}_requested`, `${title} order sent to ${transporterEmail}`, {
                to: transporterEmail,
                shipment_id: shipment.id,
                movement_id: m.id,
              }).catch(() => {});
            });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Group({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {title === "E-way bill" ? <FileText size={11} /> : null}
        {title}
      </h4>
      {note && <div className="mb-3">{note}</div>}
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function EwayNote({ state: s }: { state: ReturnType<typeof ewayState> }) {
  const box = "flex items-start gap-1.5 rounded-lg px-3 py-2 text-[12px]";
  switch (s.state) {
    case "not_needed":
      return (
        <p className="text-[11.5px] text-text-muted">
          Needed for road movement of goods worth more than ₹50,000 (GST Rule 138). Valid a day per 200 km, or per 20 km over-dimensional.
        </p>
      );
    case "needed":
      return (
        <p className={`${box} bg-bg-warning text-text-warning`}>
          <AlertTriangle size={13} className="mt-px shrink-0" /> {s.why}
        </p>
      );
    case "incomplete":
      return <p className="text-[11.5px] text-text-muted">{s.why}</p>;
    case "valid":
      return (
        <p className={`${box} bg-bg-success text-text-success`}>
          <Check size={13} className="mt-px shrink-0" /> Valid {s.days === 1 ? "one day" : `${s.days} days`} — until {istWhen(s.expires)} IST.
        </p>
      );
    case "expiring":
      return (
        <p className={`${box} bg-bg-warning text-text-warning`}>
          <AlertTriangle size={13} className="mt-px shrink-0" /> Runs out {istWhen(s.expires)} IST. Extend it on the e-way bill portal if the cargo is not there
          by then.
        </p>
      );
    case "expired":
      return (
        <p className={`${box} bg-bg-danger text-text-danger`}>
          <AlertCircle size={13} className="mt-px shrink-0" /> Expired {istWhen(s.expires)} IST. The goods cannot move on it — extend it or generate a new one.
        </p>
      );
    case "lapsed":
      return (
        <p className={`${box} bg-bg-danger text-text-danger`}>
          <AlertCircle size={13} className="mt-px shrink-0" /> The handover came after the bill ran out ({istWhen(s.expires)} IST).
        </p>
      );
  }
}

function AttemptForm({
  kind,
  busy,
  onSave,
  onCancel,
}: {
  kind: MovementKind;
  busy: boolean;
  onSave: (reason: string, again: string | null) => void;
  onCancel: () => void;
}) {
  const reasons =
    kind === "pickup"
      ? ["Cargo not ready", "Documents not ready", "Premises closed", "Vehicle did not reach", "Vehicle unsuitable"]
      : ["Consignee not available", "Premises closed", "Refused", "Address wrong", "Vehicle did not reach"];
  const [reason, setReason] = useState("");
  const [again, setAgain] = useState("");
  return (
    <div className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-3">
      <p className="mb-2 text-[12px] font-medium text-text-primary">What went wrong?</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
              reason === r ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-secondary hover:text-text-primary"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1">
          <span className="mb-1 block text-[11px] text-text-muted">Reason</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="In your words" className="h-8 w-full" />
        </label>
        <label>
          <span className="mb-1 block text-[11px] text-text-muted">Go again on</span>
          <input type="date" value={again} onChange={(e) => setAgain(e.target.value)} className="h-8" />
        </label>
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => onSave(reason.trim(), again || null)}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} Record
        </button>
        <button type="button" onClick={onCancel} className="h-8 px-2 text-[12px] text-text-muted hover:text-text-primary">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** A date and time that saves when it changes, stored as an instant. */
function DateTimeSave({ value, busy, onSave }: { value: string | null; busy?: boolean; onSave: (iso: string | null) => void }) {
  const [draft, setDraft] = useState(value ? toLocalInput(value) : "");
  useEffect(() => setDraft(value ? toLocalInput(value) : ""), [value]);
  return (
    <div className="relative">
      <input
        type="datetime-local"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft ? new Date(draft).toISOString() : null;
          if ((next ?? "") !== (value ? new Date(value).toISOString() : "")) onSave(next);
        }}
        className="h-9 w-full pr-8"
      />
      {busy && <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-text-muted" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Words for dates
// ---------------------------------------------------------------------------

function badgeFor(m: Movement): string {
  const s = movementStatus(m);
  if (s === "done") return `${m.kind === "pickup" ? "Picked up" : "Delivered"} ${shortDay(m.actual_at!)}`;
  if (m.planned_date && s !== "failed") return `${STATUS_WORDS[s]} · ${shortDay(m.planned_date)}`;
  return STATUS_WORDS[s];
}

/** "4 Oct" */
function shortDay(d: string): string {
  const x = d.length === 10 ? new Date(`${d}T00:00:00`) : new Date(d);
  return x.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "4 Oct, 10:30" */
function shortWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "4 Oct 2026, 10:30" */
function longWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "5 Oct 2026, 23:59" on India's clock — an e-way bill's day is India's day. */
function istWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

/** An instant as "2026-10-01T10:30" in the browser's own time, for a datetime-local input. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
