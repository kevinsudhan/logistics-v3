import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Box, Check, Plus, Trash2 } from "lucide-react";
import EmptyState from "../../components/EmptyState";
import Select from "../../components/Select";
import { useShipment } from "../ShipmentDetail";
import {
  PACKAGE_TYPES,
  SEAL_TYPES,
  SIZE_TYPES,
  addShipmentContainer,
  checkContainerNo,
  isoFor,
  listShipmentContainers,
  removeShipmentContainer,
  updateShipmentContainer,
  type ShipmentContainer,
} from "../../services/shipmentContainers";
import { SectionSkeleton } from "../../components/Loading";

/**
 * The boxes this shipment is travelling in.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE NOT TEN EMPTY ROWS
 *
 * The screen this is modelled on opens with ten blank numbered rows and a
 * scrollbar, which tells you nothing about how many containers the job has and
 * makes the common case — one box — look like nine things left undone. Rows
 * appear here when somebody adds one.
 *
 * WHAT IS FILLED IN RATHER THAN ASKED FOR
 *
 * The ISO code. It is a pure function of the size and type: a forty-foot high
 * cube is 45G1 on every container in the world. Their form has it as a required
 * text box, which is how the same kind of box arrives as 2210 on one row and
 * 22G1 on the next.
 *
 * THE CHECK DIGIT WARNS, IT DOES NOT REFUSE
 *
 * A container number carries its own checksum, so a typo is detectable. It is
 * shown as a warning and saved anyway: a number that arrived from the carrier
 * mistyped is still the number on the paperwork the consignee is holding, and a
 * form that will not accept it leaves the desk with nowhere to put the truth.
 * ---------------------------------------------------------------------------
 */

function Cell({
  value,
  onCommit,
  width,
  mono,
  align,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  width?: string;
  mono?: boolean;
  align?: "right";
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      className={`h-8 rounded-lg border border-border bg-surface-1 px-2 text-[13px] text-text-primary transition-colors placeholder:text-text-muted hover:border-border-strong focus:border-border-strong focus:outline-none ${
        width ?? "w-full"
      } ${align === "right" ? "text-right tabular-nums" : ""} ${mono ? "font-mono" : ""}`}
    />
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[11px] text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

function Flag({
  on,
  onToggle,
  label,
  hint,
}: {
  on: boolean;
  onToggle: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      title={hint}
      aria-pressed={on}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${
        on
          ? "border-text-accent/25 bg-bg-accent text-text-accent"
          : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
      }`}
    >
      {on && <Check size={11} />}
      {label}
    </button>
  );
}

export default function ShipmentContainers() {
  const { shipment, reload } = useShipment();
  const [rows, setRows] = useState<ShipmentContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listShipmentContainers(shipment.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the containers.");
    } finally {
      setLoading(false);
    }
  }, [shipment.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      // The gross weight on the booking and the stowage planner both read the
      // shipment, and the mirrored container number moves with these rows.
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
  };

  const edit = (id: string, patch: Partial<ShipmentContainer>) =>
    void run(() => updateShipmentContainer(id, patch));

  const totals = rows.reduce(
    (t, r) => ({
      packages: t.packages + (r.package_count ?? 0),
      weight: t.weight + (r.weight_kg ?? 0),
      volume: t.volume + (r.volume_cbm ?? 0),
    }),
    { packages: 0, weight: 0, volume: 0 }
  );

  if (loading) return <SectionSkeleton />;

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-text-secondary">
          {rows.length === 0
            ? "No containers recorded on this booking."
            : `${rows.length} container${rows.length === 1 ? "" : "s"} on this booking.`}
        </p>
        <button
          onClick={() =>
            void run(() =>
              addShipmentContainer(shipment.id, {
                position: rows.length + 1,
                sailing_id: shipment.sailing_id ?? null,
                size_type: shipment.container_type ?? "",
                iso_code: isoFor(shipment.container_type ?? ""),
                package_type: shipment.package_type ?? "",
              })
            )
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark"
        >
          <Plus size={14} />
          Add a container
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Box}
          title="No containers yet"
          hint="Add one per physical box. The ISO code fills itself in from the size, and the number is checked against its own check digit as you type it."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((c, i) => {
            const check = c.container_no ? checkContainerNo(c.container_no) : "ok";

            return (
              <section key={c.id} className="card p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-[11px] font-medium text-text-secondary">
                    {i + 1}
                  </span>
                  <Flag
                    on={c.is_soc}
                    onToggle={(v) => edit(c.id, { is_soc: v })}
                    label="Shipper-owned"
                    hint="The box is the shipper's, not the carrier's — which decides who wears detention."
                  />
                  <Flag
                    on={c.is_coload}
                    onToggle={(v) => edit(c.id, { is_coload: v })}
                    label="Co-load"
                    hint="Our cargo riding in another forwarder's box, or theirs in ours."
                  />
                  <Flag
                    on={c.is_empty}
                    onToggle={(v) => edit(c.id, { is_empty: v })}
                    label="Empty"
                    hint="Moving empty, for repositioning."
                  />

                  <button
                    onClick={() => void run(() => removeShipmentContainer(c.id))}
                    aria-label={`Remove container ${c.container_no || i + 1}`}
                    className="ml-auto grid size-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-bg-danger hover:text-text-danger"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Labelled label="Container number">
                    <Cell
                      value={c.container_no}
                      mono
                      placeholder="MSCU1234567"
                      onCommit={(v) => edit(c.id, { container_no: v.toUpperCase() })}
                    />
                    {c.container_no && check !== "ok" && (
                      <span className="mt-0.5 block text-[11px] text-text-warning">
                        {check === "malformed"
                          ? "Not four letters and seven digits — saved as entered."
                          : "The check digit does not match — saved as entered."}
                      </span>
                    )}
                  </Labelled>

                  <Labelled label="Size and type">
                    <Select
                      label="Size and type"
                      value={c.size_type}
                      options={[
                        { value: "", label: "Not stated" },
                        ...SIZE_TYPES.map((s) => ({
                          value: s.value,
                          label: s.value,
                          hint: s.label,
                        })),
                      ]}
                      onChange={(v) =>
                        // The ISO code follows the size, so it is written with
                        // it rather than left to be typed separately and drift.
                        edit(c.id, { size_type: v, iso_code: isoFor(v) })
                      }
                    />
                  </Labelled>

                  <Labelled label="ISO code">
                    <Cell
                      value={c.iso_code}
                      mono
                      placeholder="from the size"
                      onCommit={(v) => edit(c.id, { iso_code: v.toUpperCase() })}
                    />
                  </Labelled>

                  <Labelled label="Seal number">
                    <Cell
                      value={c.seal_no}
                      mono
                      onCommit={(v) => edit(c.id, { seal_no: v.toUpperCase() })}
                    />
                  </Labelled>

                  <Labelled label="Seal type">
                    <Select
                      label="Seal type"
                      value={c.seal_type}
                      options={[
                        { value: "", label: "Not stated" },
                        ...SEAL_TYPES.map((s) => ({ value: s, label: s })),
                      ]}
                      onChange={(v) => edit(c.id, { seal_type: v })}
                    />
                  </Labelled>

                  <Labelled label="Packages">
                    <Cell
                      value={c.package_count === null ? "" : String(c.package_count)}
                      align="right"
                      onCommit={(v) =>
                        edit(c.id, { package_count: v.trim() === "" ? null : Number(v) || 0 })
                      }
                    />
                  </Labelled>

                  <Labelled label="Package type">
                    <Select
                      label="Package type"
                      value={c.package_type}
                      options={[
                        { value: "", label: "Not stated" },
                        ...PACKAGE_TYPES.map((p) => ({ value: p, label: p })),
                      ]}
                      onChange={(v) => edit(c.id, { package_type: v })}
                    />
                  </Labelled>

                  <Labelled label="Weight in this box (kg)">
                    <Cell
                      value={c.weight_kg === null ? "" : String(c.weight_kg)}
                      align="right"
                      onCommit={(v) =>
                        edit(c.id, { weight_kg: v.trim() === "" ? null : Number(v) || 0 })
                      }
                    />
                  </Labelled>

                  <Labelled label="Volume (CBM)">
                    <Cell
                      value={c.volume_cbm === null ? "" : String(c.volume_cbm)}
                      align="right"
                      onCommit={(v) =>
                        edit(c.id, { volume_cbm: v.trim() === "" ? null : Number(v) || 0 })
                      }
                    />
                  </Labelled>

                  <Labelled label="CFS">
                    <Cell value={c.cfs} onCommit={(v) => edit(c.id, { cfs: v })} />
                  </Labelled>

                  <Labelled label="Godown">
                    <Cell value={c.godown_no} onCommit={(v) => edit(c.id, { godown_no: v })} />
                  </Labelled>

                  <Labelled label="Marks and numbers">
                    <Cell
                      value={c.marks_numbers}
                      onCommit={(v) => edit(c.id, { marks_numbers: v })}
                    />
                  </Labelled>
                </div>
              </section>
            );
          })}

          {/* ---- what the B/L totals line carries ---- */}
          <div className="card flex flex-wrap gap-x-8 gap-y-2 p-4">
            <div>
              <p className="text-[11px] text-text-secondary">Containers</p>
              <p className="text-[15px] font-medium tabular-nums text-text-primary">
                {rows.length}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-text-secondary">Packages</p>
              <p className="text-[15px] font-medium tabular-nums text-text-primary">
                {totals.packages.toLocaleString("en-IN")}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-text-secondary">Weight</p>
              <p className="text-[15px] font-medium tabular-nums text-text-primary">
                {totals.weight.toLocaleString("en-IN")} kg
              </p>
            </div>
            <div>
              <p className="text-[11px] text-text-secondary">Volume</p>
              <p className="text-[15px] font-medium tabular-nums text-text-primary">
                {totals.volume.toLocaleString("en-IN")} CBM
              </p>
            </div>
            <p className="w-full text-[11px] leading-relaxed text-text-muted">
              Summed across the boxes above — this is the totals line a bill of lading carries.
              The booking's own gross weight comes from the enquiry's measurements and is not
              changed by what is entered here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
