import { supabase } from "../lib/supabase";
import { downloadWorkbook } from "../lib/xlsx";
import { inPeriod, registerWorkbook, type RegisterInput } from "../lib/enquiryRegister";
import { stageLabel, type ShipmentStage } from "./enquiries";
import { all, group, num, str, whereIn, type Row } from "./paging";

/**
 * Reading the enquiry register out of the database, and saving it as Excel.
 *
 * A handful of reads for the whole register rather than a round of them per
 * enquiry: the enquiries, then what hangs off them fetched by reference in
 * batches. The rows are shaped in src/lib/enquiryRegister.ts.
 */

const COMPANY = "Aashish Logistics Global Pvt Ltd";

/** The register's rows for a period (either end open), in no particular order. */
export async function enquiryRegister(from: string | null, to: string | null): Promise<RegisterInput[]> {
  const enquiries = await all((a, b) =>
    supabase
      .from("enquiries")
      .select(
        "ref, received_at, opened_at, status, transport_mode, trade_direction, origin, destination, incoterm, cargo_cutoff, transit_days, notes, customer:customers(name, company)"
      )
      .order("seq")
      .range(a, b)
  );

  const shells: RegisterInput[] = enquiries.map((e) => ({
    enquiry: {
      ref: String(e.ref),
      received_at: str(e.received_at),
      opened_at: String(e.opened_at),
      status: e.status as RegisterInput["enquiry"]["status"],
      transport_mode: (e.transport_mode ?? null) as RegisterInput["enquiry"]["transport_mode"],
      trade_direction: (e.trade_direction ?? null) as RegisterInput["enquiry"]["trade_direction"],
      origin: str(e.origin),
      destination: str(e.destination),
      incoterm: str(e.incoterm),
      cargo_cutoff: str(e.cargo_cutoff),
      transit_days: num(e.transit_days),
      notes: str(e.notes),
    },
    customer: (e.customer as RegisterInput["customer"]) ?? null,
    agentQuotes: [],
    routedAgent: null,
    cfsInr: null,
    shipment: null,
    stageText: null,
    nextStep: null,
    consoleNo: null,
    coloader: null,
    hawbNo: null,
  }));
  const inside = shells.filter((i) => inPeriod(i, from, to));
  const refs = inside.map((i) => i.enquiry.ref);
  if (!refs.length) return [];

  const [agentQuotes, quotes, parties, shipments] = await Promise.all([
    whereIn("partner_quotes", "enquiry_ref, partner_id, partner_label, status, amount, currency, sent_at", "enquiry_ref", refs),
    whereIn("quotes", "id, enquiry_ref, version, status", "enquiry_ref", refs),
    whereIn("enquiry_parties", "enquiry_ref, role, name, organisation", "enquiry_ref", refs),
    whereIn(
      "shipments",
      "id, enquiry_ref, stage, transport_mode, booking_number, bl_number, forwarders_bl_no, vessel, voyage, flight_number, etd, eta, cargo_cutoff, port_of_loading, port_of_discharge, direct, bl_type, console_id, routed, routed_agent_id, signed_off_at",
      "enquiry_ref",
      refs
    ),
  ]);

  // The customer's latest quotation, not one it replaced.
  const latestQuote = new Map<string, Row>();
  for (const q of quotes) {
    if (q.status === "superseded") continue;
    const had = latestQuote.get(String(q.enquiry_ref));
    if (!had || Number(q.version) > Number(had.version)) latestQuote.set(String(q.enquiry_ref), q);
  }
  const shipmentIds = shipments.map((s) => String(s.id));
  const [lines, consoles, hawbs, openSteps, agents] = await Promise.all([
    whereIn("quote_lines", "quote_id, description, charge_code, amount_inr", "quote_id", [...latestQuote.values()].map((q) => String(q.id))),
    whereIn("consoles", "id, console_no", "id", shipments.map((s) => str(s.console_id) ?? "")),
    whereIn("house_airwaybills", "shipment_id, hawb_no", "shipment_id", shipmentIds),
    whereIn("shipment_checkpoints", "shipment_id, label, position, done_at", "shipment_id", shipmentIds),
    whereIn("partners", "id, name, organisation", "id", shipments.map((s) => (s.routed === "agent" ? (str(s.routed_agent_id) ?? "") : ""))),
  ]);

  const quotesBy = group(agentQuotes, "enquiry_ref");
  const partiesBy = group(parties, "enquiry_ref");
  const shipmentBy = new Map(shipments.map((s) => [String(s.enquiry_ref), s]));
  const linesBy = group(lines, "quote_id");
  const consoleNo = new Map(consoles.map((c) => [String(c.id), str(c.console_no)]));
  const hawbBy = new Map(hawbs.map((h) => [String(h.shipment_id), str(h.hawb_no)]));
  const agentName = new Map(agents.map((p) => [String(p.id), String(p.organisation || p.name)]));
  const nextBy = new Map<string, string>();
  for (const [id, steps] of group(openSteps.filter((c) => !c.done_at), "shipment_id")) {
    const first = steps.sort((a, b) => Number(a.position) - Number(b.position))[0];
    if (first) nextBy.set(id, String(first.label));
  }

  return inside.map((i) => {
    const ref = i.enquiry.ref;
    const s = shipmentBy.get(ref);
    const q = latestQuote.get(ref);
    const cfs = (q ? (linesBy.get(String(q.id)) ?? []) : []).filter(
      (l) => /\bcfs\b/i.test(String(l.description ?? "")) || /^cfs/i.test(String(l.charge_code ?? ""))
    );
    const coloader = (partiesBy.get(ref) ?? []).find((p) => p.role === "consol_partner");
    const routedId = s?.routed === "agent" ? str(s.routed_agent_id) : null;
    return {
      ...i,
      agentQuotes: (quotesBy.get(ref) ?? []).map((a) => ({
        partner_id: str(a.partner_id),
        partner_label: String(a.partner_label ?? ""),
        status: String(a.status),
        amount: num(a.amount),
        currency: str(a.currency),
        sent_at: String(a.sent_at),
      })),
      routedAgent: routedId && agentName.has(routedId) ? { id: routedId, name: agentName.get(routedId)! } : null,
      cfsInr: cfs.length ? cfs.reduce((n, l) => n + (Number(l.amount_inr) || 0), 0) : null,
      shipment: s
        ? {
            id: String(s.id),
            transport_mode: (s.transport_mode ?? null) as RegisterInput["enquiry"]["transport_mode"],
            booking_number: str(s.booking_number),
            bl_number: str(s.bl_number),
            forwarders_bl_no: str(s.forwarders_bl_no),
            vessel: str(s.vessel),
            voyage: str(s.voyage),
            flight_number: str(s.flight_number),
            etd: str(s.etd),
            eta: str(s.eta),
            cargo_cutoff: str(s.cargo_cutoff),
            port_of_loading: str(s.port_of_loading),
            port_of_discharge: str(s.port_of_discharge),
            direct: Boolean(s.direct),
            bl_type: (s.bl_type ?? null) as "house" | "forwarder" | null,
            console_id: str(s.console_id),
            cancelled: s.stage === "cancelled",
            delivered: s.stage === "delivered",
            signed_off: Boolean(s.signed_off_at),
          }
        : null,
      stageText: s ? stageLabel(s.stage as ShipmentStage, (s.transport_mode ?? i.enquiry.transport_mode) as RegisterInput["enquiry"]["transport_mode"]) : null,
      nextStep: s ? (nextBy.get(String(s.id)) ?? null) : null,
      consoleNo: s?.console_id ? (consoleNo.get(String(s.console_id)) ?? null) : null,
      coloader: coloader ? String(coloader.organisation || coloader.name) : null,
      hawbNo: s ? (hawbBy.get(String(s.id)) ?? null) : null,
    };
  });
}

/**
 * Read the register and save it as a workbook: a summary, then inbound, in
 * process and completed on sheets of their own. Returns how many enquiries it
 * holds.
 */
export async function downloadEnquiryRegister(from: string | null, to: string | null, generatedBy: string | null): Promise<number> {
  const inputs = await enquiryRegister(from, to);
  const today = new Date().toISOString().slice(0, 10);
  const span = from || to ? `${from ?? "start"}-to-${to ?? today}` : "all";
  downloadWorkbook(`enquiry-register-${span}.xlsx`, registerWorkbook(inputs, { company: COMPANY, from, to, generatedAt: new Date(), generatedBy }));
  return inputs.length;
}
