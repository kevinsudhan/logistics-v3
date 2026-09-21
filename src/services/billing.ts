import { supabase } from "../lib/supabase";
// The charge catalogue and the money formatter moved to ./charges, because
// quoting needs them and quoting is not accounts. Re-exported below for the
// pages that read an invoice and format its total in the same breath.
import { money, STATES, type TradeDirection } from "./charges";

/**
 * Invoices, their charge lines, and the party they are addressed to.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE RULES LIVE
 *
 * Not here. Numbering, the tax split, the refusal to edit an issued document
 * and the refusal to issue an empty one are all in `030-billing.sql`, because
 * they have to hold whether the write came from this file, from a script, or
 * from somebody with the SQL editor open. This module calls those functions and
 * shapes what comes back for the screen.
 *
 * The one thing it does own is the lists an operator picks from — charge heads,
 * states, treatments — which are presentation, not policy.
 * ---------------------------------------------------------------------------
 */

export type InvoiceKind = "tax_invoice" | "proforma" | "credit_note" | "debit_note";
export type InvoiceStatus = "draft" | "issued" | "part_paid" | "paid" | "cancelled";
export type TaxTreatment = "cgst_sgst" | "igst" | "export_lut" | "export_igst" | "exempt";

export const KIND_LABEL: Record<InvoiceKind, string> = {
  tax_invoice: "Tax invoice",
  proforma: "Proforma",
  credit_note: "Credit note",
  debit_note: "Debit note",
};

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  part_paid: "Part paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

/**
 * What each treatment means, in the words an operator would use.
 *
 * The hint matters more than the label here. "IGST" tells somebody who already
 * knows nothing they did not know; "billed to another state" is the fact they
 * are actually deciding.
 */
export const TREATMENTS: { value: TaxTreatment; label: string; hint: string }[] = [
  { value: "cgst_sgst", label: "CGST + SGST", hint: "Customer is in Tamil Nadu — tax splits in two" },
  { value: "igst", label: "IGST", hint: "Customer is in another Indian state" },
  { value: "export_lut", label: "Export — zero rated (LUT)", hint: "Overseas customer, no tax collected" },
  { value: "export_igst", label: "Export — IGST paid", hint: "Overseas customer, IGST charged and refund claimed" },
  { value: "exempt", label: "Exempt / non-GST", hint: "No tax applies to this supply" },
];


export const stateName = (code: string | null) =>
  STATES.find((s) => s.code === code)?.name ?? null;

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  sac_code: string | null;
  quantity: number;
  unit: string;
  rate: number;
  /** Generated in the database from quantity × rate. Never sent. */
  amount: number;
  /** The currency this line is charged in. Freight in USD, local charges in INR. */
  currency: string;
  /** INR per one unit of `currency`, as used on this document. */
  fx_rate: number;
  /** Generated: quantity × rate × fx_rate. What the totals are footed on. */
  amount_inr: number;
  tax_rate: number;
  is_reimbursement: boolean;
  created_at: string;
}

export interface Invoice {
  id: string;
  number: string | null;
  series: string;
  fy: string | null;
  kind: InvoiceKind;
  status: InvoiceStatus;

  shipment_id: string | null;
  enquiry_ref: string | null;
  customer_id: string;

  invoice_date: string;
  due_date: string | null;

  bill_to_name: string;
  bill_to_address: string;
  bill_to_gstin: string | null;
  bill_to_state: string | null;
  bill_to_state_code: string | null;
  bill_to_country: string;

  attention: string;
  account_of: string;

  bl_number: string | null;
  bl_date: string | null;
  vessel_voyage: string | null;
  movement_type: string | null;
  volume_cbm: number | null;
  gross_weight_kg: number | null;

  currency: string;
  exchange_rate: number;
  place_of_supply: string | null;
  place_of_supply_code: string | null;
  tax_treatment: TaxTreatment;

  /** Set on a credit or debit note: the invoice it corrects (042). */
  original_invoice_id: string | null;
  original_number: string | null;
  original_date: string | null;
  note_reason: string | null;
  partner_id: string | null;
  console_id: string | null;
  /** Snapshotted off the shipment, so the charge list is the one that applied. */
  trade_direction: TradeDirection | null;

  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
  total_inr: number;

  description: string;
  remarks: string;
  bank_account: string;
  show_can_details: boolean;
  extension_date: string | null;

  issued_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;

  /** Joined in by the loaders below, not columns. */
  lines?: InvoiceLine[];
  customer_label?: string | null;
}


export async function listInvoicesForShipment(shipmentId: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*, lines:invoice_lines(*)")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    ...(row as Invoice),
    lines: [...((row as Invoice).lines ?? [])].sort((a, b) => a.position - b.position),
  }));
}

/**
 * Every invoice on the desk, newest first.
 *
 * The register, as opposed to the per-job list. This is what answers the
 * questions no single shipment can — what is outstanding, what is overdue, what
 * is still sitting in draft — which is the surface the reference system does
 * not have at all: it has six entry screens and a reports menu.
 */
export async function listInvoices(opts?: {
  status?: InvoiceStatus[];
  kind?: InvoiceKind;
  limit?: number;
  /** Bring the charge lines too. Only the export needs them. */
  withLines?: boolean;
}): Promise<Invoice[]> {
  // Kept as a plain string rather than inline: supabase-js parses the select
  // at the type level, and a ternary of two literals defeats that and surfaces
  // as a ParserError where the row shape should be.
  const columns: string = opts?.withLines
    ? "*, customers(name, company), lines:invoice_lines(*)"
    : "*, customers(name, company)";

  let q = supabase
    .from("invoices")
    .select(columns)
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (opts?.status?.length) q = q.in("status", opts.status);
  if (opts?.kind) q = q.eq("kind", opts.kind);
  q = q.limit(opts?.limit ?? 200);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const { customers, ...rest } = row as unknown as Record<string, unknown> & {
      customers?: { name?: string; company?: string } | null;
    };
    return {
      ...(rest as unknown as Invoice),
      customer_label: customers?.company || customers?.name || null,
    };
  });
}

/**
 * Shipments that have been delivered or are moving, with nothing issued against
 * them.
 *
 * The question a forwarder loses money to. A job that sailed, arrived and was
 * delivered without an invoice is not a gap anybody notices from inside that
 * job's own page — it is only visible by asking across all of them.
 */
export async function unbilledShipments(): Promise<
  { id: string; customer: string | null; stage: string; agreed_inr: number | null }[]
> {
  const [{ data: ships, error }, { data: billing }] = await Promise.all([
    supabase
      .from("shipments")
      .select("id, stage, agreed_inr, customers(name, company)")
      .neq("stage", "cancelled")
      .order("created_at", { ascending: false }),
    supabase.from("shipment_billing").select("shipment_id, invoice_count"),
  ]);
  if (error) throw new Error(error.message);

  const billed = new Set(
    (billing ?? [])
      .filter((b) => Number((b as { invoice_count: number }).invoice_count) > 0)
      .map((b) => (b as { shipment_id: string }).shipment_id)
  );

  return (ships ?? [])
    .filter((s) => !billed.has((s as { id: string }).id))
    .map((s) => {
      const row = s as {
        id: string;
        stage: string;
        agreed_inr: number | null;
        customers?: { name?: string; company?: string } | null;
      };
      return {
        id: row.id,
        stage: row.stage,
        agreed_inr: row.agreed_inr,
        customer: row.customers?.company || row.customers?.name || null,
      };
    });
}

/**
 * Raise a credit or debit note against an issued invoice.
 *
 * Everything comes from the document being corrected — the same party, job and
 * tax treatment — because a credit note addressed to somebody other than the
 * person who got the invoice is not a credit note. Rule 53(1A) also wants the
 * original's number and date printed on it, so they are snapshotted across.
 */
export async function startNote(
  invoiceId: string,
  kind: "credit_note" | "debit_note",
  reason = ""
): Promise<Invoice> {
  const { data, error } = await supabase.rpc("start_note", {
    p_invoice: invoiceId,
    p_kind: kind,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as Invoice;
}

/**
 * The last date a note against this supply can still adjust tax.
 *
 * Section 34(2): the 30th of November following the end of the financial year
 * the original supply fell in — or the date the annual return for that year was
 * filed, if earlier. This system does not know the filing date, so this is the
 * outer limit and the screen says as much.
 */
export function noteAdjustmentDeadline(supplyDate: string): Date {
  const d = new Date(supplyDate + "T00:00:00");
  const year = d.getMonth() >= 3 ? d.getFullYear() + 1 : d.getFullYear();
  return new Date(year, 10, 30);
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*, lines:invoice_lines(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const inv = data as Invoice;
  return { ...inv, lines: [...(inv.lines ?? [])].sort((a, b) => a.position - b.position) };
}

/**
 * Opens a draft against a shipment, or returns the one already open.
 *
 * Every field it can fill, it fills — from the shipment and the customer. The
 * screen this replaces asks for the B/L number in a required text box, on a
 * page you reached by clicking that B/L.
 */
export async function startInvoice(shipmentId: string, kind: InvoiceKind = "tax_invoice") {
  const { data, error } = await supabase.rpc("start_invoice", {
    p_shipment_id: shipmentId,
    p_kind: kind,
  });
  if (error) throw new Error(error.message);
  return data as Invoice;
}

/** Header edits. Totals move themselves when the treatment or the rate changes. */
export async function updateInvoice(id: string, patch: Partial<Invoice>): Promise<Invoice> {
  const { data, error } = await supabase
    .from("invoices")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*, lines:invoice_lines(*)")
    .single();
  if (error) throw new Error(error.message);
  return data as Invoice;
}

export async function addLine(
  invoiceId: string,
  line: Partial<Omit<InvoiceLine, "id" | "invoice_id" | "amount" | "created_at">>
): Promise<InvoiceLine> {
  const { data, error } = await supabase
    .from("invoice_lines")
    .insert({ invoice_id: invoiceId, ...line })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as InvoiceLine;
}

export async function updateLine(
  id: string,
  patch: Partial<Omit<InvoiceLine, "id" | "invoice_id" | "amount" | "created_at">>
): Promise<InvoiceLine> {
  const { data, error } = await supabase
    .from("invoice_lines")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as InvoiceLine;
}

export async function removeLine(id: string): Promise<void> {
  const { error } = await supabase.from("invoice_lines").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Allocates the number and closes the document. There is no undo but cancel. */
export async function issueInvoice(id: string): Promise<Invoice> {
  const { data, error } = await supabase.rpc("issue_invoice", { p_id: id });
  if (error) throw new Error(error.message);
  return data as Invoice;
}

export async function cancelInvoice(id: string, reason: string): Promise<Invoice> {
  const { data, error } = await supabase.rpc("cancel_invoice", { p_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
  return data as Invoice;
}

export interface CustomerBilling {
  id: string;
  name: string;
  company: string;
  billing_name: string | null;
  billing_address: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_state_code: string | null;
  billing_pincode: string | null;
  billing_country: string;
  gstin: string | null;
  pan: string | null;
  iec: string | null;
  billing_email: string | null;
  billing_attention: string | null;
  payment_terms_days: number | null;
}

export async function getCustomerBilling(id: string): Promise<CustomerBilling | null> {
  const { data, error } = await supabase
    .from("customers")
    // One literal rather than a concatenation: supabase-js reads this string at
    // the type level to work out the row shape, and joining pieces together
    // defeats that and lands you with an error about GenericStringError.
    .select(
      "id, name, company, billing_name, billing_address, billing_city, billing_state, billing_state_code, billing_pincode, billing_country, gstin, pan, iec, billing_email, billing_attention, payment_terms_days"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CustomerBilling) ?? null;
}

export async function updateCustomerBilling(
  id: string,
  patch: Partial<CustomerBilling>
): Promise<void> {
  const { error } = await supabase
    .from("customers")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * A GSTIN carries its own state code in the first two characters, and its own
 * PAN in characters 3 to 12. Reading them out beats asking for the same fact
 * three times — and beats the reference system's approach, which is a text area
 * with the words "GST No." sitting in it unfilled.
 *
 * Deliberately not a validity check. The checksum would tell us a well-formed
 * number is well-formed, not that it belongs to this customer, and refusing to
 * save a number the desk copied off a real invoice would be worse than storing
 * it.
 */
export function readGstin(gstin: string): { stateCode: string; pan: string } | null {
  const g = gstin.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(g)) return null;
  return { stateCode: g.slice(0, 2), pan: g.slice(2, 12) };
}

/** Days past due, negative while it is still in terms. Null when nothing is due. */
export function daysOverdue(inv: Invoice, today = new Date()): number | null {
  if (!inv.due_date) return null;
  if (inv.status !== "issued" && inv.status !== "part_paid") return null;
  const due = new Date(inv.due_date + "T00:00:00");
  return Math.floor((today.getTime() - due.getTime()) / 86_400_000);
}

export { money };
