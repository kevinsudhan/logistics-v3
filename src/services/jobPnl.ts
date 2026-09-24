import { supabase } from "../lib/supabase";
import { istDay } from "../lib/enquiryRegister";
import type { PnlDoc, PnlJob } from "../lib/jobPnl";
import { all, group, num, str, whereIn } from "./paging";

/**
 * Reading every job, invoice and bill the P&L is worked out from.
 *
 * A handful of reads for the whole book rather than a round per job: the
 * shipments, the invoices and bills with their lines, what is still owed each
 * way (job_final_bill, 042), the accepted quotations, and the names. The
 * figures themselves are worked out in src/lib/jobPnl.ts.
 */

export interface PnlData {
  jobs: PnlJob[];
  docs: PnlDoc[];
}

const dayOf = (v: unknown) => (v ? istDay(String(v)) : null);

export async function loadPnl(): Promise<PnlData> {
  const [shipments, invoices, bills, owed, people] = await Promise.all([
    all((a, b) =>
      supabase
        .from("shipments")
        .select(
          "id, enquiry_ref, stage, transport_mode, trade_direction, origin, destination, etd, created_at, signed_off_at, console_id, volume_cbm, gross_weight_kg, customer:customers(name, company), enquiry:enquiries(assigned_to)"
        )
        .order("created_at")
        .range(a, b)
    ),
    all((a, b) =>
      supabase
        .from("invoices")
        .select("id, number, kind, status, invoice_date, created_at, shipment_id, console_id, bill_to_name, taxable_value")
        .neq("status", "cancelled")
        .range(a, b)
    ),
    all((a, b) =>
      supabase
        .from("bills")
        .select("id, bill_no, kind, status, bill_date, created_at, shipment_id, console_id, partner_id, exchange_rate, taxable_value")
        .neq("status", "cancelled")
        .range(a, b)
    ),
    all((a, b) => supabase.from("job_final_bill").select("shipment_id, billed_inr, collected_inr, cost_inr, paid_out_inr, open_drafts, disputed_bills").range(a, b)),
    all((a, b) => supabase.from("profiles").select("id, full_name").range(a, b)),
  ]);

  const refs = shipments.map((s) => str(s.enquiry_ref) ?? "");
  const [invoiceLines, billLines, partners, quotes, consoles] = await Promise.all([
    whereIn("invoice_lines", "invoice_id, description, amount_inr, is_reimbursement", "invoice_id", invoices.map((i) => String(i.id))),
    whereIn("bill_lines", "bill_id, description, amount", "bill_id", bills.map((b) => String(b.id))),
    whereIn("partners", "id, name, organisation", "id", bills.map((b) => str(b.partner_id) ?? "")),
    whereIn("quotes", "id, enquiry_ref, status, version, amount_inr", "enquiry_ref", refs),
    whereIn("consoles", "id, console_no", "id", shipments.map((s) => str(s.console_id) ?? "")),
  ]);

  // The accepted quotation is the plan the job is measured against.
  const accepted = new Map<string, Record<string, unknown>>();
  for (const q of quotes) {
    if (q.status !== "accepted") continue;
    const had = accepted.get(String(q.enquiry_ref));
    if (!had || Number(q.version) > Number(had.version)) accepted.set(String(q.enquiry_ref), q);
  }
  const quoteLines = await whereIn("quote_lines", "quote_id, amount_inr, cost_inr", "quote_id", [...accepted.values()].map((q) => String(q.id)));
  const quoteLinesBy = group(quoteLines, "quote_id");

  const name = new Map(people.map((p) => [String(p.id), str(p.full_name)]));
  const partnerName = new Map(partners.map((p) => [String(p.id), String(p.organisation || p.name)]));
  const consoleNo = new Map(consoles.map((c) => [String(c.id), str(c.console_no)]));
  const owedBy = new Map(owed.map((o) => [String(o.shipment_id), o]));
  const draftsBy = new Map<string, number>();
  for (const i of invoices) {
    if (i.status === "draft" && i.shipment_id && i.kind !== "proforma") draftsBy.set(String(i.shipment_id), (draftsBy.get(String(i.shipment_id)) ?? 0) + 1);
  }

  const jobs: PnlJob[] = shipments.map((s) => {
    const customer = s.customer as { name?: string | null; company?: string | null } | null;
    const enquiry = s.enquiry as { assigned_to?: string | null } | null;
    const o = owedBy.get(String(s.id));
    const q = accepted.get(String(s.enquiry_ref));
    const ql = q ? (quoteLinesBy.get(String(q.id)) ?? []) : [];
    const quotedCost = ql.some((l) => l.cost_inr != null) ? ql.reduce((n, l) => n + (Number(l.cost_inr) || 0), 0) : null;
    return {
      id: String(s.id),
      enquiryRef: str(s.enquiry_ref),
      customer: customer?.company?.trim() || customer?.name?.trim() || "—",
      mode: (s.transport_mode ?? null) as PnlJob["mode"],
      direction: (s.trade_direction ?? null) as PnlJob["direction"],
      origin: str(s.origin),
      destination: str(s.destination),
      jobDate: dayOf(s.etd) ?? dayOf(s.created_at)!,
      stage: String(s.stage),
      signedOffAt: str(s.signed_off_at),
      handledBy: enquiry?.assigned_to ? (name.get(enquiry.assigned_to) ?? null) : null,
      consoleId: str(s.console_id),
      consoleNo: s.console_id ? (consoleNo.get(String(s.console_id)) ?? null) : null,
      volumeCbm: num(s.volume_cbm),
      weightKg: num(s.gross_weight_kg),
      quotedRevenue: q ? num(q.amount_inr) : null,
      quotedCost,
      receivable: o ? Math.max(0, Number(o.billed_inr) - Number(o.collected_inr)) : 0,
      payable: o ? Math.max(0, Number(o.cost_inr) - Number(o.paid_out_inr)) : 0,
      draftInvoices: draftsBy.get(String(s.id)) ?? 0,
      disputedBills: o ? Number(o.disputed_bills) || 0 : 0,
    };
  });

  const invLinesBy = group(invoiceLines, "invoice_id");
  const billLinesBy = group(billLines, "bill_id");
  const docs: PnlDoc[] = [
    ...invoices.map(
      (i): PnlDoc => ({
        id: String(i.id),
        side: "revenue",
        kind: String(i.kind),
        number: str(i.number),
        date: dayOf(i.invoice_date) ?? dayOf(i.created_at)!,
        status: String(i.status),
        shipmentId: str(i.shipment_id),
        consoleId: str(i.console_id),
        party: str(i.bill_to_name),
        fx: 1, // invoice lines carry their own INR amount (038)
        taxableInr: Number(i.taxable_value) || 0,
        lines: (invLinesBy.get(String(i.id)) ?? []).map((l) => ({
          description: String(l.description ?? ""),
          amount: Number(l.amount_inr) || 0,
          reimbursement: Boolean(l.is_reimbursement),
        })),
      })
    ),
    ...bills.map((b): PnlDoc => {
      const fx = Number(b.exchange_rate) || 1;
      return {
        id: String(b.id),
        side: "cost",
        kind: String(b.kind),
        number: str(b.bill_no),
        date: dayOf(b.bill_date) ?? dayOf(b.created_at)!,
        status: String(b.status),
        shipmentId: str(b.shipment_id),
        consoleId: str(b.console_id),
        party: b.partner_id ? (partnerName.get(String(b.partner_id)) ?? null) : null,
        fx,
        taxableInr: (Number(b.taxable_value) || 0) * fx,
        lines: (billLinesBy.get(String(b.id)) ?? []).map((l) => ({
          description: String(l.description ?? ""),
          amount: Number(l.amount) || 0,
          reimbursement: false,
        })),
      };
    }),
  ];

  return { jobs, docs };
}
