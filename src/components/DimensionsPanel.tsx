import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Plus, Ruler, Trash2 } from "lucide-react";
import Collapsible from "./Collapsible";
import { Segmented } from "./formControls";
import { failureText } from "../lib/errorText";
import { chargeableWeight, describeChargeable, type FreightMode } from "../lib/chargeableWeight";
import {
  KG_PER,
  UNIT_LABEL,
  fmt,
  kgPerCbm,
  lineGross,
  lineVolumeWeight,
  type DimensionLine,
  type DimensionUnit,
} from "../lib/dimensions";
import { updateEnquiry, type Enquiry } from "../services/enquiries";
import {
  addDimension,
  removeDimension,
  updateDimension,
  type DimensionPatch,
} from "../services/enquiryDimensions";

/**
 * How big it is, line by line, and what that makes it cost to carry.
 *
 * ---------------------------------------------------------------------------
 * ONE LINE PER SIZE
 *
 * "10 cases of 100 × 120 × 130 and 4 of 60 × 40 × 50" is two lines, not an
 * average. The totals row and the chargeable weight are read back from the
 * enquiry after every save — the database sums the lines (063) — so what this
 * table shows is exactly what the quotation and the booking will use.
 *
 * WHEN THE CUSTOMER ONLY GAVE TOTALS
 *
 * "2.4 CBM, 850 kg, 6 pallets" is common and perfectly quotable. Where no line
 * gives a weight (or a size), the total in that column is typed directly, and
 * a line added later that does give it takes over.
 * ---------------------------------------------------------------------------
 */

const UNITS: Array<{ value: DimensionUnit; label: string }> = [
  { value: "cm_kg", label: "Centimetre / Kilos" },
  { value: "in_lb", label: "Inch / Pounds" },
];

const CHARGED: FreightMode[] = ["air", "sea_lcl", "road"];

export default function DimensionsPanel({
  enquiry,
  lines,
  onSaved,
}: {
  enquiry: Enquiry;
  lines: DimensionLine[];
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unit: DimensionUnit = enquiry.dimension_unit ?? "cm_kg";
  const u = UNIT_LABEL[unit];
  const mode = enquiry.transport_mode;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  /*
    The blank first row has no line behind it until something is typed. The
    first figure creates the line; a second cell left before the reload lands
    must write to that same line, not create another — so the creation is
    shared. Its id is remembered so the row keeps its key when the real line
    arrives, and a cell being typed in is not remounted out from under the
    cursor.
  */
  const creating = useRef<Promise<DimensionLine> | null>(null);
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (lines.length === 0) {
      creating.current = null;
      adopted.current = null;
    }
  }, [lines.length]);

  const saveCell = (line: DimensionLine | null, patch: DimensionPatch) =>
    run(line?.id ?? "new", async () => {
      let target = line;
      if (!target) {
        creating.current ??= addDimension(enquiry.ref, 1).then((l) => {
          adopted.current = l.id;
          return l;
        });
        target = await creating.current;
      }
      await updateDimension(target.id, patch);
    });

  const nextPosition = lines.reduce((m, l) => Math.max(m, l.position), 0) + 1;

  // Which totals the lines give. Where they give none, the total is typed.
  const linesGiveWeight = lines.some((l) => l.gross_weight !== null || l.weight_per_piece !== null);
  const linesGiveSize = lines.some((l) => l.length !== null || l.width !== null || l.height !== null);

  const grossInUnit = enquiry.gross_weight_kg == null ? null : enquiry.gross_weight_kg / KG_PER[unit];
  const ratio = kgPerCbm(mode);
  const volumeWeightInUnit =
    enquiry.volume_cbm == null || ratio === null ? null : (enquiry.volume_cbm * ratio) / KG_PER[unit];

  const charge =
    mode && CHARGED.includes(mode as FreightMode)
      ? chargeableWeight(enquiry.gross_weight_kg, enquiry.volume_cbm, mode as FreightMode)
      : null;

  const rows: Array<DimensionLine | null> = lines.length ? lines : [null];

  return (
    <Collapsible
      id="case:dimensions"
      title="Dimension details"
      icon={<Ruler size={12} className="shrink-0 text-text-muted" />}
      badge={
        [
          enquiry.piece_count != null ? `${enquiry.piece_count} pcs` : null,
          enquiry.volume_cbm != null ? `${fmt(enquiry.volume_cbm, 3)} CBM` : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      }
      action={
        <div className="text-right" title={charge ? describeChargeable(charge) : undefined}>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Chargeable weight</p>
          <p
            className={`text-[15px] font-semibold tabular-nums ${
              charge ? "text-text-primary" : "text-text-muted"
            }`}
          >
            {charge
              ? `${fmt(charge.value)} ${charge.unit}`
              : mode === "sea_fcl"
                ? "Per container"
                : "—"}
          </p>
        </div>
      }
    >
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="max-w-sm">
        <Segmented
          options={UNITS}
          value={unit}
          busy={busy === "unit"}
          onChange={(v) => void run("unit", () => updateEnquiry(enquiry.ref, { dimension_unit: v }))}
        />
      </div>

      {/* Scrolls sideways on a phone rather than squeezing eight numbers into
          columns too narrow to read. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] font-medium text-text-secondary">
              <th className="w-8 pb-2 font-medium">#</th>
              <th className="pb-2 pr-2 font-medium">No. of pieces</th>
              <th className="pb-2 pr-2 font-medium">Length ({u.length})</th>
              <th className="pb-2 pr-2 font-medium">Width ({u.length})</th>
              <th className="pb-2 pr-2 font-medium">Height ({u.length})</th>
              <th className="pb-2 pr-2 font-medium">Volume weight ({u.weight})</th>
              <th className="pb-2 pr-2 font-medium">Gross wt / piece ({u.weight})</th>
              <th className="pb-2 pr-2 font-medium">Gross weight ({u.weight})</th>
              <th className="w-8 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((line, i) => {
              const computedGross = line ? lineGross({ ...line, gross_weight: null }) : null;
              const vw = line ? lineVolumeWeight(line, unit, mode) : null;
              return (
                <tr
                  key={!line || line.id === adopted.current ? "first" : line.id}
                  className="align-middle"
                >
                  <td className="py-1 pr-2 text-[11px] tabular-nums text-text-muted">{i + 1}</td>
                  <NumCell line={line} field="pieces" integer onSave={saveCell} />
                  <NumCell line={line} field="length" onSave={saveCell} />
                  <NumCell line={line} field="width" onSave={saveCell} />
                  <NumCell line={line} field="height" onSave={saveCell} />
                  <td className="py-1 pr-2">
                    <span className="flex h-8 items-center justify-end rounded-lg bg-surface-2 px-2.5 tabular-nums text-text-secondary">
                      {vw === null ? "—" : fmt(vw)}
                    </span>
                  </td>
                  <NumCell line={line} field="weight_per_piece" onSave={saveCell} />
                  <NumCell
                    line={line}
                    field="gross_weight"
                    placeholder={computedGross === null ? "" : fmt(computedGross)}
                    onSave={saveCell}
                  />
                  <td className="py-1 text-right">
                    {line && (
                      <button
                        type="button"
                        onClick={() => void run(`rm:${line.id}`, () => removeDimension(line.id))}
                        disabled={busy !== null}
                        className="rounded p-1 text-text-muted hover:text-text-danger disabled:opacity-60"
                        aria-label={`Remove line ${i + 1}`}
                      >
                        {busy === `rm:${line.id}` ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border text-[12.5px] font-medium">
              <td className="pt-2 text-[11px] text-text-muted">Total</td>
              <td className="pt-2 pr-2 tabular-nums">
                <Total value={enquiry.piece_count == null ? null : fmt(enquiry.piece_count, 0)} />
              </td>
              <td colSpan={3} className="pt-2 pr-2">
                {linesGiveSize ? (
                  <Total
                    value={enquiry.volume_cbm == null ? null : `${fmt(enquiry.volume_cbm, 3)} CBM`}
                    blankTitle="Every line needs pieces and all three measurements to total the volume"
                  />
                ) : (
                  <StatedTotal
                    value={enquiry.volume_cbm}
                    suffix="CBM"
                    label="Total volume (CBM)"
                    onSave={(v) => void run("vol", () => updateEnquiry(enquiry.ref, { volume_cbm: v }))}
                  />
                )}
              </td>
              <td className="pt-2 pr-2">
                <Total value={volumeWeightInUnit == null ? null : fmt(volumeWeightInUnit)} />
              </td>
              <td className="pt-2 pr-2" />
              <td className="pt-2 pr-2">
                {linesGiveWeight ? (
                  <Total
                    value={grossInUnit == null ? null : fmt(grossInUnit)}
                    blankTitle="Every line needs a weight to total the gross weight"
                  />
                ) : (
                  <StatedTotal
                    value={grossInUnit}
                    suffix={u.weight}
                    label={`Total gross weight (${u.weight})`}
                    onSave={(v) =>
                      void run("gross", () =>
                        updateEnquiry(enquiry.ref, {
                          gross_weight_kg: v === null ? null : Math.round(v * KG_PER[unit] * 100) / 100,
                        })
                      )
                    }
                  />
                )}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void run("add", () => addDimension(enquiry.ref, nextPosition))}
          disabled={busy !== null || lines.length === 0}
          title={lines.length === 0 ? "Fill in the first line, then add another size" : undefined}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
        >
          {busy === "add" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          Add dimension
        </button>
        <p className="text-[11px] text-text-muted">
          {!mode
            ? "Choose the service above to work out the chargeable weight."
            : mode === "sea_fcl"
              ? "FCL is charged per container, not on weight or volume."
              : mode === "other"
                ? "No standard ratio for this service — quote on the actual weight and volume."
                : describeChargeable(charge)}
        </p>
      </div>
    </Collapsible>
  );
}

/** One number on one line, saved when you leave it. */
function NumCell({
  line,
  field,
  integer,
  placeholder,
  onSave,
}: {
  line: DimensionLine | null;
  field: keyof DimensionPatch;
  integer?: boolean;
  placeholder?: string;
  onSave: (line: DimensionLine | null, patch: DimensionPatch) => void;
}) {
  const stored = line?.[field] ?? null;
  const [draft, setDraft] = useState(stored === null ? "" : String(stored));
  useEffect(() => setDraft(stored === null ? "" : String(stored)), [stored]);

  function commit() {
    const t = draft.trim();
    const v = t === "" ? null : integer ? Math.round(Number(t)) : Number(t);
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      setDraft(stored === null ? "" : String(stored));
      return;
    }
    if (v === stored) return;
    // Nothing typed on a line that does not exist yet: nothing to create.
    if (!line && v === null) return;
    onSave(line, { [field]: v } as DimensionPatch);
  }

  return (
    <td className="py-1 pr-2">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={integer ? 1 : "any"}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-8 w-full text-right tabular-nums"
      />
    </td>
  );
}

function Total({ value, blankTitle }: { value: string | null; blankTitle?: string }) {
  return (
    <span
      className="flex h-8 items-center justify-end px-2.5 tabular-nums text-text-primary"
      title={value === null ? blankTitle : undefined}
    >
      {value ?? <span className="text-text-muted">—</span>}
    </span>
  );
}

/** A total the customer stated, typed directly because no line gives it. */
function StatedTotal({
  value,
  suffix,
  label,
  onSave,
}: {
  value: number | null;
  suffix: string;
  label: string;
  onSave: (v: number | null) => void;
}) {
  const shown = value == null ? "" : String(Math.round(value * 1000) / 1000);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={draft}
        aria-label={label}
        title="Stated total — no line gives this, so it is typed here"
        placeholder="Stated total"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const t = draft.trim();
          const v = t === "" ? null : Number(t);
          if (v !== null && (!Number.isFinite(v) || v < 0)) return setDraft(shown);
          if (t !== shown) onSave(v);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-8 w-full pr-10 text-right tabular-nums"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">
        {suffix}
      </span>
    </div>
  );
}
