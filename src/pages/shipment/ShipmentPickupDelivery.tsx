import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ExternalLink, Loader2, MapPin, Send, Truck, Undo2, UploadCloud } from "lucide-react";
import Collapsible from "../../components/Collapsible";
import ComposeMail from "../../components/ComposeMail";
import { Field, TextSave } from "../../components/formControls";
import { useShipment } from "../ShipmentDetail";
import { useAuth } from "../../lib/auth";
import { failureText } from "../../lib/errorText";
import { movementOrderHtml, movementOrderSubject } from "../../lib/shipmentUpdateMail";
import { fileUrl, listFiles, uploadFile, type EnquiryFile } from "../../services/attachments";
import { logEvent, updateEnquiry, type Enquiry } from "../../services/enquiries";
import { movementsFor, saveMovement, type Movement, type MovementKind } from "../../services/movements";
import { listPartners, type Partner } from "../../services/partners";

/**
 * Collecting the cargo, and handing it over at the other end.
 *
 * ---------------------------------------------------------------------------
 * WHAT LIVES WHERE
 *
 * Whether there is a pickup or a delivery, and the address, are the job's own
 * facts on the enquiry — the same fields Service details shows — and are
 * edited here in the same place. What this tab adds is the arranging: the
 * date, the contact at the door, the transporter, the truck and the driver,
 * the pieces, and for a delivery who signed and the signed proof.
 *
 * WIRED TO THE WORKFLOW (067)
 *
 * The planned date is the due date of the pickup or delivery step on the bar,
 * and recording it done ticks that step. Delivered here is Delivered on the
 * shipment.
 * ---------------------------------------------------------------------------
 */
export default function ShipmentPickupDelivery() {
  const { shipment, enquiry, reload } = useShipment();
  const [moves, setMoves] = useState<Movement[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [files, setFiles] = useState<EnquiryFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, f] = await Promise.all([
        movementsFor(shipment.id),
        listFiles(shipment.enquiry_ref).catch(() => [] as EnquiryFile[]),
      ]);
      setMoves(m);
      setFiles(f);
    } catch (e) {
      setError(failureText(e, "Could not load the pickup and delivery.").message);
    }
  }, [shipment.id, shipment.enquiry_ref]);

  useEffect(() => {
    void load();
    void listPartners()
      .then(setPartners)
      .catch(() => setPartners([]));
  }, [load]);

  const transporters = partners.filter((p) => p.role === "cfs_transport" || p.role === "other");

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}
      {(["pickup", "delivery"] as MovementKind[]).map((kind) => (
        <MovementSection
          key={kind}
          kind={kind}
          movement={moves.find((m) => m.kind === kind)}
          enquiry={enquiry}
          shipment={shipment}
          transporters={transporters}
          files={files}
          onSaved={async () => {
            await load();
            // The step, and perhaps the stage, moved with it.
            await reload();
          }}
          onError={setError}
        />
      ))}
    </div>
  );
}

function MovementSection({
  kind,
  movement: m,
  enquiry,
  shipment,
  transporters,
  files,
  onSaved,
  onError,
}: {
  kind: MovementKind;
  movement: Movement | undefined;
  enquiry: (Enquiry & { customer: unknown }) | null;
  shipment: ReturnType<typeof useShipment>["shipment"];
  transporters: Partner[];
  files: EnquiryFile[];
  onSaved: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const { session } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [actual, setActual] = useState(() => nowLocal());
  const [composing, setComposing] = useState(false);
  const podInput = useRef<HTMLInputElement>(null);

  const pickup = kind === "pickup";
  const required = pickup ? enquiry?.pickup_required : enquiry?.delivery_required;
  const address = (pickup ? enquiry?.pickup_location : enquiry?.delivery_location) ?? "";
  const done = Boolean(m?.actual_at);
  const pod = files.find((f) => f.id === m?.pod_file_id);
  const transporter = transporters.find((p) => p.id === m?.transporter_partner_id);
  const transporterEmail = transporter?.emails?.[0] ?? null;

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
  const save = (key: string, patch: Partial<Movement>) => run(key, () => saveMovement(shipment.id, kind, patch));
  const v = (k: keyof Movement) => (m?.[k] as string | number | null | undefined) ?? "";

  const title = pickup ? "Pickup" : "Delivery";
  const badge = done
    ? `${pickup ? "Picked up" : "Delivered"} ${new Date(m!.actual_at!).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : m?.planned_date
      ? `Planned ${new Date(`${m.planned_date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
      : required === false
        ? "Not required"
        : undefined;

  return (
    <Collapsible
      id={`shipment:${kind}`}
      title={title}
      icon={pickup ? <Truck size={12} className="shrink-0 text-text-muted" /> : <MapPin size={12} className="shrink-0 text-text-muted" />}
      badge={badge}
      defaultOpen={required !== false}
    >
      {required === false ? (
        <p className="text-[12px] text-text-secondary">
          {pickup
            ? "Not required — the shipper delivers the cargo to us."
            : "Not required — the job ends at the port or airport of discharge."}{" "}
          Change this under Service details on the Shipment details tab.
        </p>
      ) : (
        <>
          {required == null && (
            <p className="mb-3 text-[11.5px] text-text-muted">
              Nobody has said whether a {kind} is needed — Service details on the Shipment details
              tab records it.
            </p>
          )}

          {/* ---- status: the thing the desk looks for first ---- */}
          <div
            className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2.5 ${
              done ? "bg-bg-success" : "bg-surface-2"
            }`}
          >
            {done ? (
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-success">
                <Check size={14} />
                {pickup ? "Picked up" : "Delivered"}{" "}
                {new Date(m!.actual_at!).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="datetime-local"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  className="h-8"
                  aria-label={`When it was ${pickup ? "picked up" : "delivered"}`}
                />
                <button
                  type="button"
                  disabled={busy !== null || !actual}
                  onClick={() => void save("done", { actual_at: new Date(actual).toISOString() })}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {busy === "done" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Mark {pickup ? "picked up" : "delivered"}
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              {done && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void save("undo", { actual_at: null })}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-60"
                >
                  <Undo2 size={13} /> Undo
                </button>
              )}
              <button
                type="button"
                disabled={!transporterEmail}
                onClick={() => setComposing(true)}
                title={
                  transporterEmail
                    ? `Send ${transporterEmail} the ${kind} request`
                    : "Choose a transporter from the partner book with an email first"
                }
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50"
              >
                <Send size={13} /> Send {kind} request
              </button>
            </div>
          </div>

          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-3">
            <Field
              label={pickup ? "Collect from" : "Deliver to"}
              className="sm:col-span-2 md:col-span-3"
              hint="The same address Service details shows — one record for the job."
            >
              <TextSave
                value={address}
                placeholder={pickup ? "The shipper's factory or warehouse" : "The consignee's door"}
                busy={busy === "address"}
                onSave={(x) =>
                  void run("address", () =>
                    updateEnquiry(
                      shipment.enquiry_ref,
                      pickup ? { pickup_location: x || null } : { delivery_location: x || null }
                    )
                  )
                }
              />
            </Field>

            <Field label="Planned date" hint="Becomes the due date of this step on the workflow.">
              <TextSave
                type="date"
                value={String(v("planned_date")).slice(0, 10)}
                busy={busy === "planned_date"}
                onSave={(x) => void save("planned_date", { planned_date: x || null })}
              />
            </Field>
            <Field label="Time">
              <TextSave
                type="time"
                value={String(v("planned_time")).slice(0, 5)}
                busy={busy === "planned_time"}
                onSave={(x) => void save("planned_time", { planned_time: x || null })}
              />
            </Field>
            <Field label={pickup ? "Pieces collected" : "Pieces delivered"}>
              <TextSave
                type="number"
                value={String(v("pieces"))}
                placeholder={shipment.piece_count ? `${shipment.piece_count} booked` : ""}
                busy={busy === "pieces"}
                onSave={(x) => void save("pieces", { pieces: x === "" ? null : Math.max(0, Math.round(Number(x))) })}
              />
            </Field>

            <Field label="Contact at the door">
              <TextSave
                value={String(v("contact_name"))}
                busy={busy === "contact_name"}
                onSave={(x) => void save("contact_name", { contact_name: x || null })}
              />
            </Field>
            <Field label="Contact phone">
              <TextSave
                value={String(v("contact_phone"))}
                busy={busy === "contact_phone"}
                onSave={(x) => void save("contact_phone", { contact_phone: x || null })}
              />
            </Field>
            <Field label="Transporter">
              <select
                value={m?.transporter_partner_id ?? ""}
                disabled={busy !== null}
                onChange={(e) => {
                  const p = transporters.find((t) => t.id === e.target.value);
                  void save("transporter", {
                    transporter_partner_id: p?.id ?? null,
                    transporter: p ? p.organisation || p.name : null,
                  });
                }}
                className="h-9 w-full"
              >
                <option value="">{transporters.length ? "Choose from the partner book" : "No transporters in the partner book"}</option>
                {transporters.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.organisation || p.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Vehicle number">
              <TextSave
                value={String(v("vehicle_number"))}
                placeholder="TN 01 AB 1234"
                busy={busy === "vehicle"}
                onSave={(x) => void save("vehicle", { vehicle_number: x ? x.toUpperCase() : null })}
              />
            </Field>
            <Field label="Driver">
              <TextSave
                value={String(v("driver_name"))}
                busy={busy === "driver"}
                onSave={(x) => void save("driver", { driver_name: x || null })}
              />
            </Field>
            <Field label="Driver phone">
              <TextSave
                value={String(v("driver_phone"))}
                busy={busy === "driver_phone"}
                onSave={(x) => void save("driver_phone", { driver_phone: x || null })}
              />
            </Field>

            {!pickup && (
              <>
                <Field label="Received by">
                  <TextSave
                    value={String(v("received_by"))}
                    placeholder="Who signed for it"
                    busy={busy === "received_by"}
                    onSave={(x) => void save("received_by", { received_by: x || null })}
                  />
                </Field>
                <Field label="Proof of delivery" className="md:col-span-2" hint="Filed with the job's documents, protected.">
                  <div className="flex h-9 items-center gap-2">
                    {pod ? (
                      <button
                        type="button"
                        onClick={() =>
                          void fileUrl(pod.path)
                            .then((u) => window.open(u, "_blank", "noopener"))
                            .catch((e) => onError(failureText(e, "Could not open it.").message))
                        }
                        className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-text-accent hover:underline"
                      >
                        <ExternalLink size={12} className="shrink-0" />
                        <span className="truncate">{pod.name}</span>
                      </button>
                    ) : (
                      <span className="text-[12px] text-text-muted">None attached</span>
                    )}
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => podInput.current?.click()}
                      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
                    >
                      {busy === "pod" ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
                      {pod ? "Replace" : "Attach POD"}
                    </button>
                    <input
                      ref={podInput}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        void run("pod", async () => {
                          const f = await uploadFile({
                            enquiryRef: shipment.enquiry_ref,
                            file,
                            documentType: "Proof of delivery",
                            referenceNumber: shipment.id,
                            protected: true,
                          });
                          await saveMovement(shipment.id, "delivery", { pod_file_id: f.id });
                        });
                      }}
                    />
                  </div>
                </Field>
              </>
            )}

            <Field label="Instructions" className="sm:col-span-2 md:col-span-3">
              <TextSave
                value={String(v("notes"))}
                placeholder={pickup ? "Loading dock, timings, what to bring" : "Unloading, appointment, who to ask for"}
                busy={busy === "notes"}
                onSave={(x) => void save("notes", { notes: x || null })}
              />
            </Field>
          </div>
        </>
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
            subject: movementOrderSubject({ kind, ref: shipment.enquiry_ref, date: m?.planned_date ?? null }),
            body: movementOrderHtml({
              kind,
              ref: shipment.enquiry_ref,
              shipmentId: shipment.id,
              partyName: transporter ? transporter.organisation || transporter.name : null,
              address: address || null,
              date: m?.planned_date ?? null,
              time: m?.planned_time ?? null,
              contactName: m?.contact_name ?? null,
              contactPhone: m?.contact_phone ?? null,
              cargo: shipment.cargo,
              pieces: shipment.piece_count,
              grossKg: shipment.gross_weight_kg === null ? null : Number(shipment.gross_weight_kg),
              volumeCbm: shipment.volume_cbm === null ? null : Number(shipment.volume_cbm),
              hazardous: Boolean(enquiry?.hazardous),
              unNumber: shipment.un_number,
              notes: m?.notes ?? null,
            }),
          }}
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false);
            void logEvent(
              shipment.enquiry_ref,
              `${kind}_requested`,
              `${pickup ? "Pickup" : "Delivery"} request sent to ${transporterEmail}`,
              { to: transporterEmail, shipment_id: shipment.id }
            ).catch(() => {});
          }}
        />
      )}
    </Collapsible>
  );
}

/** "2026-10-01T10:30" in the browser's own time, for a datetime-local input. */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
