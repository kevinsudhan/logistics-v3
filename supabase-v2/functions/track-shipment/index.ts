/**
 * Asks the free trackers where a shipment is, and files what they say (072).
 *
 * ---------------------------------------------------------------------------
 * THE SOURCES, AND WHAT EACH COSTS
 *
 *   aerodatabox  A flight's status on the booked day: taken off, landed, and
 *                when. Key in AERODATABOX_KEY (free via RapidAPI or API.market;
 *                AERODATABOX_VIA says which gateway), a few hundred lookups a
 *                month — so it is asked only around the flight's own day.
 *   adsb         Where an aircraft is right now, from adsb.lol's open ADS-B
 *                network. No key. Only sees flights in the air, by callsign
 *                — the real one from AeroDataBox when that is connected.
 *   hapag_lloyd  A container's events from the carrier, to the DCSA
 *                standard. Free registration (HLAG_CLIENT_ID and
 *                HLAG_CLIENT_SECRET); Hapag-Lloyd boxes only.
 *   aisstream    Where a ship is, from its AIS transponder. Free key
 *                (AISSTREAM_API_KEY). Shore receivers only: silent mid-ocean.
 *
 * A source without its key reports itself "not connected" rather than
 * failing, so the page can say what adding a key would buy.
 *
 * WHO MAY CALL IT
 *
 * A signed-in person, for one shipment — the Refresh button. Or the hourly
 * cron with the shared secret (TRACK_CRON_SECRET), which sweeps every job in
 * motion and asks each source only when that source could have news: a
 * flight around its day, a ship between sailing and arrival. The anonymous
 * key is refused: this spends quota.
 *
 * WHAT IT WRITES
 *
 * With the service key, because provider events are written nowhere else:
 * the latest answer per source (tracking_snapshots) and each thing that
 * happened (tracking_events, once — the source's own event id is the key).
 * Events about our cargo are applied at once through apply_tracking_event,
 * the same function a person's click uses; the rest wait for a person.
 * ---------------------------------------------------------------------------
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  callsignFor,
  flightName,
  isHapagLloyd,
  parseFlight,
  readAeroDataBox,
  readAis,
  readDcsa,
  readAdsb,
  withinDays,
  type Booking,
  type Reading,
} from "./read.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("TRACK_CRON_SECRET");

const ADB_KEY = Deno.env.get("AERODATABOX_KEY");
/**
 * Where the key was bought: "rapidapi" (default) or "apimarket", the two with a
 * free plan, or "direct" (api.aerodatabox.com, paid plans or contributed-data
 * credits only). Each has its own host and header.
 */
const ADB_VIA = Deno.env.get("AERODATABOX_VIA") ?? "rapidapi";
const HL_ID = Deno.env.get("HLAG_CLIENT_ID");
const HL_SECRET = Deno.env.get("HLAG_CLIENT_SECRET");
const AIS_KEY = Deno.env.get("AISSTREAM_API_KEY");

type Source = "aerodatabox" | "adsb" | "hapag_lloyd" | "aisstream";
type State = "ok" | "not_found" | "not_configured" | "not_applicable" | "error";

interface Outcome {
  source: Source;
  state: State;
  message: string;
  summary?: Record<string, unknown>;
  /** Events filed this time, and how many ticked a step. */
  added?: number;
  ticked?: number;
  /** Answered from the last reading because the source was asked moments ago. */
  cached?: boolean;
}

interface ShipmentRow extends Booking {
  id: string;
  stage: string;
  signed_off_at: string | null;
  booking_number: string | null;
  mainline_no: string | null;
  vessel_mmsi: string | null;
}

/**
 * How long an answer is good for before a source is asked again. A person
 * pressing Refresh twice should not spend two lookups; the cron honours the
 * same floor and adds its own, longer rhythm (SWEEP_EVERY).
 */
const FRESH_MINUTES: Record<Source, number> = { aerodatabox: 10, adsb: 2, hapag_lloyd: 15, aisstream: 5 };
const SWEEP_EVERY_HOURS: Record<Source, number> = { aerodatabox: 3, adsb: 1, hapag_lloyd: 6, aisstream: 3 };

let CORS: Record<string, string> = {};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const COLUMNS =
  "id, stage, signed_off_at, transport_mode, flight_number, carrier, etd, sailing_date, eta, port_of_loading, port_of_discharge, origin, destination, vessel, container_number, booking_number, mainline_no, vessel_mmsi";

// ---------------------------------------------------------------------------
// The sources
// ---------------------------------------------------------------------------

async function askAeroDataBox(ship: ShipmentRow): Promise<Reading> {
  const f = parseFlight(ship.flight_number)!;
  const number = `${f.airline}${f.number}`;
  const path = `/flights/number/${encodeURIComponent(number)}/${ship.etd}?withLocation=true&withAircraftImage=false&dateLocalRole=Departure`;
  const r =
    ADB_VIA === "direct"
      ? await fetch(`https://api.aerodatabox.com${path}`, { headers: { "X-Api-Key": ADB_KEY! } })
      : ADB_VIA === "apimarket"
        ? await fetch(`https://prod.api.market/api/v1/aedbx/aerodatabox${path}`, {
            headers: { "x-magicapi-key": ADB_KEY!, accept: "application/json" },
          })
        : await fetch(`https://aerodatabox.p.rapidapi.com${path}`, {
            headers: { "x-rapidapi-key": ADB_KEY!, "x-rapidapi-host": "aerodatabox.p.rapidapi.com" },
          });
  // 204: no such flight that day.
  if (r.status === 204 || r.status === 404) return readAeroDataBox([], ship);
  if (r.status === 401 || r.status === 403) {
    // Their own words say which fix it needs: "inactive" (direct keys have no
    // free plan) is not the same problem as "not subscribed" on a marketplace.
    const said = await r.json().then((b) => b?.message).catch(() => null);
    return fail(`AeroDataBox refused the key${said ? `: "${said}"` : ` (${r.status})`}.`);
  }
  if (r.status === 429) return fail("AeroDataBox's monthly allowance is used up, or it was asked too fast.");
  if (!r.ok) return fail(`AeroDataBox answered ${r.status}.`);
  return readAeroDataBox(await r.json(), ship);
}

async function askAdsb(ship: ShipmentRow, callsign: string, guessed: boolean): Promise<Reading> {
  const r = await fetch(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(callsign)}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "araxys-crm shipment tracking" },
  });
  if (r.status === 429) return fail("adsb.lol is busy; try again in a minute.");
  if (!r.ok) return fail(`adsb.lol answered ${r.status}.`);
  return readAdsb(await r.json(), callsign, guessed, ship, new Date());
}

async function askHapag(ship: ShipmentRow): Promise<Reading> {
  const q = ship.container_number
    ? `equipmentReference=${encodeURIComponent(ship.container_number.replace(/\s/g, "").toUpperCase())}`
    : ship.booking_number
      ? `carrierBookingReference=${encodeURIComponent(ship.booking_number)}`
      : `transportDocumentReference=${encodeURIComponent(ship.mainline_no!)}`;
  const r = await fetch(`https://api.hlag.com/hlag/external/v2/events?${q}`, {
    headers: { "X-IBM-Client-Id": HL_ID!, "X-IBM-Client-Secret": HL_SECRET!, Accept: "application/json" },
  });
  if (r.status === 404) return readDcsa([], ship);
  if (r.status === 401 || r.status === 403) return fail(`Hapag-Lloyd refused the credentials (${r.status}).`);
  if (!r.ok) return fail(`Hapag-Lloyd answered ${r.status}.`);
  return readDcsa(await r.json(), ship);
}

/**
 * Listening to aisstream for a while, for any of the ships asked about.
 *
 * AIS is a stream, not a question: the socket is opened, told which ships
 * (by MMSI), and whatever they broadcast in the window is kept. A ship under
 * way reports every few seconds when a shore receiver can hear it; it stops
 * early once every ship has given a position.
 */
async function listenAis(mmsis: string[], seconds: number): Promise<{ messages: unknown[]; error?: string }> {
  const messages: unknown[] = [];
  if (!mmsis.length) return { messages };
  let error: string | undefined;
  await new Promise<void>((resolve) => {
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    const heard = new Set<string>();
    const finish = () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve();
    };
    const timer = setTimeout(finish, seconds * 1000);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          APIKey: AIS_KEY,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FiltersShipMMSI: mmsis,
          FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ShipStaticData"],
        })
      );
    ws.onmessage = async (ev) => {
      const text = typeof ev.data === "string" ? ev.data : await new Response(ev.data as Blob).text();
      let m: { error?: string; MessageType?: string; MetaData?: { MMSI?: number } };
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (m.error) {
        error = m.error;
        return finish();
      }
      messages.push(m);
      if (m.MessageType !== "ShipStaticData") heard.add(String(m.MetaData?.MMSI ?? ""));
      if (mmsis.every((x) => heard.has(x))) finish();
    };
    ws.onerror = () => {
      error ??= "Could not reach aisstream.";
      finish();
    };
    ws.onclose = () => finish();
  });
  return { messages, error };
}

const fail = (message: string): Reading => ({ state: "error", message, summary: {}, events: [] });

// ---------------------------------------------------------------------------
// One shipment
// ---------------------------------------------------------------------------

interface Plan {
  source: Source;
  /** Why it cannot be asked, when it cannot. */
  skip?: { state: State; message: string };
  ask?: () => Promise<Reading>;
}

function planFor(
  ship: ShipmentRow,
  ais: Map<string, Promise<{ messages: unknown[]; error?: string }>>,
  aisSeconds: number,
  realCallsign: Map<string, string>
): Plan[] {
  const mode = ship.transport_mode ?? "";
  if (mode === "air") {
    const f = parseFlight(ship.flight_number);
    const noFlight = { state: "not_applicable" as State, message: "No flight number on the booking (Shipment details → Flight)." };
    return [
      {
        source: "aerodatabox",
        skip: !f
          ? noFlight
          : !ship.etd
            ? { state: "not_applicable", message: "No ETD on the booking, so there is no day to ask about." }
            : !ADB_KEY
              ? { state: "not_configured", message: "Not connected. A free AeroDataBox key gives take-off and landing times." }
              : undefined,
        ask: () => askAeroDataBox(ship),
      },
      {
        source: "adsb",
        skip: !f ? noFlight : undefined,
        // Asked after AeroDataBox, so its real callsign is used when it gave one.
        ask: async () => {
          const real = realCallsign.get(ship.id);
          const guess = callsignFor(f!);
          if (!real && !guess) {
            return {
              state: "not_applicable",
              message: `No ICAO code on file for airline ${f!.airline}; enter the flight as its callsign (e.g. UAE543), or connect AeroDataBox.`,
              summary: {},
              events: [],
            } as unknown as Reading;
          }
          return askAdsb(ship, real ?? guess!, !real);
        },
      },
    ];
  }
  if (mode === "sea_fcl" || mode === "sea_lcl") {
    const hl = isHapagLloyd(ship.carrier, ship.container_number);
    const ref = ship.container_number || ship.booking_number || ship.mainline_no;
    return [
      {
        source: "hapag_lloyd",
        skip: !hl
          ? { state: "not_applicable", message: `No free container feed for ${ship.carrier || "this carrier"} — Hapag-Lloyd only. Mail updates cover the rest.` }
          : !ref
            ? { state: "not_applicable", message: "No container, booking or master B/L number on the booking." }
            : !HL_ID || !HL_SECRET
              ? { state: "not_configured", message: "Not connected. Free Hapag-Lloyd API credentials give the container's events." }
              : undefined,
        ask: () => askHapag(ship),
      },
      {
        source: "aisstream",
        skip: !ship.vessel_mmsi
          ? { state: "not_applicable", message: "Add the vessel's MMSI (Tracking tab) to follow the ship." }
          : !AIS_KEY
            ? { state: "not_configured", message: "Not connected. A free aisstream key gives the ship's position." }
            : undefined,
        ask: async () => {
          const heard = await ais.get(ship.vessel_mmsi!)!;
          if (heard.error) return fail(`aisstream: ${heard.error}`);
          // Silence means something only if the feed was listening.
          if (!heard.messages.some((m) => (m as { MessageType?: string }).MessageType === "SubscriptionConfirmation")) {
            return fail("aisstream did not confirm the subscription; try again shortly.");
          }
          return readAis(heard.messages, ship.vessel_mmsi!, ship, new Date(), aisSeconds);
        },
      },
    ];
  }
  return [];
}

async function file(ship: ShipmentRow, source: Source, reading: Reading | { state: State; message: string }): Promise<Outcome> {
  const r = reading as Reading;
  await db.from("tracking_snapshots").upsert(
    {
      shipment_id: ship.id,
      source,
      fetched_at: new Date().toISOString(),
      state: r.state,
      message: r.message,
      summary: r.summary ?? {},
    },
    { onConflict: "shipment_id,source" }
  );
  const out: Outcome = { source, state: r.state, message: r.message, summary: r.summary };

  // Every position, kept, so the route map can draw where it has been (076).
  const x = r.summary ?? {};
  if (r.state === "ok" && typeof x.lat === "number" && typeof x.lon === "number" && typeof x.position_at === "string") {
    await db.from("tracking_positions").upsert(
      {
        shipment_id: ship.id,
        source,
        at: x.position_at,
        lat: x.lat,
        lon: x.lon,
        speed: typeof x.speed_kn === "number" ? x.speed_kn : typeof x.speed_kmh === "number" ? x.speed_kmh : null,
        heading: typeof x.heading === "number" ? x.heading : typeof x.course === "number" ? x.course : null,
      },
      { onConflict: "shipment_id,source,at", ignoreDuplicates: true }
    );
  }
  if (!r.events?.length) return out;

  const rows = r.events.map((e) => ({
    shipment_id: ship.id,
    source,
    kind: e.kind,
    occurred_at: e.occurred_at,
    estimated: e.estimated,
    location: e.location,
    detail: e.detail,
    external_id: e.external_id,
    status: e.status,
  }));
  const { data: added, error } = await db
    .from("tracking_events")
    .upsert(rows, { onConflict: "shipment_id,source,external_id", ignoreDuplicates: true })
    .select("id, external_id, status");
  if (error) {
    out.message += ` (could not file its events: ${error.message})`;
    return out;
  }
  out.added = added?.length ?? 0;
  out.ticked = 0;
  // A job signed off is closed: its record is not changed by a feed.
  if (ship.signed_off_at) return out;
  const auto = new Set(r.events.filter((e) => e.auto).map((e) => e.external_id));
  for (const row of added ?? []) {
    if (!auto.has(row.external_id) || row.status !== "new") continue;
    const { data: result } = await db.rpc("apply_tracking_event", { p_id: row.id });
    if (result === "applied") out.ticked++;
  }
  return out;
}

async function lastFetched(ids: string[]): Promise<Map<string, { at: number; state: State; message: string; summary: Record<string, unknown> }>> {
  const { data } = await db.from("tracking_snapshots").select("shipment_id, source, fetched_at, state, message, summary").in("shipment_id", ids);
  return new Map(
    (data ?? []).map((s) => [`${s.shipment_id}:${s.source}`, { at: Date.parse(s.fetched_at), state: s.state, message: s.message, summary: s.summary }])
  );
}

/**
 * Whether a source could have news for this shipment now — the sweep's rule.
 * A person's Refresh asks regardless (subject to FRESH_MINUTES).
 */
function worthAsking(ship: ShipmentRow, source: Source, now: Date): boolean {
  if (!ship.etd) return false;
  const eta = ship.eta ?? ship.etd;
  switch (source) {
    case "aerodatabox":
      return withinDays(now, ship.etd, 0, 0) || withinDays(now, eta, 0, 0);
    case "adsb":
      return withinDays(now, ship.etd, 0, Math.max(0, daysBetween(ship.etd, eta)));
    case "hapag_lloyd":
      return withinDays(now, ship.etd, -10, daysBetween(ship.etd, eta) + 10);
    case "aisstream":
      return withinDays(now, ship.etd, -1, daysBetween(ship.etd, eta) + 2);
  }
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

async function track(ships: ShipmentRow[], sweep: boolean): Promise<Record<string, Outcome[]>> {
  const now = new Date();
  const last = await lastFetched(ships.map((s) => s.id));
  const results: Record<string, Outcome[]> = {};
  // The callsign each flight really broadcasts, as AeroDataBox last reported it.
  const realCallsign = new Map<string, string>();
  for (const ship of ships) {
    const cs = last.get(`${ship.id}:aerodatabox`)?.summary?.callsign;
    if (typeof cs === "string" && cs) realCallsign.set(ship.id, cs.replace(/\s/g, "").toUpperCase());
  }

  // Decide what to ask first, so every ship worth listening for shares one socket.
  const jobs: Array<{ ship: ShipmentRow; plan: Plan; cached?: boolean }> = [];
  for (const ship of ships) {
    ship.etd = ship.etd ?? (ship as unknown as { sailing_date: string | null }).sailing_date;
    for (const plan of planFor(ship, new Map(), 0, realCallsign)) {
      const prev = last.get(`${ship.id}:${plan.source}`);
      const age = prev ? (now.getTime() - prev.at) / 60_000 : Infinity;
      if (plan.skip) {
        // The sweep records a missing key or number once, not every hour.
        if (!(sweep && prev && prev.state === plan.skip.state && prev.message === plan.skip.message)) jobs.push({ ship, plan });
        continue;
      }
      // Only a real answer is reused; "no flight number" is re-judged every time.
      if (age < FRESH_MINUTES[plan.source] && prev && !["not_applicable", "not_configured"].includes(prev.state)) {
        jobs.push({ ship, plan, cached: true });
        continue;
      }
      if (sweep && (age < SWEEP_EVERY_HOURS[plan.source] * 60 || !worthAsking(ship, plan.source, now))) continue;
      // Once it has arrived, the flight and the ship have nothing more to say.
      if (sweep && ["arrived", "delivered"].includes(ship.stage) && plan.source !== "hapag_lloyd") continue;
      jobs.push({ ship, plan });
    }
  }

  // Measured on 23 Sep 2026: the free feed carried one report in 45 s across
  // five ships under way off Singapore, so a short window mostly hears nothing.
  // Each ship turns up about once a minute (2,854 reports from 2,780 ships in
  // 30 s, worldwide). It stops early once every ship has been heard; the edge
  // limit is 150 s, and the other sources are asked while it listens.
  const aisSeconds = sweep ? 100 : 40;
  const wanted = [...new Set(jobs.filter((j) => j.plan.source === "aisstream" && !j.plan.skip && !j.cached).map((j) => j.ship.vessel_mmsi!))];
  const listening = wanted.length ? listenAis(wanted, aisSeconds) : null;
  const ais = new Map(wanted.map((m) => [m, listening!]));

  for (const { ship, plan, cached } of jobs) {
    const list = (results[ship.id] ??= []);
    if (cached) {
      const prev = last.get(`${ship.id}:${plan.source}`)!;
      list.push({ source: plan.source, state: prev.state, message: prev.message, summary: prev.summary, cached: true });
      continue;
    }
    if (plan.skip) {
      // Worth recording, so the page shows what is missing without asking again.
      list.push(await file(ship, plan.source, { ...plan.skip, summary: {}, events: [] } as Reading));
      continue;
    }
    const real = planFor(ship, ais, aisSeconds, realCallsign).find((p) => p.source === plan.source)!;
    let reading: Reading;
    try {
      reading = await real.ask!();
    } catch (e) {
      reading = fail(`Could not ask ${plan.source}: ${String(e).slice(0, 120)}`);
    }
    // A ship not heard this time is still where it was last heard: the free
    // feed carries each ship about once a minute, so one silent window is not
    // news, and wiping the last position would lose the map for nothing.
    const prev = last.get(`${ship.id}:aisstream`);
    if (plan.source === "aisstream" && reading.state === "not_found" && prev?.state === "ok" && typeof prev.summary?.lat === "number") {
      reading = { state: "ok", message: `Not heard in the last ${aisSeconds} s; showing where it was last heard.`, summary: prev.summary, events: [] };
    }
    const cs = plan.source === "aerodatabox" ? reading.summary?.callsign : null;
    if (typeof cs === "string" && cs) realCallsign.set(ship.id, cs.replace(/\s/g, "").toUpperCase());
    list.push(await file(ship, plan.source, reading));
  }
  return results;
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST { shipment_id }." }, 405);

  let input: { shipment_id?: string; sweep?: boolean };
  try {
    input = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  // The cron's secret, or a signed-in person. The anonymous key alone is not enough.
  const secret = req.headers.get("x-track-secret");
  const byCron = Boolean(CRON_SECRET && secret && sameSecret(secret, CRON_SECRET));
  if (!byCron) {
    const auth = req.headers.get("Authorization") ?? "";
    const { data, error } = await createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    }).auth.getUser();
    if (error || !data.user) return json({ error: "Sign in to refresh tracking." }, 401);
    if (input.sweep) return json({ error: "The sweep is the scheduler's." }, 403);
  }

  if (input.sweep) {
    const today = new Date();
    const from = new Date(today.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await db
      .from("shipments")
      .select(COLUMNS)
      .in("transport_mode", ["air", "sea_fcl", "sea_lcl"])
      .not("stage", "in", "(delivered,cancelled)")
      .is("signed_off_at", null)
      .gte("etd", from)
      .lte("etd", to);
    if (error) return json({ error: error.message }, 500);
    const results = await track((data ?? []) as ShipmentRow[], true);
    return json({ swept: Object.keys(results).length, results });
  }

  if (!input.shipment_id) return json({ error: "Which shipment?" }, 400);
  const { data: ship, error } = await db.from("shipments").select(COLUMNS).eq("id", input.shipment_id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!ship) return json({ error: `No shipment ${input.shipment_id}.` }, 404);
  const results = await track([ship as ShipmentRow], false);
  const mode = (ship as ShipmentRow).transport_mode;
  return json({
    shipment_id: input.shipment_id,
    results: results[input.shipment_id] ?? [],
    note: ["air", "sea_fcl", "sea_lcl"].includes(mode ?? "") ? undefined : "Live tracking covers air and sea bookings.",
    flight: parseFlight((ship as ShipmentRow).flight_number) ? flightName(parseFlight((ship as ShipmentRow).flight_number)!) : null,
  });
});
