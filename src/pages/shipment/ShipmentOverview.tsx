import { useState } from "react";
import RevertShipment from "../../components/RevertShipment";
import { AlertCircle, Loader2 } from "lucide-react";
import { useShipment } from "../ShipmentDetail";
import {
  setShipmentStage,
  SHIPMENT_STAGES,
  SHIPMENT_STAGE_LABEL,
  type ShipmentStage,
} from "../../services/enquiries";

/**
 * Where the shipment is, what was booked, and what is on it.
 *
 * Lifted out of the page this now sits inside, unchanged except for reading the
 * shipment from the shell rather than fetching it again. A blank field is drawn
 * as a dash rather than hidden: on a booking, "we have no container number yet"
 * is something the desk needs to see, and a row that disappears when empty makes
 * an incomplete record look complete.
 */

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p
        className={`truncate text-[13px] ${mono ? "font-mono " : ""}${
          value ? "text-text-primary" : "text-text-muted"
        }`}
      >
        {value || "—"}
      </p>
    </div>
  );
}

export default function ShipmentOverview() {
  const { shipment: s, reload } = useShipment();
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageIndex = SHIPMENT_STAGES.indexOf(s.stage);
  const next = stageIndex >= 0 ? SHIPMENT_STAGES[stageIndex + 1] : undefined;

  async function move(stage: ShipmentStage) {
    setMoving(true);
    setError(null);
    try {
      await setShipmentStage(s.id, stage);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the stage.");
    } finally {
      setMoving(false);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- where it is ---- */}
      <section className="card mb-4 p-4">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Progress
        </h2>
        <ol className="mb-4 flex flex-wrap gap-1.5">
          {SHIPMENT_STAGES.map((stage, i) => {
            const done = stageIndex >= 0 && i < stageIndex;
            const here = stage === s.stage;
            return (
              <li
                key={stage}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  here
                    ? "bg-brand text-white"
                    : done
                      ? "bg-bg-success text-text-success"
                      : "bg-surface-2 text-text-muted"
                }`}
              >
                {SHIPMENT_STAGE_LABEL[stage]}
              </li>
            );
          })}
        </ol>

        {next ? (
          <button
            onClick={() => void move(next)}
            disabled={moving}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {moving && <Loader2 size={12} className="animate-spin" />}
            Move to {SHIPMENT_STAGE_LABEL[next].toLowerCase()}
          </button>
        ) : (
          <p className="text-[12px] text-text-secondary">
            Delivered. Nothing further to move this shipment to.
          </p>
        )}
      </section>

      {/* ---- the booking ---- */}
      <section className="card mb-4 p-4">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Booking
        </h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
          <Field label="Carrier" value={s.carrier} />
          <Field label="Booking number" value={s.booking_number} mono />
          <Field label="Container" value={s.container_number} mono />
          <Field label="Bill of lading" value={s.bl_number} mono />
          <Field label="Vessel" value={s.vessel} />
          <Field label="Sailing date" value={s.sailing_date} />
          <Field label="ETD" value={s.etd} />
          <Field label="ETA" value={s.eta} />
        </div>
      </section>

      {/* ---- the cargo ---- */}
      <section className="card p-4">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Cargo and value
        </h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
          <Field label="Cargo" value={s.cargo} />
          <Field label="Pieces" value={s.piece_count === null ? null : String(s.piece_count)} />
          <Field label="Volume" value={s.volume_cbm === null ? null : `${s.volume_cbm} CBM`} />
          <Field
            label="Gross weight"
            value={
              s.gross_weight_kg === null
                ? null
                : `${s.gross_weight_kg.toLocaleString("en-IN")} kg`
            }
          />
          <Field
            label="Agreed amount"
            value={s.agreed_inr === null ? null : `₹${s.agreed_inr.toLocaleString("en-IN")}`}
          />
          <Field label="Customer" value={s.customer?.name ?? null} />
          <Field label="Company" value={s.customer?.company ?? null} />
          <Field
            label="Booked"
            value={new Date(s.created_at).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
          Volume and gross weight are computed from the piece dimensions on the enquiry, not entered
          by hand. Correct them on the case file and they recompute here.
        </p>
      </section>

      {/*
        At the foot of the overview, not in the toolbar.

        It deletes the booking, so it should take a decision to reach rather
        than sit beside the things somebody presses all day. Promotion is one
        press and easy to do early; this is the way back when the ready date
        moves or the volume changes and there is no shipment to operate yet.
      */}
      <section className="card p-5">
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
