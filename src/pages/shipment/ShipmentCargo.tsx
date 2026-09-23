import { useState } from "react";
import { AlertCircle, Boxes } from "lucide-react";
import Collapsible from "../../components/Collapsible";
import CargoDetailsPanel from "../../components/CargoDetailsPanel";
import DimensionsPanel from "../../components/DimensionsPanel";
import { Field, TextSave, YesNo } from "../../components/formControls";
import { useShipment } from "../ShipmentDetail";
import { failureText } from "../../lib/errorText";
import { CONTAINER_TYPES } from "../../services/containers";
import { updateShipment, type Shipment } from "../../services/enquiries";

/**
 * What is being carried.
 *
 * ---------------------------------------------------------------------------
 * THE FIRST TWO ARE THE ENQUIRY'S
 *
 * Cargo details and the dimension table are the same panels the inbound page
 * uses, writing the same records. The sizes and weights the quotation was
 * priced on are the ones the booking carries, and when the warehouse finds a
 * different count it is corrected here once, for both (065 keeps the
 * shipment's totals in step).
 *
 * PACKING & COMMERCIAL IS THE SHIPMENT'S
 *
 * Marks, packages, HS code, net weight, invoice value and the commercial terms
 * are what the documents print. They were a pop-up form behind the documents
 * list; they are here now, in one place, and the documents tab links here when
 * a draft is missing one.
 * ---------------------------------------------------------------------------
 */
export default function ShipmentCargo() {
  const { shipment: s, enquiry, lines, reload } = useShipment();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  /** A number field: blank clears it, anything else must be a number. */
  const num = (key: keyof Shipment) => (v: string) => {
    if (v === "") return void save(key, { [key]: null } as Partial<Shipment>);
    const n = Number(v.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) return setError(`"${v}" is not a number.`);
    void save(key, { [key]: n } as Partial<Shipment>);
  };

  const mode = s.transport_mode ?? enquiry?.transport_mode ?? null;

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {enquiry ? (
        <>
          <CargoDetailsPanel enquiry={enquiry} onSaved={reload} />
          <DimensionsPanel enquiry={enquiry} lines={lines} onSaved={reload} />
        </>
      ) : (
        <p className="card p-4 text-[12px] text-text-muted">
          The enquiry this booking came from could not be read, so its cargo details and sizes are
          not shown.
        </p>
      )}

      <Collapsible
        id="shipment:packing"
        title="Packing & commercial"
        icon={<Boxes size={12} className="shrink-0 text-text-muted" />}
        hint="What the house bill, invoice and packing list print."
      >
        <div id="packing" className="grid gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-3">
          <Field label="Marks and numbers" className="md:col-span-2">
            <TextSave
              value={s.marks_and_numbers ?? ""}
              placeholder="As stencilled on the packages — often NIL"
              busy={busy === "marks"}
              onSave={(v) => void save("marks", { marks_and_numbers: v || null })}
            />
          </Field>
          <Field label="HS code">
            <TextSave
              value={s.hs_code ?? ""}
              placeholder="8507.60"
              busy={busy === "hs"}
              onSave={(v) => void save("hs", { hs_code: v || null })}
            />
          </Field>

          <Field
            label="Number of packages"
            hint="As the bill declares them — may differ from the pieces measured above."
          >
            <TextSave
              type="number"
              value={s.package_count == null ? "" : String(s.package_count)}
              busy={busy === "package_count"}
              onSave={num("package_count")}
            />
          </Field>
          <Field label="Package type">
            <TextSave
              value={s.package_type ?? ""}
              placeholder="Cartons, pallets, crates"
              busy={busy === "package_type"}
              onSave={(v) => void save("package_type", { package_type: v || null })}
            />
          </Field>
          <Field label="Net weight (kg)">
            <TextSave
              type="number"
              value={s.net_weight_kg == null ? "" : String(s.net_weight_kg)}
              busy={busy === "net_weight_kg"}
              onSave={num("net_weight_kg")}
            />
          </Field>

          <Field label="Invoice value (₹)">
            <TextSave
              type="number"
              value={s.invoice_value_inr == null ? "" : String(s.invoice_value_inr)}
              busy={busy === "invoice_value_inr"}
              onSave={num("invoice_value_inr")}
            />
          </Field>
          <Field label="Payment terms">
            <TextSave
              value={s.payment_terms ?? ""}
              placeholder="Advance, 30 days"
              busy={busy === "payment_terms"}
              onSave={(v) => void save("payment_terms", { payment_terms: v || null })}
            />
          </Field>
          <Field label="Letter of credit">
            <YesNo
              value={s.letter_of_credit}
              busy={busy === "loc"}
              onChange={(v) => void save("loc", { letter_of_credit: v })}
            />
          </Field>

          <Field label="Incoterm" hint="Set under Service details on the Shipment details tab.">
            <span
              className={`flex h-9 items-center rounded-lg bg-surface-2 px-3 text-[13px] ${
                s.incoterm ? "text-text-primary" : "text-text-muted"
              }`}
            >
              {s.incoterm ?? "Not given"}
            </span>
          </Field>

          {mode === "sea_fcl" && (
            <Field label="Container type">
              <select
                value={s.container_type ?? ""}
                disabled={busy !== null}
                onChange={(e) => void save("container_type", { container_type: e.target.value || null })}
                className="h-9 w-full"
              >
                <option value="">Not chosen</option>
                {CONTAINER_TYPES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </Collapsible>
    </div>
  );
}
