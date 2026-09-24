import { when } from "./shipmentUpdateMail";

/**
 * The pre-alert: what the destination agent needs before the cargo lands.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CARRIES
 *
 * The bills first — MAWB and HAWB, or master and house B/L — because that is
 * what the agent files the arrival under. Then the carriage (flight or vessel,
 * departure and arrival), the parties, the cargo, the terms, and anything
 * the agent must act on: dangerous goods, a door delivery, freight to
 * collect. Only what the job holds: a line with nothing to say is left out
 * rather than printed as "TBA", which an agent reads as "somebody will tell
 * me later" and waits.
 *
 * The documents go as attachments on the same mail. The reference is in the
 * subject in brackets so the agent's reply files itself on the job.
 * ---------------------------------------------------------------------------
 */

export interface PreAlertInput {
  ref: string;
  shipmentId: string;
  agentName: string | null;
  mode: string | null;
  masterBill: string | null;
  houseBill: string | null;
  carrier: string | null;
  flightNumber: string | null;
  vessel: string | null;
  voyage: string | null;
  etd: string | null;
  etdTime: string | null;
  eta: string | null;
  etaTime: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  finalDestination: string | null;
  shipper: string | null;
  consignee: string | null;
  notify: string | null;
  containers: string[];
  pieces: number | null;
  packageType: string | null;
  grossKg: number | null;
  chargeableKg: number | null;
  volumeCbm: number | null;
  commodity: string | null;
  hsCode: string | null;
  marks: string | null;
  incoterm: string | null;
  freightTerms: "prepaid" | "collect" | null;
  unNumber: string | null;
  imoClass: string | null;
  deliveryTo: string | null;
  shippingBill: string | null;
  /** The file names attached, listed in the body so a stripped attachment is noticed. */
  attachmentNames: string[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function preAlertSubject(i: PreAlertInput): string {
  const air = i.mode === "air";
  const bills = [i.houseBill && `${air ? "HAWB" : "HBL"} ${i.houseBill}`, i.masterBill && `${air ? "MAWB" : "MBL"} ${i.masterBill}`].filter(Boolean).join(" / ");
  const carriage = air ? i.flightNumber : [i.vessel, i.voyage].filter(Boolean).join(" ");
  const route = [code(i.portOfLoading), code(i.portOfDischarge)].filter(Boolean).join("-");
  return [`[${i.ref}] PRE-ALERT`, bills, [carriage, i.etd && when(i.etd)?.replace(/ \d{4}$/, ""), route].filter(Boolean).join(" ")].filter(Boolean).join(" — ");
}

/** "Chennai (MAA)" → MAA; a place without a code stays as written. */
function code(place: string | null): string | null {
  if (!place) return null;
  return /\(([A-Z]{3,5})\)/.exec(place)?.[1] ?? place.split(/[,/]/)[0].trim();
}

export function preAlertHtml(i: PreAlertInput): string {
  const air = i.mode === "air";
  const sections: Array<{ title: string; rows: Array<[string, string]> }> = [];
  const section = (title: string, rows: Array<[string, string | number | null | undefined]>) => {
    const kept = rows.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "").map(([k, v]) => [k, String(v)] as [string, string]);
    if (kept.length) sections.push({ title, rows: kept });
  };
  const kg = (n: number | null) => (n ? `${Number(n).toLocaleString("en-IN")} kg` : null);

  section("Bills", [
    [air ? "MAWB" : "Master B/L", i.masterBill],
    [air ? "HAWB" : "House B/L", i.houseBill],
    ["Our reference", `${i.ref} · ${i.shipmentId}`],
  ]);
  section("Carriage", [
    [air ? "Airline" : "Carrier", i.carrier],
    [air ? "Flight" : "Vessel / voyage", air ? i.flightNumber : [i.vessel, i.voyage].filter(Boolean).join(" / ")],
    [air ? "Airport of departure" : "Port of loading", i.portOfLoading],
    [air ? "Airport of destination" : "Port of discharge", i.portOfDischarge],
    ["Final destination", i.finalDestination && i.finalDestination !== i.portOfDischarge ? i.finalDestination : null],
    ["Departure (ETD)", when(i.etd, i.etdTime)],
    ["Arrival (ETA)", when(i.eta, i.etaTime)],
    [i.containers.length > 1 ? "Containers" : "Container", i.containers.join(", ")],
  ]);
  section("Parties", [
    ["Shipper", i.shipper],
    ["Consignee", i.consignee],
    ["Notify", i.notify],
  ]);
  section("Cargo", [
    ["Pieces", i.pieces ? `${i.pieces}${i.packageType ? ` ${i.packageType}` : ""}` : null],
    ["Gross weight", kg(i.grossKg)],
    ["Chargeable weight", air ? kg(i.chargeableKg) : null],
    ["Volume", i.volumeCbm ? `${i.volumeCbm} CBM` : null],
    ["Commodity", i.commodity],
    ["HS code", i.hsCode],
    ["Marks & numbers", i.marks],
  ]);
  section("Terms", [
    ["Incoterm", i.incoterm],
    ["Freight", i.freightTerms === "collect" ? "COLLECT — please collect from the consignee" : i.freightTerms === "prepaid" ? "Prepaid" : null],
    ["Export shipping bill", i.shippingBill],
  ]);

  const actions: string[] = [];
  if (i.unNumber) actions.push(`Dangerous goods: ${i.unNumber.toUpperCase()}${i.imoClass ? `, class ${i.imoClass}` : ""}. The shipper's declaration is attached where filed.`);
  if (i.deliveryTo) actions.push(`Door delivery required to: ${i.deliveryTo}`);
  if (i.freightTerms === "collect") actions.push("Freight is collect: please release against payment.");

  const table = (rows: Array<[string, string]>) =>
    `<table style="border-collapse:collapse;font-size:14px;margin:0 0 12px">${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:3px 16px 3px 0;color:#555;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:3px 0;color:#111">${esc(v).replace(/\n/g, "<br>")}</td></tr>`
      )
      .join("")}</table>`;

  return (
    `<p>${i.agentName ? `Dear ${esc(i.agentName)},` : "Dear Partner,"}</p>` +
    `<p>Please find the pre-alert for the shipment below${i.attachmentNames.length ? ", with its documents attached" : ""}. Kindly acknowledge and advise the arrival notice and clearance on arrival.</p>` +
    sections.map((s) => `<p style="margin:14px 0 4px;font-weight:600">${esc(s.title)}</p>${table(s.rows)}`).join("") +
    (actions.length ? `<p style="margin:14px 0 4px;font-weight:600">Please note</p><ul>${actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : "") +
    (i.attachmentNames.length ? `<p style="margin:14px 0 4px;font-weight:600">Attached</p><ul>${i.attachmentNames.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "") +
    `<p>Please keep <strong>${esc(i.ref)}</strong> in the subject line when you reply, so it reaches the right file.</p>`
  );
}

/** The job's documents an agent needs, by type, in the order they are listed. */
export const PRE_ALERT_DOCUMENTS = [
  "HAWB",
  "House B/L",
  "MAWB",
  "Master B/L",
  "Commercial invoice",
  "Packing list",
  "Shipping bill",
  "Certificate of origin",
  "Insurance certificate",
  "DG declaration",
  "MSDS",
];
