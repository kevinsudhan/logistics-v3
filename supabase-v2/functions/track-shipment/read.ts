/**
 * What each tracker says, read into one shape — without fetching anything.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SEPARATE FROM index.ts
 *
 * Everything here is a pure function of a provider's answer and the booking,
 * so the tests run it on recorded answers with no key and no network. The
 * edge function does the fetching and the writing; this decides what an
 * answer means.
 *
 * THE ONE RULE: EVIDENCE ABOUT THIS CARGO TICKS, EVIDENCE ABOUT A VEHICLE ASKS
 *
 * A container event from the carrier is about our box: "loaded on MSC AURORA
 * at Chennai" is the cargo sailing. Those tick their step without asking
 * (`auto`). A flight taking off is about an aircraft — cargo is offloaded
 * often enough that "EK 543 departed" does not prove ours was on it — so a
 * flight event is offered for one click instead. A vessel's position is about
 * a ship and ticks nothing at all.
 *
 * WHICH DAY'S FLIGHT
 *
 * A flight number flies every day. Nothing here is attached to a booking
 * unless the booking's ETD says which day; without one the answer is shown
 * and nothing is suggested.
 * ---------------------------------------------------------------------------
 */

export type Kind =
  | "cargo_received"
  | "stuffed"
  | "gate_in"
  | "loaded"
  | "departed"
  | "in_transit"
  | "arrived"
  | "discharged"
  | "customs_cleared"
  | "gate_out"
  | "out_for_delivery"
  | "delivered"
  | "delayed"
  | "rolled_over"
  | "schedule_changed"
  | "cancelled"
  | "other";

export interface TrackEvent {
  kind: Kind;
  /** When it happened, ISO in UTC. Null when the source gave no time. */
  occurred_at: string | null;
  /** A plan or an estimate, not something that happened. Never ticks. */
  estimated: boolean;
  location: string | null;
  /** One line a person reads: "EK 543 took off from Chennai at 03:10". */
  detail: string;
  /** The source's own identity for this event, so a refresh never adds it twice. */
  external_id: string;
  /** Ticks its step without asking. Only for evidence about this cargo. */
  auto: boolean;
  /** "new" asks a person; "info" is a line on the timeline and nothing more. */
  status: "new" | "info";
}

export interface Reading {
  state: "ok" | "not_found" | "error";
  message: string;
  summary: Record<string, unknown>;
  events: TrackEvent[];
}

/** The booking, as much of it as tracking reads. */
export interface Booking {
  transport_mode: string | null;
  flight_number: string | null;
  carrier: string | null;
  etd: string | null;
  eta: string | null;
  port_of_loading: string | null;
  port_of_discharge: string | null;
  origin: string | null;
  destination: string | null;
  vessel: string | null;
  container_number: string | null;
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

export interface Flight {
  airline: string;
  number: string;
  /** The airline code is ICAO (UAE), not IATA (EK). */
  icao: boolean;
}

/** "EK 543", "EK0543", "ek-543", "6E 1234", "UAE543". Null if it is none of those. */
export function parseFlight(raw: string | null | undefined): Flight | null {
  const s = (raw ?? "").toUpperCase().replace(/[\s\-.]/g, "");
  let m = /^([A-Z]{3})(\d{1,4})([A-Z]?)$/.exec(s);
  if (m) return { airline: m[1], number: `${Number(m[2])}${m[3]}`, icao: true };
  // IATA codes are two characters and may carry one digit: 6E, 9W, G9.
  m = /^([A-Z0-9]{2})(\d{1,4})([A-Z]?)$/.exec(s);
  if (m && /[A-Z]/.test(m[1])) return { airline: m[1], number: `${Number(m[2])}${m[3]}`, icao: false };
  return null;
}

export const flightName = (f: Flight) => `${f.airline} ${f.number}`;

/**
 * IATA to ICAO airline codes, for the callsign an aircraft broadcasts.
 *
 * The carriers this desk books on and the ones on its lanes. A flight whose
 * airline is not here can be entered by its ICAO callsign (UAE543) instead.
 */
export const IATA_TO_ICAO: Record<string, string> = {
  EK: "UAE", QR: "QTR", EY: "ETD", FZ: "FDB", G9: "ABY", WY: "OMA", GF: "GFA", KU: "KAC", SV: "SVA",
  RJ: "RJA", MS: "MSR", ET: "ETH", KQ: "KQA", J9: "JZR",
  AI: "AIC", IX: "AXB", "6E": "IGO", SG: "SEJ", UK: "VTI", QP: "AKJ", I5: "IAD",
  UL: "ALK", BG: "BBC", PK: "PIA",
  SQ: "SIA", TR: "TGW", MH: "MAS", TG: "THA", CX: "CPA", VN: "HVN", GA: "GIA", PR: "PAL",
  CZ: "CSN", CA: "CCA", MU: "CES", KE: "KAL", OZ: "AAR", NH: "ANA", JL: "JAL", BR: "EVA", CI: "CAL",
  LH: "DLH", LX: "SWR", OS: "AUA", BA: "BAW", VS: "VIR", AF: "AFR", KL: "KLM", TK: "THY", AY: "FIN",
  SK: "SAS", IB: "IBE", AZ: "ITY", LO: "LOT",
  AA: "AAL", UA: "UAL", DL: "DAL", AC: "ACA", QF: "QFA", NZ: "ANZ",
  // Freighter operators
  CV: "CLX", "5X": "UPS", FX: "FDX", QY: "BCS", D0: "DHK", LD: "AHK", PO: "PAC", K4: "CKS",
  "3S": "BOX", RU: "ABW", BZ: "BDA",
};

export function callsignFor(f: Flight): string | null {
  if (f.icao) return `${f.airline}${f.number}`;
  const icao = IATA_TO_ICAO[f.airline];
  return icao ? `${icao}${f.number}` : null;
}

/** AeroDataBox writes "2026-10-02 09:30Z" and "2026-10-02 15:00+05:30". */
export function adbTime(t: { utc?: string; local?: string } | null | undefined): string | null {
  const raw = t?.utc ?? t?.local;
  if (!raw) return null;
  const d = new Date(raw.trim().replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Times are not written into a line: the page shows when, in the reader's clock.

interface AdbMovement {
  airport?: { iata?: string; icao?: string; name?: string; municipalityName?: string };
  scheduledTime?: { utc?: string; local?: string };
  revisedTime?: { utc?: string; local?: string };
  predictedTime?: { utc?: string; local?: string };
  runwayTime?: { utc?: string; local?: string };
}
interface AdbFlight {
  number?: string;
  status?: string;
  callSign?: string;
  isCargo?: boolean;
  departure?: AdbMovement;
  arrival?: AdbMovement;
  lastUpdatedUtc?: string;
  location?: { lat?: number; lon?: number; altitude?: { meter?: number }; groundSpeed?: { kmPerHour?: number }; trueTrack?: { deg?: number }; reportedAtUtc?: string };
}

const airportName = (m?: AdbMovement) =>
  m?.airport ? [m.airport.municipalityName ?? m.airport.name, m.airport.iata].filter(Boolean).join(" ") : null;

/**
 * AeroDataBox: the status of one flight on one day.
 *
 * Asked by flight number AND the booked date, so there is no guessing which
 * day's flight came back. A runway time is the take-off or the landing
 * itself; a revised time is the gate time as it happened or as now expected,
 * and counts as happened only once the status says so.
 */
export function readAeroDataBox(body: unknown, booking: Booking): Reading {
  const flights = (Array.isArray(body) ? body : []) as AdbFlight[];
  // A multi-leg flight comes back once per leg; ours is the one leaving our airport.
  const f =
    flights.find((x) =>
      samePlace([booking.port_of_loading, booking.origin], x.departure?.airport?.municipalityName ?? x.departure?.airport?.name ?? null, x.departure?.airport?.iata ?? null)
    ) ?? flights[0];
  const name = parseFlight(booking.flight_number);
  const label = name ? flightName(name) : (booking.flight_number ?? "the flight");
  if (!f) {
    return { state: "not_found", message: `AeroDataBox has no ${label} on ${booking.etd}.`, summary: {}, events: [] };
  }

  const status = f.status ?? "Unknown";
  const depRunway = adbTime(f.departure?.runwayTime);
  const arrRunway = adbTime(f.arrival?.runwayTime);
  const departedStatuses = ["Departed", "EnRoute", "Approaching", "Arrived", "Diverted"];
  const tookOff = departedStatuses.includes(status);
  const landed = status === "Arrived";
  const depAt = depRunway ?? (tookOff ? adbTime(f.departure?.revisedTime) : null);
  const arrAt = arrRunway ?? (landed ? adbTime(f.arrival?.revisedTime) : null);
  const from = airportName(f.departure);
  const to = airportName(f.arrival);
  // A connection (Chennai to Dubai, for Frankfurt) lands somewhere that is not
  // our destination: that landing is not the cargo arriving, and its time is
  // not the booking's ETA. Without a destination on the booking, it cannot be told.
  const endsHere =
    !booking.port_of_discharge && !booking.destination
      ? true
      : samePlace(
          [booking.port_of_discharge, booking.destination],
          f.arrival?.airport?.municipalityName ?? f.arrival?.airport?.name ?? null,
          f.arrival?.airport?.iata ?? null
        );
  const key = `${(f.number ?? label).replace(/\s/g, "")}:${booking.etd}`;

  const summary: Record<string, unknown> = {
    flight: f.number ?? label,
    status,
    callsign: f.callSign ?? null,
    from,
    to,
    dep_scheduled: adbTime(f.departure?.scheduledTime),
    dep_revised: adbTime(f.departure?.revisedTime),
    dep_actual: depAt,
    arr_scheduled: adbTime(f.arrival?.scheduledTime),
    arr_expected: landed ? null : (adbTime(f.arrival?.predictedTime) ?? adbTime(f.arrival?.revisedTime)),
    // The arrival day at the destination's own clock, which is what a booking's ETA means.
    eta_local: endsHere
      ? (f.arrival?.predictedTime?.local ?? f.arrival?.revisedTime?.local ?? f.arrival?.scheduledTime?.local ?? "").slice(0, 10) || null
      : null,
    connection: !endsHere,
    arr_actual: arrAt,
    lat: f.location?.lat ?? null,
    lon: f.location?.lon ?? null,
    altitude_m: f.location?.altitude?.meter ?? null,
    speed_kmh: f.location?.groundSpeed?.kmPerHour ?? null,
    heading: f.location?.trueTrack?.deg ?? null,
    position_at: f.location?.reportedAtUtc ? adbTime({ utc: f.location.reportedAtUtc }) : null,
  };

  const events: TrackEvent[] = [];
  if (tookOff) {
    events.push({
      kind: "departed",
      occurred_at: depAt,
      estimated: false,
      location: from,
      detail: `${summary.flight} took off from ${from ?? "origin"}`,
      external_id: `adb:departed:${key}`,
      auto: false,
      status: "new",
    });
  }
  if (landed) {
    events.push({
      kind: endsHere ? "arrived" : "in_transit",
      occurred_at: arrAt,
      estimated: false,
      location: to,
      detail: `${summary.flight} landed at ${to ?? "destination"}${endsHere ? "" : " (connection)"}`,
      external_id: `adb:arrived:${key}`,
      auto: false,
      status: endsHere ? "new" : "info",
    });
  }
  if (status === "Diverted") {
    events.push({
      kind: "other",
      occurred_at: null,
      estimated: false,
      location: to,
      detail: `${summary.flight} was diverted`,
      external_id: `adb:diverted:${key}`,
      auto: false,
      status: "new",
    });
  }
  if (status === "Canceled" || status === "CanceledUncertain") {
    events.push({
      kind: "cancelled",
      occurred_at: null,
      estimated: status === "CanceledUncertain",
      location: from,
      detail: `${summary.flight} on ${booking.etd} is ${status === "Canceled" ? "cancelled" : "possibly cancelled"}`,
      external_id: `adb:cancelled:${key}`,
      auto: false,
      status: "new",
    });
  }
  if (status === "Delayed") {
    const rev = adbTime(f.departure?.revisedTime);
    events.push({
      kind: "delayed",
      occurred_at: null,
      estimated: true,
      location: from,
      // The airport's own clock, as the airline announces it.
      detail: `${summary.flight} is delayed${f.departure?.revisedTime?.local ? ` — now leaving ${f.departure.revisedTime.local.slice(11, 16)} local time` : ""}`,
      external_id: `adb:delayed:${key}:${rev ?? ""}`,
      auto: false,
      status: "info",
    });
  }

  const words: Record<string, string> = {
    Expected: "scheduled",
    EnRoute: "in the air",
    CheckIn: "checking in",
    Boarding: "boarding",
    GateClosed: "gate closed",
    Departed: "departed",
    Delayed: "delayed",
    Approaching: "approaching",
    Arrived: "landed",
    Canceled: "cancelled",
    Diverted: "diverted",
  };
  return { state: "ok", message: `${summary.flight} is ${words[status] ?? "status unknown"}.`, summary, events };
}

/**
 * adsb.lol: where an aircraft is right now, by the callsign it broadcasts.
 *
 * An open-data ADS-B network (ODbL — the page credits it), free and keyless.
 * It only knows aircraft its receivers hear, so "not found" usually means
 * "not flying at this moment". A sighting inside the booked day is offered
 * as "departed" — marked as a sighting, because the take-off itself happened
 * before it was seen.
 *
 * THE CALLSIGN IS NOT ALWAYS THE FLIGHT NUMBER
 *
 * Emirates flies EK 543 as UAE543, but Air India flies as AIC9DK and IndiGo
 * often as IGO28F. The airline's real callsign comes from AeroDataBox when
 * that key is connected; without it the callsign is built from the flight
 * number (`guessed`), and a miss says so rather than "not flying".
 *
 * (OpenSky was the first choice and is not used: it refuses requests from
 * cloud servers, which is where this runs, and browsers are not allowed to
 * read it from another site.)
 */
export function readAdsb(body: unknown, callsign: string, guessed: boolean, booking: Booking, now: Date): Reading {
  interface Ac {
    hex?: string;
    flight?: string;
    lat?: number;
    lon?: number;
    alt_baro?: number | "ground";
    alt_geom?: number;
    gs?: number;
    track?: number;
    seen_pos?: number;
    r?: string;
    t?: string;
  }
  const b = body as { ac?: Ac[]; now?: number };
  const row = (b?.ac ?? []).find((a) => (a.flight ?? "").trim().toUpperCase() === callsign && typeof a.lat === "number");
  if (!row) {
    return {
      state: "not_found",
      message: guessed
        ? `Not seen in the air as ${callsign}. Either it is not flying now, or the airline broadcasts another callsign — connect AeroDataBox to use the real one.`
        : `${callsign} is not in the air right now.`,
      summary: { callsign, guessed },
      events: [],
    };
  }
  const onGround = row.alt_baro === "ground";
  const seenAt = new Date((b.now ?? now.getTime()) - (row.seen_pos ?? 0) * 1000).toISOString();
  const feet = typeof row.alt_baro === "number" ? row.alt_baro : (row.alt_geom ?? null);
  const summary = {
    callsign,
    guessed,
    hex: row.hex ?? null,
    registration: row.r ?? null,
    aircraft: row.t ?? null,
    lat: row.lat!,
    lon: row.lon!,
    altitude_m: feet !== null ? Math.round(feet * 0.3048) : null,
    speed_kmh: typeof row.gs === "number" ? Math.round(row.gs * 1.852) : null,
    heading: row.track ?? null,
    on_ground: onGround,
    position_at: seenAt,
  };

  const events: TrackEvent[] = [];
  const inWindow = booking.etd ? withinDays(now, booking.etd, -0.5, 2) : false;
  if (!onGround && inWindow) {
    events.push({
      kind: "departed",
      occurred_at: seenAt,
      estimated: false,
      location: null,
      detail: `${callsign} seen in the air`,
      external_id: `adsb:airborne:${callsign}:${booking.etd}`,
      auto: false,
      status: "new",
    });
  }
  const message = onGround
    ? `${callsign} is on the ground.`
    : !booking.etd
      ? `${callsign} is in the air. The booking has no ETD, so this may not be our day's flight.`
      : inWindow
        ? `${callsign} is in the air.`
        : `${callsign} is in the air, but this booking flies on ${booking.etd} — this is another day's flight.`;
  return { state: "ok", message, summary, events };
}

/** Is `now` within [date + from days, date + to days]? Dates are whole days, UTC. */
export function withinDays(now: Date, date: string, from: number, to: number): boolean {
  const d = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d)) return false;
  const t = now.getTime();
  return t >= d + from * 86_400_000 && t <= d + (to + 1) * 86_400_000;
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

/** Words that start port names without naming the place: "Port Klang", "Puerto Cortes". */
const GENERIC = new Set(["port", "puerto", "porto", "pelabuhan", "the", "new"]);

/** The word that names the place: "chennai" out of "Chennai (MAA), India". Same idea as src/lib/schedules. */
export function placeKey(s: string | null | undefined): string {
  const words = (s ?? "").toLowerCase().replace(/\(.*?\)/g, " ").split(/[\s,/-]+/).filter(Boolean);
  return words.find((w) => !GENERIC.has(w)) ?? "";
}

/** Is a carrier's location the same place as one of ours? By UN/LOCODE or by name. */
export function samePlace(ours: Array<string | null>, name: string | null, locode: string | null): boolean {
  return ours.some((o) => {
    if (!o) return false;
    const low = o.toLowerCase();
    if (locode && new RegExp(`\\b${locode.toLowerCase()}\\b`).test(low)) return true;
    const theirs = placeKey(name);
    const mine = placeKey(o);
    return Boolean(theirs && mine && (low.includes(theirs) || (name ?? "").toLowerCase().includes(mine)));
  });
}

// ---------------------------------------------------------------------------
// Containers: the DCSA Track & Trace standard
// ---------------------------------------------------------------------------

interface DcsaLocation {
  locationName?: string;
  UNLocationCode?: string;
}
interface DcsaEvent {
  eventID?: string;
  eventType?: "EQUIPMENT" | "TRANSPORT" | "SHIPMENT";
  eventClassifierCode?: "ACT" | "PLN" | "EST";
  eventDateTime?: string;
  equipmentEventTypeCode?: string;
  transportEventTypeCode?: string;
  emptyIndicatorCode?: "EMPTY" | "LADEN";
  equipmentReference?: string;
  eventLocation?: DcsaLocation;
  transportCall?: {
    UNLocationCode?: string;
    location?: DcsaLocation;
    modeOfTransport?: string;
    exportVoyageNumber?: string;
    vessel?: { vesselName?: string; vesselIMONumber?: string };
  };
}

const where = (e: DcsaEvent) =>
  e.eventLocation?.locationName ?? e.transportCall?.location?.locationName ?? null;
const locode = (e: DcsaEvent) =>
  e.eventLocation?.UNLocationCode ?? e.transportCall?.UNLocationCode ?? e.transportCall?.location?.UNLocationCode ?? null;
const placeText = (e: DcsaEvent) => where(e) ?? locode(e);

/**
 * A carrier's container events (Hapag-Lloyd publishes the DCSA standard; other
 * lines that do can be read by the same function).
 *
 * What ticks: the laden gate-in at origin (FCL), the first vessel departure,
 * and the discharge or vessel arrival at OUR port of discharge. A discharge
 * anywhere else is a transhipment and goes on the timeline only. Planned and
 * estimated events tick nothing; the latest estimate for our port is the
 * carrier's ETA.
 */
export function readDcsa(body: unknown, booking: Booking, carrier = "Hapag-Lloyd"): Reading {
  if (!Array.isArray(body)) {
    return { state: "error", message: `${carrier} sent something that is not a list of events.`, summary: {}, events: [] };
  }
  const all = (body as DcsaEvent[])
    .filter((e) => e.eventDateTime && e.eventType !== "SHIPMENT")
    .sort((a, b) => Date.parse(a.eventDateTime!) - Date.parse(b.eventDateTime!));
  const ref = booking.container_number ?? "this booking";
  if (!all.length) {
    return { state: "not_found", message: `${carrier} has no container events for ${ref} yet.`, summary: {}, events: [] };
  }

  const pod = [booking.port_of_discharge, booking.destination];
  const acts = all.filter((e) => e.eventClassifierCode === "ACT");
  const ext = (e: DcsaEvent) =>
    `dcsa:${e.eventID ?? `${e.eventType}:${e.equipmentEventTypeCode ?? e.transportEventTypeCode}:${e.eventDateTime}:${locode(e) ?? ""}`}`;
  const iso = (e: DcsaEvent) => new Date(e.eventDateTime!).toISOString();
  const vessel = (e: DcsaEvent) =>
    [e.transportCall?.vessel?.vesselName, e.transportCall?.exportVoyageNumber].filter(Boolean).join(" ") || null;

  const events: TrackEvent[] = [];
  let loaded = false;
  let departed = false;
  let arrived = false;

  for (const e of acts) {
    const at = iso(e);
    const place = placeText(e);
    const on = vessel(e);
    const base = { occurred_at: at, estimated: false, location: place, external_id: ext(e) };
    const code = e.equipmentEventTypeCode ?? e.transportEventTypeCode;

    if (e.eventType === "EQUIPMENT" && code === "GTIN" && e.emptyIndicatorCode !== "EMPTY" && !loaded) {
      events.push({ ...base, kind: "gate_in", detail: `${ref} gated in at ${place ?? "the terminal"}`, auto: true, status: "new" });
    } else if (e.eventType === "EQUIPMENT" && code === "LOAD") {
      events.push({ ...base, kind: "loaded", detail: `Loaded${on ? ` on ${on}` : ""} at ${place ?? "port"}`, auto: false, status: "info" });
      loaded = true;
    } else if (e.eventType === "TRANSPORT" && code === "DEPA" && (e.transportCall?.modeOfTransport ?? "VESSEL") === "VESSEL") {
      if (!departed) {
        events.push({ ...base, kind: "departed", detail: `Sailed from ${place ?? "port"}${on ? ` on ${on}` : ""}`, auto: true, status: "new" });
        departed = true;
      } else {
        events.push({ ...base, kind: "in_transit", detail: `Sailed from ${place ?? "port"}${on ? ` on ${on}` : ""}`, auto: false, status: "info" });
      }
    } else if ((code === "DISC" && e.eventType === "EQUIPMENT") || (code === "ARRI" && e.eventType === "TRANSPORT")) {
      const ours = samePlace(pod, where(e), locode(e));
      if (ours) {
        events.push({
          ...base,
          kind: code === "DISC" ? "discharged" : "arrived",
          detail: code === "DISC" ? `Discharged at ${place}` : `${on ?? "Vessel"} arrived at ${place}`,
          auto: !arrived,
          status: arrived ? "info" : "new",
        });
        arrived = true;
      } else if (code === "DISC") {
        events.push({ ...base, kind: "in_transit", detail: `Discharged at ${place ?? "port"} (transhipment)`, auto: false, status: "info" });
      }
    } else if (e.eventType === "EQUIPMENT" && code === "GTOT" && e.emptyIndicatorCode !== "EMPTY" && arrived) {
      events.push({ ...base, kind: "gate_out", detail: `${ref} left the terminal at ${place ?? "destination"}`, auto: false, status: "info" });
    } else if (e.eventType === "EQUIPMENT" && code === "STRP") {
      events.push({ ...base, kind: "other", detail: `Unpacked at ${place ?? "destination"}`, auto: false, status: "info" });
    }
  }

  // The carrier's latest word on when it reaches our port.
  const estimates = all.filter(
    (e) =>
      e.eventClassifierCode !== "ACT" &&
      ((e.transportEventTypeCode === "ARRI" && e.eventType === "TRANSPORT") || e.equipmentEventTypeCode === "DISC") &&
      samePlace(pod, where(e), locode(e))
  );
  const latest = estimates[estimates.length - 1];
  const eta = latest ? iso(latest) : null;
  const last = acts[acts.length - 1];
  const lastVessel = [...all].reverse().find((e) => e.transportCall?.vessel?.vesselName);

  return {
    state: "ok",
    message: last ? `Last: ${describe(last)}` : `${carrier} has only planned events so far.`,
    summary: {
      container: booking.container_number,
      last_event: last ? describe(last) : null,
      last_at: last ? iso(last) : null,
      carrier_eta: eta,
      // Written with the port's own offset, so its first ten characters are the local day.
      eta_local: latest ? latest.eventDateTime!.slice(0, 10) : null,
      vessel: lastVessel?.transportCall?.vessel?.vesselName ?? null,
      vessel_imo: lastVessel?.transportCall?.vessel?.vesselIMONumber ?? null,
      voyage: lastVessel?.transportCall?.exportVoyageNumber ?? null,
      events: acts.length,
    },
    events,
  };
}

const DCSA_WORDS: Record<string, string> = {
  GTIN: "gated in",
  GTOT: "gated out",
  LOAD: "loaded",
  DISC: "discharged",
  STUF: "stuffed",
  STRP: "unpacked",
  PICK: "picked up",
  DROP: "dropped off",
  INSP: "inspected",
  ARRI: "vessel arrived",
  DEPA: "vessel departed",
};
function describe(e: DcsaEvent): string {
  const code = e.equipmentEventTypeCode ?? e.transportEventTypeCode ?? "";
  return `${DCSA_WORDS[code] ?? code.toLowerCase()} at ${placeText(e) ?? "?"}`;
}

// ---------------------------------------------------------------------------
// Vessels: AIS
// ---------------------------------------------------------------------------

const NAV: Record<number, string> = {
  0: "under way",
  1: "at anchor",
  2: "not under command",
  3: "restricted manoeuvrability",
  4: "constrained by draught",
  5: "moored",
  6: "aground",
  8: "under way (sailing)",
};

interface AisMessage {
  MessageType?: string;
  MetaData?: { MMSI?: number | string; ShipName?: string; latitude?: number; longitude?: number; time_utc?: string };
  Message?: {
    PositionReport?: { Latitude?: number; Longitude?: number; Sog?: number; Cog?: number; TrueHeading?: number; NavigationalStatus?: number };
    StandardClassBPositionReport?: { Latitude?: number; Longitude?: number; Sog?: number; Cog?: number; TrueHeading?: number };
    ShipStaticData?: { Name?: string; Destination?: string; ImoNumber?: number; Eta?: { Month?: number; Day?: number; Hour?: number; Minute?: number } };
  };
}

/** "2026-09-23 10:15:02.123456 +0000 UTC" to ISO. */
export function aisTime(s: string | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s ?? "");
  return m ? `${m[1]}T${m[2]}.000Z` : null;
}

/**
 * The ETA a ship's crew types into the AIS set: month, day and time, no year.
 * The next such date on or after a month ago — a ship does not announce an
 * arrival eleven months away, and one just past is still the one meant.
 */
export function aisEta(eta: { Month?: number; Day?: number; Hour?: number; Minute?: number } | undefined, now: Date): string | null {
  if (!eta?.Month || !eta.Day || eta.Month > 12 || eta.Day > 31) return null;
  const h = eta.Hour !== undefined && eta.Hour < 24 ? eta.Hour : 0;
  const mi = eta.Minute !== undefined && eta.Minute < 60 ? eta.Minute : 0;
  let y = now.getUTCFullYear();
  const at = (yy: number) => Date.UTC(yy, eta.Month! - 1, eta.Day!, h, mi);
  if (at(y) < now.getTime() - 30 * 86_400_000) y += 1;
  return new Date(at(y)).toISOString();
}

const squash = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Everything one vessel said during the listening window. */
export function readAis(messages: unknown[], mmsi: string, booking: Booking, now: Date, listenedSeconds: number): Reading {
  const mine = (messages as AisMessage[]).filter((m) => String(m.MetaData?.MMSI ?? "") === mmsi);
  const pos = [...mine].reverse().find((m) => m.Message?.PositionReport || m.Message?.StandardClassBPositionReport);
  const stat = [...mine].reverse().find((m) => m.Message?.ShipStaticData)?.Message?.ShipStaticData;
  if (!pos && !stat) {
    return {
      state: "not_found",
      message: `No AIS report from MMSI ${mmsi} in ${listenedSeconds} s. Shore receivers only reach about 40 nautical miles, so a ship mid-ocean is usually silent.`,
      summary: { mmsi },
      events: [],
    };
  }
  const p = pos?.Message?.PositionReport ?? pos?.Message?.StandardClassBPositionReport;
  const name = (stat?.Name ?? pos?.MetaData?.ShipName ?? "").trim() || null;
  const nav = pos?.Message?.PositionReport?.NavigationalStatus;
  const heading = p?.TrueHeading !== undefined && p.TrueHeading !== 511 ? p.TrueHeading : null;
  const mismatch = Boolean(booking.vessel && name && !squash(name).includes(squash(booking.vessel)) && !squash(booking.vessel).includes(squash(name)));

  const summary = {
    mmsi,
    name,
    imo: stat?.ImoNumber ? String(stat.ImoNumber) : null,
    lat: p?.Latitude ?? pos?.MetaData?.latitude ?? null,
    lon: p?.Longitude ?? pos?.MetaData?.longitude ?? null,
    speed_kn: p?.Sog ?? null,
    course: p?.Cog ?? null,
    heading,
    nav_status: nav !== undefined ? (NAV[nav] ?? null) : null,
    position_at: aisTime(pos?.MetaData?.time_utc),
    destination: stat?.Destination?.trim() || null,
    ais_eta: aisEta(stat?.Eta, now),
    // AIS ETAs are in UTC; the day is close enough to compare with a booking's.
    eta_local: aisEta(stat?.Eta, now)?.slice(0, 10) ?? null,
    name_mismatch: mismatch ? `This MMSI is ${name}; the booking says ${booking.vessel}.` : null,
  };
  const doing = summary.nav_status ?? (summary.speed_kn !== null && summary.speed_kn > 1 ? "under way" : "stopped");
  return {
    state: "ok",
    message: pos ? `${name ?? `MMSI ${mmsi}`} is ${doing}${summary.speed_kn !== null ? ` at ${summary.speed_kn} kn` : ""}.` : `${name} is broadcasting, no position in this window.`,
    summary,
    events: [],
  };
}

/** Hapag-Lloyd's own boxes and bookings, by carrier name or the container prefixes it owns. */
export function isHapagLloyd(carrier: string | null, container: string | null): boolean {
  if (/hapag|hlag|hlcu/i.test(carrier ?? "")) return true;
  return /^(HLCU|HLXU|HLBU|HAMU|UACU|UASU|CPSU)\d/i.test((container ?? "").replace(/\s/g, "")) && !carrier;
}
