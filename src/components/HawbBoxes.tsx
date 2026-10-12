import { useMemo, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { awbTotals, chargeAmount, emptyCharge, emptyRate, lineTotal, money, type HawbData, type OtherCharge, type PC, type RateLine } from "../lib/hawb";

/**
 * The boxes of a house air waybill, laid out like the IATA form.
 *
 * Shared by the two places a HAWB is typed: the job's own (HawbForm), which
 * fills it from the job, saves, numbers and issues it; and the Manual
 * documents page, which only prints what is typed. The boxes are the same
 * because the document is; everything around them — saving, numbering, the
 * history — belongs to whoever holds the form.
 *
 * `update` takes a function of the current HAWB rather than a new one, so two
 * changes made before a render (a rate line and the total under it) do not
 * overwrite each other.
 */
export default function HawbBoxes({
  d,
  update,
  ro,
  chargeNames = [],
  children,
}: {
  d: HawbData;
  update: (fn: (d: HawbData) => HawbData) => void;
  ro: boolean;
  /** Offered as the other charges are typed: the job's quotation's, on a job. */
  chargeNames?: string[];
  /** Under the boxes, inside the form: the HAWB number line, on a job. */
  children?: ReactNode;
}) {
  const totals = useMemo(() => awbTotals(d), [d]);
  const set = <K extends keyof HawbData>(k: K, v: HawbData[K]) => update((x) => ({ ...x, [k]: v }));
  const setRate = (i: number, patch: Partial<RateLine>) => update((x) => ({ ...x, rates: x.rates.map((r, n) => (n === i ? { ...r, ...patch } : r)) }));
  const setCharge = (i: number, patch: Partial<OtherCharge>) =>
    update((x) => ({ ...x, other_charges: x.other_charges.map((c, n) => (n === i ? { ...c, ...patch } : c)) }));

  // Full width unless a width is given: a fixed width and w-full on one input
  // is a coin toss the stylesheet decides.
  const base = "rounded border border-border bg-surface-1 px-2 py-1 text-[12.5px] uppercase disabled:bg-surface-2 disabled:text-text-secondary";
  const inp = `${base} w-full`;
  const T = (k: keyof HawbData, extra = "") => (
    <input value={d[k] as string} disabled={ro} onChange={(e) => set(k, e.target.value as never)} className={`${inp} ${extra}`} />
  );
  const A = (k: keyof HawbData, rows = 3) => (
    <textarea value={d[k] as string} disabled={ro} rows={rows} onChange={(e) => set(k, e.target.value as never)} className={`${inp} resize-y leading-snug`} />
  );
  const PCSel = (k: "wt_val" | "other") => (
    <select value={d[k]} disabled={ro} onChange={(e) => set(k, e.target.value as PC)} className={inp}>
      <option value="P">P</option>
      <option value="C">C</option>
    </select>
  );

  return (
    <div className="card overflow-x-auto p-3">
      <div className="min-w-[860px]">
      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
        <input value={d.airline_prefix} disabled={ro} onChange={(e) => set("airline_prefix", e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="176" title="Airline prefix (MAWB)" className={`${base} w-14 text-center font-mono`} />
        <span className="text-text-muted">|</span>
        <input value={d.departure_code} disabled={ro} onChange={(e) => set("departure_code", e.target.value.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase())} placeholder="MAA" title="Departure airport code" className={`${base} w-14 text-center font-mono`} />
        <span className="text-text-muted">|</span>
        <input value={d.mawb_serial} disabled={ro} onChange={(e) => set("mawb_serial", e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="MAWB serial" title="MAWB serial number" className={`${base} w-32 font-mono`} />
      </div>

      <div className="grid grid-cols-2 border-l border-t border-border-strong">
        {/* shipper | issuer */}
        <Cell>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <BoxLabel>Shipper's Name and Address</BoxLabel>
            </div>
            <div className="w-48">
              <BoxLabel>Shipper's Account Number</BoxLabel>
              {T("shipper_account")}
            </div>
          </div>
          <div className="mt-1.5 space-y-1">
            {T("shipper_name", "font-semibold")}
            {A("shipper_address")}
          </div>
        </Cell>
        <Cell>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold text-text-secondary">Not Negotiable</span>
            <input value={d.carrier_name} disabled={ro} onChange={(e) => set("carrier_name", e.target.value)} placeholder="Carrier" className={`${base} w-56 font-semibold`} />
          </div>
          <p className="mt-2 text-[18px] font-bold text-text-primary">Air Waybill</p>
          <BoxLabel>Issued by</BoxLabel>
          {A("issued_by", 3)}
          <p className="mt-1 text-[10.5px] text-text-muted">Copies 1, 2 and 3 of this Air Waybill are originals and have the same validity.</p>
        </Cell>

        {/* consignee | conditions */}
        <Cell>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <BoxLabel>Consignee's Name and Address</BoxLabel>
            </div>
            <div className="w-48">
              <BoxLabel>Consignee's Account Number</BoxLabel>
              {T("consignee_account")}
            </div>
          </div>
          <div className="mt-1.5 space-y-1">
            {T("consignee_name", "font-semibold")}
            {A("consignee_address")}
          </div>
        </Cell>
        <Cell>
          <p className="text-[10px] uppercase leading-relaxed text-text-muted">
            It is agreed that the goods declared herein are accepted in apparent good order and condition (except as noted) for carriage subject to the conditions
            of contract on the reverse hereof. All goods may be carried by any other means including road or any other carrier unless specific contrary instructions
            are given hereon by the shipper, and shipper agrees that the shipment may be carried via intermediate stopping places which the carrier deems
            appropriate. The shipper's attention is drawn to the notice concerning carrier's limitation of liability. Shipper may increase such limitation of
            liability by declaring a higher value for carriage and paying a supplemental charge if required.
          </p>
        </Cell>

        {/* agent | accounting */}
        <Cell>
          <BoxLabel>Issuing Carrier's Agent Name and City</BoxLabel>
          <div className="space-y-1">
            {T("agent_name")}
            {A("agent_address", 2)}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <BoxLabel>Agent's IATA Code</BoxLabel>
              {T("agent_iata_code")}
            </div>
            <div>
              <BoxLabel>Account Number</BoxLabel>
              {T("agent_account")}
            </div>
          </div>
          <div className="mt-2">
            <BoxLabel>Airport of Departure (Address of First Carrier) and Requested Routing</BoxLabel>
            {T("departure_airport", "text-center")}
          </div>
        </Cell>
        <Cell>
          <BoxLabel>Accounting Information</BoxLabel>
          {A("accounting_info", 3)}
          <div className="mt-2 flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold text-text-secondary">Reference Number</span>
            {T("reference_number", "normal-case")}
          </div>
        </Cell>
      </div>

      {/* ---- routing strip ---- */}
      <div className="grid grid-cols-[60px_1.4fr_60px_60px_60px_60px_70px_64px_56px_56px_56px_56px_1fr_1fr] border-l border-border-strong">
        <Head>To *</Head>
        <Head>By First Carrier *</Head>
        <Head>To</Head>
        <Head>By</Head>
        <Head>To</Head>
        <Head>By</Head>
        <Head>Currency</Head>
        <Head>Chgs Code</Head>
        <Head>WT/VAL</Head>
        <Head>&nbsp;</Head>
        <Head>Other</Head>
        <Head>&nbsp;</Head>
        <Head>Declared Value for Carriage *</Head>
        <Head>Declared Value for Customs *</Head>
        {(["to1", "by1", "to2", "by2", "to3", "by3", "currency", "chgs_code"] as const).map((k) => (
          <Slot key={k}>{T(k, "text-center")}</Slot>
        ))}
        <Slot>{PCSel("wt_val")}</Slot>
        <Slot>
          <span className="block pt-1 text-center text-[11px] text-text-muted">{d.wt_val === "P" ? "PPD" : "COLL"}</span>
        </Slot>
        <Slot>{PCSel("other")}</Slot>
        <Slot>
          <span className="block pt-1 text-center text-[11px] text-text-muted">{d.other === "P" ? "PPD" : "COLL"}</span>
        </Slot>
        <Slot>{T("dv_carriage", "text-center")}</Slot>
        <Slot>{T("dv_customs", "text-center")}</Slot>
      </div>

      <div className="grid grid-cols-[1.1fr_1.5fr_1.5fr_1fr_2fr] border-l border-border-strong">
        <Head>Destination Airport *</Head>
        <Head>Flight &amp; Date</Head>
        <Head>Flight &amp; Date</Head>
        <Head>Insurance Amount *</Head>
        <Head>&nbsp;</Head>
        <Slot>{T("destination_airport", "text-center")}</Slot>
        <Slot>
          <div className="flex gap-1">
            <input value={d.flight1} disabled={ro} onChange={(e) => set("flight1", e.target.value.toUpperCase())} className={`${base} w-24`} />
            <input type="date" value={d.flight1_date} disabled={ro} onChange={(e) => set("flight1_date", e.target.value)} className={`${inp} normal-case`} />
          </div>
        </Slot>
        <Slot>
          <div className="flex gap-1">
            <input value={d.flight2} disabled={ro} onChange={(e) => set("flight2", e.target.value.toUpperCase())} className={`${base} w-24`} />
            <input type="date" value={d.flight2_date} disabled={ro} onChange={(e) => set("flight2_date", e.target.value)} className={`${inp} normal-case`} />
          </div>
        </Slot>
        <Slot>{T("insurance", "text-center")}</Slot>
        <Slot>
          <p className="text-[9.5px] leading-snug text-text-muted">
            INSURANCE — If carrier offers insurance, and such insurance is requested in accordance with the conditions thereof, indicate amount to be insured in
            figures in box marked "Amount of insurance".
          </p>
        </Slot>
      </div>

      <div className="grid grid-cols-[1fr_220px] border-l border-border-strong">
        <Slot>
          <BoxLabel>Handling Information</BoxLabel>
          {A("handling_info", 3)}
          <div className="mt-1.5 flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold text-text-secondary">PAN Number</span>
            <input value={d.pan_number} disabled={ro} onChange={(e) => set("pan_number", e.target.value.toUpperCase())} className={`${base} w-44`} />
          </div>
        </Slot>
        <Slot>
          <BoxLabel>SCI</BoxLabel>
          {T("sci")}
        </Slot>
      </div>

      {/* ---- rate lines ---- */}
      <div className="grid grid-cols-[1fr_300px] border-l border-border-strong">
        <div className="border-b border-r border-border-strong">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-surface-2 text-[10.5px] font-semibold text-text-secondary">
                {["Number of Pieces", "Gross Weight", "KG/LB", "Rate Class", "Commodity Item No.", "Chargeable Weight", "Rate / Charge", "Total", ""].map((h, i) => (
                  <th key={i} className="border-b border-r border-border px-1.5 py-1 text-left font-semibold last:border-r-0">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rates.map((r, i) => (
                <tr key={i}>
                  <Td>
                    <input value={r.pieces} disabled={ro} onChange={(e) => setRate(i, { pieces: e.target.value })} inputMode="numeric" className={inp} />
                  </Td>
                  <Td>
                    <input value={r.gross} disabled={ro} onChange={(e) => setRate(i, { gross: e.target.value })} inputMode="decimal" className={inp} />
                  </Td>
                  <Td>
                    <select value={r.unit} disabled={ro} onChange={(e) => setRate(i, { unit: e.target.value as "K" | "L" })} className={inp}>
                      <option value="K">K</option>
                      <option value="L">L</option>
                    </select>
                  </Td>
                  <Td>
                    <select value={r.rate_class} disabled={ro} onChange={(e) => setRate(i, { rate_class: e.target.value })} className={inp} title="M minimum, N normal, Q quantity, C specific commodity, R reduced, S surcharged">
                      <option value=""></option>
                      {["M", "N", "Q", "C", "R", "S"].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td>
                    <input value={r.commodity_item} disabled={ro} onChange={(e) => setRate(i, { commodity_item: e.target.value })} className={inp} />
                  </Td>
                  <Td>
                    <input value={r.chargeable} disabled={ro} onChange={(e) => setRate(i, { chargeable: e.target.value })} inputMode="decimal" className={inp} />
                  </Td>
                  <Td>
                    <input value={r.rate} disabled={ro} onChange={(e) => setRate(i, { rate: e.target.value })} inputMode="decimal" className={inp} />
                  </Td>
                  <Td>
                    <input
                      value={r.total}
                      disabled={ro}
                      onChange={(e) => setRate(i, { total: e.target.value })}
                      placeholder={money(lineTotal({ ...r, total: "" })) || "rate × wt"}
                      title="Worked out from rate × chargeable weight; type to override"
                      className={inp}
                    />
                  </Td>
                  <Td>
                    {!ro && d.rates.length > 1 && (
                      <button type="button" onClick={() => set("rates", d.rates.filter((_, n) => n !== i))} className="p-1 text-text-muted hover:text-text-danger" aria-label="Remove rate line">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
              <tr className="bg-surface-2 text-[12px] font-semibold">
                <td className="px-2 py-1">{totals.pieces || ""}</td>
                <td className="px-2 py-1">{totals.gross || ""}</td>
                <td className="px-2 py-1">{d.rates[0]?.unit}</td>
                <td colSpan={4} className="px-2 py-1 text-right">
                  {!ro && (
                    <button type="button" onClick={() => set("rates", [...d.rates, emptyRate()])} className="inline-flex items-center gap-1 text-[11px] font-normal text-text-accent hover:underline">
                      <Plus size={11} /> Add a rate line
                    </button>
                  )}
                </td>
                <td className="px-2 py-1">{money(totals.weightCharge)}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <div className="border-t border-border p-2">
            <BoxLabel>Marks &amp; Numbers</BoxLabel>
            {A("marks_numbers", 2)}
          </div>
        </div>
        <Slot>
          <BoxLabel>Nature and Quantity of Goods (incl. Dimensions &amp; Volume)</BoxLabel>
          {A("nature_of_goods", 9)}
        </Slot>
      </div>

      {/* ---- charges | other charges and signatures ---- */}
      <div className="grid grid-cols-2 border-l border-border-strong">
        <div className="border-b border-r border-border-strong">
          <ChargeRow label="Weight Charges" pp={money(totals.prepaid.weight)} cc={money(totals.collect.weight)} head />
          <ChargeRow
            label="Valuation Charges"
            pp={d.wt_val === "P" ? <input value={d.valuation_charge} disabled={ro} onChange={(e) => set("valuation_charge", e.target.value)} inputMode="decimal" className={inp} /> : ""}
            cc={d.wt_val === "C" ? <input value={d.valuation_charge} disabled={ro} onChange={(e) => set("valuation_charge", e.target.value)} inputMode="decimal" className={inp} /> : ""}
          />
          <ChargeRow
            label="Tax"
            pp={d.wt_val === "P" ? <input value={d.tax} disabled={ro} onChange={(e) => set("tax", e.target.value)} inputMode="decimal" className={inp} /> : ""}
            cc={d.wt_val === "C" ? <input value={d.tax} disabled={ro} onChange={(e) => set("tax", e.target.value)} inputMode="decimal" className={inp} /> : ""}
          />
          <ChargeRow label="Total Other Charges Due Agent" pp={money(totals.prepaid.dueAgent)} cc={money(totals.collect.dueAgent)} />
          <ChargeRow label="Total Other Charges Due Carrier" pp={money(totals.prepaid.dueCarrier)} cc={money(totals.collect.dueCarrier)} />
          <ChargeRow label="Total Prepaid  |  Total Collect" pp={money(totals.prepaid.total)} cc={money(totals.collect.total)} strong />
          <ChargeRow
            label="Currency Conversion Rate  |  CC Charges in Dest. Currency"
            pp={<input value={d.conversion_rate} disabled={ro} onChange={(e) => set("conversion_rate", e.target.value)} inputMode="decimal" className={inp} />}
            cc={money(totals.ccInDestCurrency)}
          />
          <ChargeRow
            label="Charges at Destination  |  Total Collect Charges"
            pp={<input value={d.charges_at_destination} disabled={ro} onChange={(e) => set("charges_at_destination", e.target.value)} inputMode="decimal" className={inp} />}
            cc={money(totals.totalCollectCharges)}
          />
        </div>

        <div className="border-b border-r border-border-strong">
          <div className="p-2">
            <div className="mb-1 flex items-center justify-between">
              <BoxLabel>Other Charges</BoxLabel>
              {!ro && (
                <button type="button" onClick={() => set("other_charges", [...d.other_charges, emptyCharge(d.other)])} className="inline-flex items-center gap-1 text-[11px] text-text-accent hover:underline">
                  <Plus size={11} /> Add a charge
                </button>
              )}
            </div>
            {d.other_charges.length === 0 ? (
              <p className="py-2 text-[11.5px] text-text-muted">None. Add the charges the HAWB should show, or leave it blank for "as agreed".</p>
            ) : (
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] text-text-secondary">
                    <th className="pb-1 font-semibold">Charge *</th>
                    <th className="pb-1 font-semibold">Unit</th>
                    <th className="pb-1 font-semibold">Per unit</th>
                    <th className="pb-1 font-semibold">Amount</th>
                    <th className="pb-1 font-semibold">Due</th>
                    <th className="pb-1 font-semibold">PP/CC</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.other_charges.map((c, i) => (
                    <tr key={i}>
                      <td className="pr-1 pb-1">
                        <input value={c.name} disabled={ro} list="hawb-charge-names" onChange={(e) => setCharge(i, { name: e.target.value })} className={inp} />
                      </td>
                      <td className="pr-1 pb-1">
                        <select value={c.unit} disabled={ro} onChange={(e) => setCharge(i, { unit: e.target.value as OtherCharge["unit"] })} className={`${inp} normal-case`}>
                          <option value="shipment">Shipment</option>
                          <option value="kg">Per kg</option>
                          <option value="piece">Per piece</option>
                        </select>
                      </td>
                      <td className="w-20 pr-1 pb-1">
                        <input value={c.per_unit} disabled={ro} onChange={(e) => setCharge(i, { per_unit: e.target.value })} inputMode="decimal" className={inp} />
                      </td>
                      <td className="w-24 pr-1 pb-1">
                        <input
                          value={c.amount}
                          disabled={ro}
                          onChange={(e) => setCharge(i, { amount: e.target.value })}
                          placeholder={money(chargeAmount({ ...c, amount: "" }, totals.chargeable, totals.pieces))}
                          title="Worked out from per unit × quantity; type to override"
                          inputMode="decimal"
                          className={inp}
                        />
                      </td>
                      <td className="pr-1 pb-1">
                        <select value={c.due} disabled={ro} onChange={(e) => setCharge(i, { due: e.target.value as OtherCharge["due"] })} className={`${inp} normal-case`}>
                          <option value="carrier">Carrier</option>
                          <option value="agent">Agent</option>
                        </select>
                      </td>
                      <td className="pr-1 pb-1">
                        <select value={c.pp} disabled={ro} onChange={(e) => setCharge(i, { pp: e.target.value as PC })} className={`${inp} normal-case`}>
                          <option value="P">Prepaid</option>
                          <option value="C">Collect</option>
                        </select>
                      </td>
                      <td className="pb-1">
                        {!ro && (
                          <button type="button" onClick={() => set("other_charges", d.other_charges.filter((_, n) => n !== i))} className="p-1 text-text-muted hover:text-text-danger" aria-label="Remove charge">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <datalist id="hawb-charge-names">
              {chargeNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>

          <div className="border-t border-border p-2">
            <p className="text-[10px] leading-snug text-text-muted">
              Shipper certifies that the particulars on the face hereof are correct and that insofar as any part of the consignment contains dangerous goods, such part
              is properly described by name and is in proper condition for carriage by air according to the applicable Dangerous Goods Regulations.
            </p>
            <input value={d.shipper_signature} disabled={ro} onChange={(e) => set("shipper_signature", e.target.value)} className={`${inp} mt-1.5 text-center`} />
            <p className="mt-0.5 border-t border-dashed border-border-strong pt-0.5 text-center text-[10.5px] font-semibold text-text-secondary">Signature of Shipper or Agent</p>
          </div>

          <div className="border-t border-border p-2">
            <p className="text-[10px] leading-snug text-text-muted">
              Carrier certifies that the goods described hereon are accepted for carriage subject to the conditions of contract on the reverse hereof, the goods then
              being in apparent good order and condition except as noted hereon.
            </p>
            <input value={d.carrier_signature} disabled={ro} onChange={(e) => set("carrier_signature", e.target.value)} className={`${inp} mt-1.5`} />
            <div className="mt-1.5 grid grid-cols-[1fr_90px] gap-2">
              <div>
                <input type="date" value={d.executed_on} disabled={ro} onChange={(e) => set("executed_on", e.target.value)} className={`${inp} normal-case`} />
                <p className="text-center text-[10.5px] font-semibold text-text-secondary">Executed on (Date)</p>
              </div>
              <div>
                <input value={d.executed_at} disabled={ro} onChange={(e) => set("executed_at", e.target.value.toUpperCase())} className={`${inp} text-center`} />
                <p className="text-center text-[10.5px] font-semibold text-text-secondary">at (Place)</p>
              </div>
            </div>
            <p className="mt-1 text-center text-[10.5px] font-semibold text-text-secondary">Signature of Issuing Carrier or its Agent</p>
          </div>
        </div>
      </div>

        {children}
      </div>
    </div>
  );
}

const Cell = ({ children }: { children: ReactNode }) => <div className="border-b border-r border-border-strong p-2">{children}</div>;
const Slot = ({ children }: { children: ReactNode }) => <div className="border-b border-r border-border-strong p-1.5">{children}</div>;
const Head = ({ children }: { children: ReactNode }) => (
  <div className="border-b border-r border-border bg-surface-2 px-1.5 py-1 text-[10.5px] font-semibold leading-tight text-text-secondary">{children}</div>
);
const BoxLabel = ({ children }: { children: ReactNode }) => <p className="mb-0.5 text-[11px] font-semibold text-text-secondary">{children}</p>;
const Td = ({ children }: { children: ReactNode }) => <td className="border-r border-border px-1 py-1 last:border-r-0">{children}</td>;

function ChargeRow({ label, pp, cc, head, strong }: { label: string; pp: ReactNode; cc: ReactNode; head?: boolean; strong?: boolean }) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex justify-center">
        <span className="-mb-px rounded-b-md border border-t-0 border-border bg-surface-2 px-2 text-[10.5px] font-semibold text-text-secondary">{label}</span>
      </div>
      <div className="grid grid-cols-2">
        <div className={`border-r border-border px-2 pb-1.5 pt-1 text-right text-[12.5px] tabular-nums ${strong ? "font-semibold" : ""}`}>
          {head && <span className="float-left text-[10.5px] font-semibold text-text-muted">Prepaid</span>}
          {pp || <span className="text-text-muted">&nbsp;</span>}
        </div>
        <div className={`px-2 pb-1.5 pt-1 text-right text-[12.5px] tabular-nums ${strong ? "font-semibold" : ""}`}>
          {head && <span className="float-left text-[10.5px] font-semibold text-text-muted">Collect</span>}
          {cc || <span className="text-text-muted">&nbsp;</span>}
        </div>
      </div>
    </div>
  );
}
