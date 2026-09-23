/**
 * The mail a party gets when the desk notifies them about a shipment.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT SAYS AND WHAT IT DOES NOT
 *
 * Only what the booking actually holds: where the cargo is, what it is on,
 * when it leaves and arrives, and the latest step the desk has recorded. A
 * field we do not hold is not a line — "Vessel: TBA" invites the reader to
 * wait for something nobody has promised. It goes out as a draft in the
 * compose window, so the desk reads it and adds whatever the moment needs.
 *
 * The reference goes in the subject in brackets, where a reply-all cannot lose
 * it, so the party's answer files itself against the job.
 * ---------------------------------------------------------------------------
 */

export interface UpdateInput {
  ref: string;
  shipmentId: string;
  partyName: string | null;
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
  portOfLoading: string | null;
  portOfDischarge: string | null;
  houseBill: string | null;
  pieces: number | null;
  grossKg: number | null;
  volumeCbm: number | null;
  /** The most recent step the desk marked done, and when. */
  latest: { label: string; at: string } | null;
  /** The next open step. */
  next: string | null;
}

export function shipmentUpdateSubject(i: Pick<UpdateInput, "ref" | "origin" | "destination">): string {
  const route = [i.origin, i.destination].filter(Boolean).join(" to ");
  return `[${i.ref}] Shipment update${route ? ` — ${route}` : ""}`;
}

/** "18 Sep 2026", "18 Sep 2026, 14:30". */
export function when(date: string | null, time?: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return time ? `${day}, ${time.slice(0, 5)}` : day;
}

export function shipmentUpdateHtml(i: UpdateInput): string {
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && String(value).trim() !== "")
      rows.push([label, String(value)]);
  };

  const air = i.mode === "air";
  add("Our reference", `${i.ref} · ${i.shipmentId}`);
  add("Route", [i.origin, i.destination].filter(Boolean).join(" → "));
  add("Status", i.stage);
  if (i.latest) add("Latest", `${i.latest.label} — ${when(i.latest.at.slice(0, 10))}`);
  add("Next", i.next);
  add(air ? "Airline" : "Carrier", i.carrier);
  if (air) add("Flight", i.flightNumber);
  else add("Vessel", [i.vessel, i.voyage].filter(Boolean).join(" / "));
  add(air ? "Airport of loading" : "Port of loading", i.portOfLoading);
  add(air ? "Airport of discharge" : "Port of discharge", i.portOfDischarge);
  add("ETD", when(i.etd, i.etdTime));
  add("ETA", when(i.eta, i.etaTime));
  add(air ? "HAWB" : "House B/L", i.houseBill);
  add(
    "Cargo",
    [
      i.pieces ? `${i.pieces} pcs` : null,
      i.grossKg ? `${Number(i.grossKg).toLocaleString("en-IN")} kg` : null,
      i.volumeCbm ? `${i.volumeCbm} CBM` : null,
    ]
      .filter(Boolean)
      .join(" · ")
  );

  const greeting = i.partyName ? `Dear ${esc(i.partyName)},` : "Dear Sir or Madam,";
  const list = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 16px 3px 0;color:#555;white-space:nowrap;vertical-align:top">${esc(
          k
        )}</td><td style="padding:3px 0;color:#111">${esc(v)}</td></tr>`
    )
    .join("");

  return (
    `<p>${greeting}</p>` +
    `<p>Please find the latest on this shipment below.</p>` +
    `<table style="border-collapse:collapse;font-size:14px">${list}</table>` +
    `<p>Please keep <strong>${esc(i.ref)}</strong> in the subject line when you reply, so it reaches the right file.</p>`
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
