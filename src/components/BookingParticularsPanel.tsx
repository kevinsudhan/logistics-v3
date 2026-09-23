import { useState } from "react";
import { AlertCircle, FileText } from "lucide-react";
import Collapsible from "./Collapsible";
import { Field, Segmented, TextSave } from "./formControls";
import { failureText } from "../lib/errorText";
import { byKey } from "../data/requestFields";
import { updateEnquiry, type Enquiry } from "../services/enquiries";

/**
 * What is needed to ISSUE, not to quote: the consolidation, the parties
 * printed on the bill of lading, and how the cargo is marked and packed.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS FOLDED AND AT THE BOTTOM
 *
 * Nothing here changes the price. An agent quotes on the lane, the cargo and
 * its size; they need the consignee's address and the marks to issue the
 * paperwork afterwards. Putting these above the quote made every enquiry look
 * like a form with twenty blanks before it could be priced, which is the page
 * this desk asked to be simpler.
 *
 * WHAT IS NOT HERE ANY MORE, AND WHERE IT WENT
 *
 *   chargeable weight   top right of Dimension details, beside the sizes
 *                       it is worked out from
 *   dangerous goods     inside Cargo details, shown when Hazardous is Yes
 *   package count       the pieces in Dimension details — the same number
 *   read the mail       the strip at the top of the page, which fills every
 *                       section, not just this one
 * ---------------------------------------------------------------------------
 */

const GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: "Consolidation", keys: ["cfs_location", "cargo_cutoff", "si_cutoff", "freight_terms"] },
  {
    title: "Consignee and notify party",
    keys: ["consignee_name", "consignee_country", "consignee_address", "notify_name", "notify_address"],
  },
  { title: "Marks and packing", keys: ["marks_and_numbers", "hs_code", "package_type", "net_weight_kg"] },
];

/** Every field this panel shows — what the automatic fill may write here. */
export const PARTICULAR_KEYS = GROUPS.flatMap((g) => g.keys);

export default function BookingParticularsPanel({
  enquiry,
  onSaved,
}: {
  enquiry: Enquiry;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const record = enquiry as unknown as Record<string, unknown>;

  async function save(key: string, value: unknown) {
    setBusy(key);
    setError(null);
    try {
      await updateEnquiry(enquiry.ref, { [key]: value } as Partial<Enquiry>);
      onSaved();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  const filled = PARTICULAR_KEYS.filter((k) => !isBlank(record[k])).length;

  return (
    <Collapsible
      id="case:particulars"
      title="Booking particulars"
      icon={<FileText size={12} className="shrink-0 text-text-muted" />}
      hint="Needed to issue the paperwork, not to quote."
      badge={`${filled} of ${PARTICULAR_KEYS.length}`}
      defaultOpen={false}
    >
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-5">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
              {g.title}
            </p>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-3">
              {g.keys.map((key) => {
                const def = byKey(key);
                if (!def) return null;
                const v = record[key];
                const label = def.unit ? `${def.label} (${def.unit})` : def.label;

                if (key === "freight_terms") {
                  return (
                    <Field key={key} label={label}>
                      <Segmented
                        options={[
                          { value: "prepaid", label: "Prepaid" },
                          { value: "collect", label: "Collect" },
                        ]}
                        value={v as string | null}
                        busy={busy === key}
                        onChange={(x) => void save(key, x)}
                      />
                    </Field>
                  );
                }

                const wide = key.endsWith("_address") || key === "marks_and_numbers";
                return (
                  <Field key={key} label={label} className={wide ? "md:col-span-2" : ""}>
                    <TextSave
                      type={def.kind === "date" ? "date" : def.kind === "number" ? "number" : "text"}
                      value={
                        v === null || v === undefined
                          ? ""
                          : def.kind === "date"
                            ? String(v).slice(0, 10)
                            : String(v)
                      }
                      busy={busy === key}
                      onSave={(x) =>
                        void save(key, x === "" ? null : def.kind === "number" ? Number(x) : x)
                      }
                    />
                  </Field>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Collapsible>
  );
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}
