import { useState } from "react";
import { AlertCircle, FileText } from "lucide-react";
import Collapsible from "./Collapsible";
import { Field, TextSave } from "./formControls";
import { failureText } from "../lib/errorText";
import { docDate } from "../lib/documents/letterhead";
import type { BookingExtras } from "../lib/documents/data";
import { updateShipment, type Shipment } from "../services/enquiries";

/**
 * What the arrival notice and the delivery order print that nothing else on
 * the job keeps (142), on the Documents tab above them.
 *
 * ---------------------------------------------------------------------------
 * The user, with a line's CAN and DO: every field on those papers is to be in
 * the CRM, typed or read in. The rest of each paper is the job's already —
 * its parties, vessel, ports, IGM line, boxes and seals, the bills as Gemini
 * read them in, the console — and these are the remainder. Where a bill or
 * the console says one of them, the field says so under it and the paper
 * prints that until something is typed here.
 * ---------------------------------------------------------------------------
 */
export default function ArrivalParticulars({
  shipment: s,
  extras,
  onSaved,
}: {
  shipment: Shipment;
  extras: BookingExtras;
  onSaved: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(key: keyof Shipment, value: string) {
    setBusy(key);
    setError(null);
    try {
      await updateShipment(s.id, { [key]: value.trim() || null });
      await onSaved();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  const day = (v?: string | null) => (v ? docDate(v) : "");
  /** A typed field, saved when left; a date field when picked. */
  const text = (key: keyof Shipment, label: string, opts: { hint?: string; placeholder?: string; date?: boolean } = {}) => (
    <Field label={label} hint={opts.hint}>
      <TextSave
        type={opts.date ? "date" : "text"}
        value={String(s[key] ?? "").slice(0, opts.date ? 10 : undefined)}
        placeholder={opts.placeholder}
        busy={busy === key}
        onSave={(v) => void save(key, v)}
      />
    </Field>
  );
  /** Under a field the paper fills from elsewhere while it is empty: where from. */
  const fetched = (what: string | undefined, from: string) => (what ? `Left empty, ${what}, ${from}.` : undefined);
  const bill = extras.bill;
  const issuedHere = Boolean(bill?.doIssuedOn);

  return (
    <Collapsible
      id="shipment:arrival-particulars"
      title="Arrival notice & delivery order"
      icon={<FileText size={12} className="shrink-0 text-text-muted" />}
      hint="The particulars these two print that the rest of the job does not hold."
    >
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-3">
        {text("po_number", "PO number")}
        {text("sales_ref", "Sales ref")}
        {text("invoice_ref", "Invoice ref", {
          placeholder: extras.invoiceNumber ?? "",
          hint: extras.invoiceNumber ? `Left empty, the tax invoice's number.` : "Left empty, the tax invoice's number once it has one.",
        })}

        {text("bl_date", "House B/L date", { date: true, hint: fetched(day(bill?.date), "from the B/L on the Bill tab") })}
        {text("mainline_date", "Master B/L date", { date: true, hint: fetched(day(extras.masterDate), "the console's") })}
        <div className="hidden md:block" />
        {text("auth_bl_no", "Auth. B/L number", { hint: "A bill between the master and the house: the co-loader's." })}
        {text("auth_bl_date", "Auth. B/L date", { date: true })}
        <div className="hidden md:block" />

        {text("final_eta", "ETA at the final destination", { date: true })}
        {text("cfs_address", "CFS address", {
          hint: s.cfs_location || extras.cfsName ? `For ${s.cfs_location || extras.cfsName}: the DO is addressed to its manager.` : "The CFS itself is under Booking details.",
        })}
        {text("cfs_eta", "ETA at the CFS", { date: true })}
        {text("cfs_clearance_date", "Unstuffed at the CFS on", { date: true, hint: fetched(day(extras.unstuffDate), "the console's") })}
        {text("tsa_no", "TSA number")}
        <div className="hidden md:block" />

        {text("consignee_iec_type", "Importer type", { placeholder: "Company, partnership, proprietary", hint: "Beside the consignee's IEC, which is on the Parties tab." })}
        {text("deliver_to", "Please deliver to", { placeholder: s.consignee_name ?? "", hint: "Left empty, the consignee. Its CHA, where the CHA takes delivery." })}
        <div className="hidden md:block" />
        {issuedHere ? (
          <Field label="DO date and validity" className="md:col-span-2">
            <span className="flex h-9 items-center rounded-lg bg-surface-2 px-3 text-[13px] text-text-primary">
              {day(bill?.doIssuedOn)}
              {bill?.doValidUntil ? `, valid until ${day(bill.doValidUntil)}` : ""}
            </span>
            <p className="mt-1 text-[11px] text-text-muted">As the DO was issued on the agent's B/L, on the Bill tab.</p>
          </Field>
        ) : (
          <>
            {text("do_issued_on", "DO date", { date: true, hint: "Left empty, the day it is printed." })}
            {text("do_valid_until", "DO valid until", { date: true })}
          </>
        )}
      </div>
    </Collapsible>
  );
}
