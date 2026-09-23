import { when } from "./shipmentUpdateMail";

/**
 * The mail that gives a customer their tracking link.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CARRIES
 *
 * The link, as a button and as plain text beneath it (some mail clients strip
 * buttons, and some people copy links), and enough of the shipment that the
 * mail is useful on its own: route, status, what it is on, the dates. Only
 * what the booking holds — a line with nothing to say is left out.
 *
 * It opens as a draft in the compose window like every other outgoing mail,
 * so the desk reads it and adds what the moment needs. The reference goes in
 * the subject, in brackets, so the customer's reply files itself on the job.
 *
 * THE BUTTON
 *
 * A table cell with its own background rather than a styled link: Outlook
 * ignores padding and background on inline elements and would draw a bare
 * blue link. Following it only reads, so a mail scanner opening it first does
 * no harm.
 * ---------------------------------------------------------------------------
 */

export interface TrackingMailInput {
  ref: string;
  shipmentId: string;
  url: string;
  customerName: string | null;
  mode: string | null;
  stage: string;
  origin: string | null;
  destination: string | null;
  carrier: string | null;
  flightNumber: string | null;
  vessel: string | null;
  voyage: string | null;
  etd: string | null;
  etdTime: string | null;
  eta: string | null;
  etaTime: string | null;
  houseBill: string | null;
}

const BRAND = "#2f4f6f";
const MUTED = "#6b7280";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function trackingMailSubject(i: Pick<TrackingMailInput, "ref" | "origin" | "destination">): string {
  const route = [i.origin, i.destination].filter(Boolean).join(" to ");
  return `[${i.ref}] Track your shipment${route ? ` — ${route}` : ""}`;
}

export function trackingMailHtml(i: TrackingMailInput): string {
  const air = i.mode === "air";
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) rows.push([label, value]);
  };
  add("Our reference", `${i.ref} · ${i.shipmentId}`);
  add("Route", [i.origin, i.destination].filter(Boolean).join(" → "));
  add("Status", i.stage.charAt(0).toUpperCase() + i.stage.slice(1));
  add(air ? "Airline" : "Carrier", i.carrier);
  if (air) add("Flight", i.flightNumber);
  else add("Vessel", [i.vessel, i.voyage].filter(Boolean).join(" / "));
  add("Departure (ETD)", when(i.etd, i.etdTime));
  add("Arrival (ETA)", when(i.eta, i.etaTime));
  add(air ? "HAWB" : "House B/L", i.houseBill);

  const list = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 16px 3px 0;color:#555;white-space:nowrap;vertical-align:top">${esc(k)}</td>` +
        `<td style="padding:3px 0;color:#111">${esc(v)}</td></tr>`
    )
    .join("");

  const greeting = i.customerName ? `Dear ${esc(i.customerName)},` : "Dear Sir or Madam,";
  return (
    `<p>${greeting}</p>` +
    `<p>You can follow this shipment at any time on the page below. It shows where the cargo is, ` +
    `each step as it is completed, and the latest departure and arrival times, and it updates as the shipment moves.</p>` +
    `<table style="border-collapse:collapse;font-size:14px">${list}</table>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr>` +
    `<td style="background:${BRAND};border-radius:6px">` +
    `<a href="${esc(i.url)}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">Track this shipment</a>` +
    `</td></tr></table>` +
    `<p style="font-size:12px;color:${MUTED};margin:0 0 14px">Or open this address: <a href="${esc(i.url)}" style="color:${BRAND}">${esc(i.url)}</a><br>` +
    `No login is needed. Anyone with this link can see the shipment's progress, so please share it only with people involved in it.</p>` +
    `<p>Please keep <strong>${esc(i.ref)}</strong> in the subject line when you reply, so it reaches the right file.</p>`
  );
}
