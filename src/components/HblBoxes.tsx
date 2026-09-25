import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  defaultCharges,
  emptyCharge,
  emptyContainer,
  INSURANCE_LABEL,
  totalInWords,
  type HblCharge,
  type HblContainer,
  type HblData,
  type Insurance,
} from "../lib/hbl";

/**
 * The boxes of a sea house B/L, as a form (085, 088).
 *
 * Shared by the two ways a job has one: our own, which we issue (HblForm),
 * and the origin agent's, which we receive (ReceivedHbl). The boxes are the
 * same because the document is; what differs is around them — who numbers it,
 * who signs it, what happens next — and `variant` changes only the wording
 * and the boxes that belong to the issuer.
 */

export const inputBase =
  "rounded-lg border border-border bg-surface-1 px-2 py-1 text-[12.5px] text-text-primary hover:border-border-strong focus:border-border-strong focus:outline-none disabled:bg-surface-2 disabled:text-text-secondary";

type Setter = <K extends keyof HblData>(k: K, v: HblData[K]) => void;

export default function HblBoxes({
  d,
  set,
  ro,
  variant,
  express = false,
}: {
  d: HblData;
  set: Setter;
  ro: boolean;
  /** ours: we issue it · theirs: the origin agent issued it and we received it. */
  variant: "ours" | "theirs";
  /** A sea waybill: made out to a named consignee. */
  express?: boolean;
}) {
  const base = inputBase;
  const T = (k: keyof HblData, placeholder = "") => (
    <input value={d[k] as string} disabled={ro} placeholder={placeholder} onChange={(e) => set(k, e.target.value.toUpperCase() as never)} className={`${base} h-8 w-full`} />
  );
  const A = (k: keyof HblData, rows = 3, placeholder = "") => (
    <textarea
      value={d[k] as string}
      disabled={ro}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => set(k, e.target.value.toUpperCase() as never)}
      className={`${base} w-full resize-y leading-snug`}
    />
  );
  const D = (k: "date_of_issue" | "on_board_date") => (
    <input type="date" value={d[k]} disabled={ro} onChange={(e) => set(k, e.target.value)} className={`${base} h-8 w-full tabular-nums`} />
  );
  const setBox = (n: number, patch: Partial<HblContainer>) => set("containers", d.containers.map((c, i) => (i === n ? { ...c, ...patch } : c)));
  const setCharge = (n: number, patch: Partial<HblCharge>) => set("charges", d.charges.map((c, i) => (i === n ? { ...c, ...patch } : c)));

  // Turning prepaid into collect moves "AS ARRANGED" across with it, when the
  // table is still the usual single line; a table somebody wrote is left alone.
  const setTerms = (terms: "prepaid" | "collect") => {
    const was = JSON.stringify(defaultCharges(d.freight_terms));
    set("freight_terms", terms);
    if (JSON.stringify(d.charges) === was) set("charges", defaultCharges(terms));
  };

  return (
    <>
      {/* ---- parties ---- */}
      <Section title="Parties">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Labelled label="Shipper / exporter">{T("shipper_name")}</Labelled>
            {A("shipper_address", 3)}
          </div>
          <div className="space-y-2">
            <Labelled label="Consignee">
              <div className="mb-1 flex gap-1" role="group" aria-label="Consignee">
                {(
                  [
                    { v: "named", label: "Named" },
                    { v: "to_order", label: "To order" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    disabled={ro || (o.v === "to_order" && express)}
                    title={o.v === "to_order" && express ? "A sea waybill is made out to a named consignee" : undefined}
                    onClick={() => set("consignee_mode", o.v)}
                    aria-pressed={d.consignee_mode === o.v}
                    className={`h-7 rounded-lg border px-2.5 text-[12px] transition-colors disabled:opacity-50 ${
                      d.consignee_mode === o.v ? "border-brand bg-brand font-medium text-white" : "border-border bg-surface-1 text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {T("consignee_name", d.consignee_mode === "to_order" ? "TO ORDER OF — the bank or shipper, or leave blank" : "")}
            </Labelled>
            {A("consignee_address", 3)}
            <div className="grid gap-2 sm:grid-cols-3">
              <Labelled label="IEC">{T("consignee_iec")}</Labelled>
              <Labelled label="GSTIN">{T("consignee_gstin")}</Labelled>
              <Labelled label="Contact">{T("consignee_contact", "Person, phone")}</Labelled>
            </div>
          </div>
          <div className="space-y-2">
            <Labelled label="Notify party">{T("notify_name")}</Labelled>
            {A("notify_address", 2)}
            <div className="grid gap-2 sm:grid-cols-2">
              <Labelled label="IEC">{T("notify_iec")}</Labelled>
              <Labelled label="GSTIN">{T("notify_gstin")}</Labelled>
            </div>
          </div>
          <Labelled label="Also notify">{A("also_notify", 3)}</Labelled>
          <div className="md:col-span-2">
            <Labelled label={variant === "ours" ? "For delivery of goods please apply to (our agent at destination)" : "For delivery of goods please apply to"}>
              {A("delivery_agent", 3)}
            </Labelled>
          </div>
        </div>
      </Section>

      {/* ---- routing ---- */}
      <Section title="Routing">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Labelled label="Pre-carriage by">{T("pre_carriage_by")}</Labelled>
          <Labelled label="Place of receipt">{T("place_of_receipt")}</Labelled>
          <Labelled label="Ocean vessel">{T("vessel")}</Labelled>
          <Labelled label="Voyage">{T("voyage")}</Labelled>
          <Labelled label="Port of loading">{T("port_of_loading")}</Labelled>
          <Labelled label="Port of discharge">{T("port_of_discharge")}</Labelled>
          <Labelled label="Place of delivery">{T("place_of_delivery")}</Labelled>
          <Labelled label="Final destination">{T("final_destination")}</Labelled>
          <Labelled label="Service">
            <input list="hbl-service" value={d.service_type} disabled={ro} onChange={(e) => set("service_type", e.target.value.toUpperCase())} className={`${base} h-8 w-full`} />
            <datalist id="hbl-service">
              {["FCL/FCL", "LCL/LCL", "FCL/LCL", "LCL/FCL", "CY/CY", "CFS/CFS", "CFS-CFS"].map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </Labelled>
        </div>
      </Section>

      {/* ---- containers ---- */}
      <Section
        title="Containers"
        action={
          !ro && (
            <button type="button" onClick={() => set("containers", [...d.containers, emptyContainer()])} className="inline-flex items-center gap-1 text-[12px] text-text-accent hover:underline">
              <Plus size={12} /> Add a box
            </button>
          )
        }
      >
        {d.containers.length === 0 ? (
          <p className="text-[12px] text-text-muted">
            {variant === "ours" ? "None yet. Fetch details brings in the boxes and seals from the Containers tab." : "None on the bill. A groupage B/L often names none."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-text-secondary">
                  {["Container no.", "Seal no.", "Size / type", "Packages", "Kind", "Gross kg", "CBM", ""].map((h) => (
                    <th key={h} className="px-1 pb-1 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.containers.map((c, n) => (
                  <tr key={n}>
                    {(["container_no", "seal_no", "size_type", "packages", "package_type", "gross_kg", "cbm"] as Array<keyof HblContainer>).map((k) => (
                      <td key={k} className="px-1 py-0.5">
                        <input
                          value={c[k]}
                          disabled={ro}
                          onChange={(e) => setBox(n, { [k]: e.target.value.toUpperCase() })}
                          className={`${base} h-8 w-full ${["packages", "gross_kg", "cbm"].includes(k) ? "text-right tabular-nums" : ""} ${k === "container_no" || k === "seal_no" ? "font-mono" : ""}`}
                        />
                      </td>
                    ))}
                    <td className="px-1">
                      {!ro && (
                        <button
                          type="button"
                          onClick={() => set("containers", d.containers.filter((_, i) => i !== n))}
                          aria-label={`Remove ${c.container_no || "this box"}`}
                          className="grid size-8 place-items-center rounded-lg text-text-muted hover:bg-bg-danger hover:text-text-danger"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---- the particulars ---- */}
      <Section title="Particulars furnished by the shipper">
        <div className="grid gap-3 md:grid-cols-2">
          <Labelled label="Marks and numbers">{A("marks_numbers", 3)}</Labelled>
          <Labelled label="Description of goods">{A("description", 3)}</Labelled>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Labelled label="Packages">{T("packages")}</Labelled>
          <Labelled label="Kind of packages">{T("package_type")}</Labelled>
          <Labelled label="HS code">{T("hs_code")}</Labelled>
          <Labelled label="Gross weight (kg)">{T("gross_weight_kg")}</Labelled>
          <Labelled label="Measurement (CBM)">{T("measurement_cbm")}</Labelled>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-[12px] text-text-secondary">
            <input type="checkbox" checked={d.said_to_contain} disabled={ro} onChange={(e) => set("said_to_contain", e.target.checked)} />
            &ldquo;Said to contain&rdquo; above the goods
          </label>
          <label className="flex items-center gap-2 text-[12px] text-text-secondary">
            <input type="checkbox" checked={d.shippers_load} disabled={ro} onChange={(e) => set("shippers_load", e.target.checked)} />
            Shipper&rsquo;s load, stow, count and seal (a full box nobody saw packed)
          </label>
        </div>
        <p className="mt-2 text-[12px]">
          <span className="text-text-muted">Printed as: </span>
          <span className="font-medium text-text-primary">{totalInWords(d) || "—"}</span>
        </p>
        <div className="mt-3">
          <Labelled label="Remarks">{A("remarks", 2)}</Labelled>
        </div>
      </Section>

      {/* ---- freight and issue ---- */}
      <Section title="Freight and issue">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Labelled label="Freight">
            <select value={d.freight_terms} disabled={ro} onChange={(e) => setTerms(e.target.value as "prepaid" | "collect")} className={`${base} h-8 w-full`}>
              <option value="prepaid">Prepaid</option>
              <option value="collect">Collect</option>
            </select>
          </Labelled>
          <Labelled label="Freight payable at">{T("freight_payable_at")}</Labelled>
          <Labelled label="Place of issue">{T("place_of_issue")}</Labelled>
          <Labelled label="Date of issue">{D("date_of_issue")}</Labelled>
          <Labelled label="Shipped on board">{D("on_board_date")}</Labelled>
          <Labelled label="Cargo insurance through the issuer">
            <select value={d.insurance} disabled={ro} onChange={(e) => set("insurance", e.target.value as Insurance)} className={`${base} h-8 w-full`}>
              <option value="">Not stated</option>
              {(Object.keys(INSURANCE_LABEL) as Array<keyof typeof INSURANCE_LABEL>).map((k) => (
                <option key={k} value={k}>
                  {INSURANCE_LABEL[k]}
                </option>
              ))}
            </select>
          </Labelled>
          {variant === "ours" && (
            <>
              <Labelled label="Booking reference">{T("booking_ref")}</Labelled>
              <Labelled label="Export references (shipping bill, invoice)">{T("export_refs")}</Labelled>
            </>
          )}
        </div>

        {/* The freight table, as the B/L prints it. */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-text-secondary">Freight and charges table</span>
            {!ro && d.charges.length < 4 && (
              <button type="button" onClick={() => set("charges", [...d.charges, emptyCharge()])} className="inline-flex items-center gap-1 text-[12px] text-text-accent hover:underline">
                <Plus size={12} /> Add a line
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-text-secondary">
                  {["Charge", "Revenue tons", "Rate", "Prepaid", "Collect", ""].map((h) => (
                    <th key={h} className="px-1 pb-1 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.charges.map((c, n) => (
                  <tr key={n}>
                    {(["charge", "revenue_tons", "rate", "prepaid", "collect"] as Array<keyof HblCharge>).map((k) => (
                      <td key={k} className={`px-1 py-0.5 ${k === "charge" ? "w-[34%]" : ""}`}>
                        <input
                          value={c[k]}
                          disabled={ro}
                          onChange={(e) => setCharge(n, { [k]: e.target.value.toUpperCase() })}
                          className={`${base} h-8 w-full ${k === "charge" ? "" : "text-right"}`}
                        />
                      </td>
                    ))}
                    <td className="px-1">
                      {!ro && (
                        <button
                          type="button"
                          onClick={() => set("charges", d.charges.filter((_, i) => i !== n))}
                          aria-label={`Remove ${c.charge || "this line"}`}
                          className="grid size-8 place-items-center rounded-lg text-text-muted hover:bg-bg-danger hover:text-text-danger"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {variant === "ours" && (
          <p className="mt-3 text-[11.5px] text-text-muted">
            {d.mto_registration
              ? `Issued under MTO registration ${d.mto_registration}${d.mto_name ? ` of ${d.mto_name}` : ""}, with Aashish Logistics signing as agent.`
              : "Pick the partner whose MTO registration it is issued under, above."}
          </p>
        )}
      </Section>
    </>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card mb-3 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[11px] text-text-secondary">{label}</span>
      {children}
    </label>
  );
}
