import { useState } from "react";
import { AlertCircle, Package } from "lucide-react";
import Collapsible from "./Collapsible";
import { Field, Segmented, TextSave, YesNo } from "./formControls";
import { failureText } from "../lib/errorText";
import { updateEnquiry, type Enquiry } from "../services/enquiries";

/**
 * What is being carried — everything except its size, which is the dimension
 * table below.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DANGEROUS-GOODS FIELDS ARE HIDDEN UNTIL "HAZARDOUS: YES"
 *
 * Most consignments are not hazardous, and five empty fields about UN numbers
 * on every ordinary job is how a form gets skimmed — including on the one job
 * where they matter. So the question is asked once, and the detail follows
 * only a yes. A UN number arriving in the mail answers it without anybody
 * clicking (063 marks the cargo hazardous when one is recorded).
 * ---------------------------------------------------------------------------
 */

/** The DG fields, for the automatic fill: shown here, and nowhere else. */
export const DG_KEYS = ["un_number", "imo_class", "packing_group", "flash_point_c", "msds_provided"];

const IMO_CLASSES = ["1", "2.1", "2.2", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "5.2", "6.1", "6.2", "7", "8", "9"];

export default function CargoDetailsPanel({
  enquiry,
  onSaved,
}: {
  enquiry: Enquiry;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(key: string, patch: Partial<Enquiry>) {
    setBusy(key);
    setError(null);
    try {
      await updateEnquiry(enquiry.ref, patch);
      onSaved();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  const hazardous = enquiry.hazardous === true;

  return (
    <Collapsible
      id="case:cargo"
      title="Cargo details"
      icon={<Package size={12} className="shrink-0 text-text-muted" />}
      badge={hazardous ? "Hazardous" : (enquiry.cargo ?? undefined)}
    >
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-3">
        <Field label="Hazardous">
          <YesNo
            value={enquiry.hazardous}
            busy={busy === "hazardous"}
            onChange={(v) => void save("hazardous", { hazardous: v })}
          />
        </Field>

        <Field label="Stackable">
          <YesNo
            value={enquiry.stackable}
            busy={busy === "stackable"}
            onChange={(v) => void save("stackable", { stackable: v })}
          />
        </Field>

        <Field label="Cargo ready date">
          <TextSave
            type="date"
            value={(enquiry.ready_date ?? "").slice(0, 10)}
            busy={busy === "ready"}
            onSave={(v) => void save("ready", { ready_date: v || null })}
          />
        </Field>

        <Field label="Expected delivery date">
          <TextSave
            type="date"
            value={(enquiry.expected_delivery_date ?? "").slice(0, 10)}
            busy={busy === "delivery"}
            onSave={(v) => void save("delivery", { expected_delivery_date: v || null })}
          />
        </Field>

        <Field label="Commodity description" className="sm:col-span-1 md:col-span-2">
          <TextSave
            value={enquiry.cargo ?? ""}
            placeholder="Cotton fabric in rolls"
            busy={busy === "cargo"}
            onSave={(v) => void save("cargo", { cargo: v || null })}
          />
        </Field>
      </div>

      {hazardous && (
        <div className="mt-5 rounded-lg border border-border bg-surface-2 p-4">
          <p className="mb-3 text-[11.5px] font-medium text-text-secondary">
            Dangerous goods{" "}
            <span className="font-normal text-text-muted">
              — a wrong class is a refused booking
            </span>
          </p>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-5">
            <Field label="UN number">
              <TextSave
                value={enquiry.un_number ?? ""}
                placeholder="UN1263"
                busy={busy === "un"}
                onSave={(v) => void save("un", { un_number: v ? v.toUpperCase() : null })}
              />
            </Field>
            <Field label="IMO class">
              <select
                value={enquiry.imo_class ?? ""}
                disabled={busy !== null}
                onChange={(e) => void save("imo", { imo_class: e.target.value || null })}
                className="h-9 w-full"
              >
                <option value="">—</option>
                {IMO_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    Class {c}
                  </option>
                ))}
                {enquiry.imo_class && !IMO_CLASSES.includes(enquiry.imo_class) && (
                  <option value={enquiry.imo_class}>{enquiry.imo_class}</option>
                )}
              </select>
            </Field>
            <Field label="Packing group">
              <Segmented
                options={[
                  { value: "I", label: "I" },
                  { value: "II", label: "II" },
                  { value: "III", label: "III" },
                ]}
                value={enquiry.packing_group}
                busy={busy === "pg"}
                onChange={(v) => void save("pg", { packing_group: v })}
              />
            </Field>
            <Field label="Flash point (°C)">
              <TextSave
                type="number"
                value={enquiry.flash_point_c == null ? "" : String(enquiry.flash_point_c)}
                placeholder="—"
                busy={busy === "flash"}
                onSave={(v) => void save("flash", { flash_point_c: v === "" ? null : Number(v) })}
              />
            </Field>
            <Field label="MSDS received">
              <YesNo
                value={enquiry.msds_provided}
                busy={busy === "msds"}
                onChange={(v) => void save("msds", { msds_provided: v })}
              />
            </Field>
          </div>
        </div>
      )}
    </Collapsible>
  );
}
