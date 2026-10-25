import type { BookingExtras } from "../lib/documents/data";
import { chargeHead, usualGst } from "../lib/documents/charges";
import type { ChargeLine, ContainerLine } from "../lib/documents/types";
import type { HblContainer, HblData } from "../lib/hbl";
import { getConsole } from "./consoles";
import { customsFor } from "./customs";
import { quotesFor, type Shipment } from "./enquiries";
import { getHbl } from "./hbl";
import { issuedTaxInvoiceNumber } from "./invoiceNumbers";
import { linesFor, type QuoteLine } from "./quoteLines";
import { getReceivedHbl } from "./receivedHbl";
import { listShipmentContainers } from "./shipmentContainers";
import { extraPartiesFor } from "./shipmentExtras";

/**
 * What the shipment's documents print besides its own row (lib/documents/data
 * BookingExtras), read together for the Documents tab.
 *
 * ---------------------------------------------------------------------------
 * THE CHARGES ARE THE ACCEPTED QUOTATION'S
 *
 * The tax invoice and the proforma bill what the customer accepted (the user,
 * 25 Oct 2026): the latest accepted quotation's lines, each in its currency at
 * the rate of exchange it was quoted at, with the GST it was quoted with — or,
 * where none was stated, the usual rate (5% on freight and its surcharges, 18%
 * on the rest), as the manual invoice starts. With no accepted quotation the
 * invoice is the one agreed freight figure, as before.
 *
 * THE BILLS ARE READ IN
 *
 * The house B/L the job travels under gives the arrival notice and the DO
 * what the job's own row does not: the agent's, as Gemini read it from their
 * PDF and the desk confirmed it (088) — its date, its release, where it
 * delivers, its boxes with their seals — and our DO's date and validity, set
 * when the DO is issued from the Bill tab; or our own (123). The console
 * gives the master's date.
 *
 * Each read stands alone: a job whose customs record cannot be read still
 * prints its invoice, with the IGM line left out.
 * ---------------------------------------------------------------------------
 */
export async function documentExtras(s: Shipment): Promise<BookingExtras> {
  const soft = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const house = s.bl_type === "forwarder" && s.forwarders_bl_no ? s.forwarders_bl_no : s.bl_number;
  const [quotes, customs, parties, boxes, consol, number, received, ours] = await Promise.all([
    soft(quotesFor(s.enquiry_ref), []),
    soft(customsFor(s.id), []),
    soft(extraPartiesFor(s.id), []),
    soft(listShipmentContainers(s.id), []),
    s.console_id ? soft(getConsole(s.console_id), null) : Promise.resolve(null),
    house ? soft(issuedTaxInvoiceNumber(house), null) : Promise.resolve(null),
    soft(getReceivedHbl(s.id), null),
    soft(getHbl(s.id), null),
  ]);
  // The bill it travels under: the agent's, unless the job says it is ours (Bill tab).
  const theirs = s.bl_type !== "house" && received ? received : null;
  const bill: HblData | null = theirs?.data ?? ours?.data ?? null;
  const accepted = quotes.filter((q) => q.status === "accepted").sort((a, b) => b.version - a.version)[0];
  const lines = accepted ? await soft(linesFor(accepted.id), []) : [];

  const igm = customs.find((c) => c.side === "import" && c.igm_number) ?? customs.find((c) => c.igm_number);
  const party = (role: string) => parties.find((p) => p.role === role);
  const customer = party("destination_agent");
  const text = (v: string | null | undefined) => v?.trim() || undefined;

  return {
    charges: lines.length ? lines.map(chargeOf) : undefined,
    exchangeRates: lines.length ? ratesOf(lines) : undefined,
    igm: igm
      ? { number: text(igm.igm_number), date: text(igm.igm_date), item: text(igm.igm_item), subItem: text(igm.igm_subline) }
      : consol?.igm_no
        ? { number: text(consol.igm_no), date: text(consol.igm_date) }
        : undefined,
    vessel: text(consol?.vessel),
    voyage: text(consol?.voyage),
    cfsName: text(consol?.cfs_name),
    unstuffDate: text(consol?.destuffed_on),
    masterDate: text(consol?.mbl_date),
    bill: bill
      ? {
          date: text(bill.date_of_issue) ?? text(ours && !theirs ? ours.issued_at?.slice(0, 10) : null),
          releaseMode: (theirs ?? ours)?.release_mode,
          placeOfDelivery: text(bill.place_of_delivery) ?? text(bill.final_destination) ?? text(consol?.place_of_delivery),
          doIssuedOn: text(theirs?.do_issued_on),
          doValidUntil: text(theirs?.do_valid_until),
        }
      : undefined,
    originAgent: text(party("origin_agent")?.name) ?? text(theirs?.issuer_name),
    chaName: text(party("customs_house_agent")?.name),
    customerParty: customer?.name
      ? {
          name: customer.name,
          address: [customer.address, customer.city, customer.country].map(text).filter(Boolean).join(", ") || undefined,
          gstin: text(customer.gstin),
        }
      : undefined,
    // The job's boxes (032); without any, the bill's, as it was read in.
    containers: boxes.length
      ? boxes.map(
          (b): ContainerLine => ({
            containerId: text(b.container_no),
            containerType: text(b.size_type),
            sealNumber: text(b.seal_no),
            packageCount: b.package_count ?? undefined,
            packageType: text(b.package_type),
            grossWeightKg: b.weight_kg ?? undefined,
            volumeCbm: b.volume_cbm ?? undefined,
          })
        )
      : (bill?.containers ?? []).map(boxOfBill),
    invoiceNumber: number ?? undefined,
  };
}

/** A box as a bill lists it, its figures typed as text. */
function boxOfBill(c: HblContainer): ContainerLine {
  const n = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    containerId: c.container_no.trim() || undefined,
    containerType: c.size_type.trim() || undefined,
    sealNumber: c.seal_no.trim() || undefined,
    packageCount: n(c.packages),
    packageType: c.package_type.trim() || undefined,
    grossWeightKg: n(c.gross_kg),
    volumeCbm: n(c.cbm),
  };
}

/** A quotation line as the invoice prints it. */
function chargeOf(l: QuoteLine): ChargeLine {
  const h = chargeHead(l.description);
  // Billed at its minimum where the rate came to less: the line as it was quoted, one at the minimum.
  const minimum = l.amount > l.rate * l.quantity + 0.005;
  return {
    charge: l.description,
    sac: l.sac_code?.trim() || h?.sac,
    basis: minimum ? "Minimum" : l.unit?.trim() || h?.basis,
    quantity: minimum ? 1 : l.quantity,
    currency: (l.currency || "INR").toUpperCase(),
    rate: minimum ? l.amount : l.rate,
    // As quoted (0 is none); not stated, the usual rate for the charge, a freight group's being freight's.
    gstPercent: l.gst_rate ?? (h ? usualGst(h) : l.section === "freight" ? 5 : 18),
  };
}

/** Each foreign currency at the rate of exchange its lines were quoted at. */
function ratesOf(lines: QuoteLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    const c = (l.currency || "INR").toUpperCase();
    if (c !== "INR" && !(c in out) && l.fx_rate > 0) out[c] = l.fx_rate;
  }
  return out;
}
