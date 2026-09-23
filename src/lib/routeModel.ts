import { distanceKm, type LatLon } from "./geo";

/**
 * What the route map draws, worked out from the job — without drawing it.
 *
 * ---------------------------------------------------------------------------
 * THE THREE THINGS ON THE MAP
 *
 *   The plan: the port or airport of loading, the ports the legs call at,
 *   the port or airport of discharge, and the final destination when it is
 *   inland of that.
 *
 *   The actual route (solid): every position a ship or aircraft reported,
 *   in time order, from the port of loading once it has left, to the port of
 *   discharge once it has arrived. Where two reports are far apart the line
 *   between them follows the sea lanes or the great circle, so a ship silent
 *   for three days mid-ocean is not drawn across a continent.
 *
 *   The expected route (dashed): from where it is now — or from the start,
 *   if it has not left — through the stops it has not reached to the end.
 *
 * Nothing is placed that cannot be found: a place with no coordinates is
 * returned in `unplaced`, for the page to look up, rather than guessed.
 * ---------------------------------------------------------------------------
 */

export type How = "sea" | "air" | "road";

export interface RouteInput {
  mode: string | null;
  stage: string;
  pol: string | null;
  pod: string | null;
  /** Where it finally goes, if beyond the port of discharge. */
  finalDestination: string | null;
  legs: Array<{ move: string; from: string | null; to: string | null; status: string }>;
  positions: Array<{ lat: number; lon: number; at: string; source: string }>;
  resolve: (name: string) => LatLon | null;
  /** How a place is named on the map: "Chennai" rather than "Chennai (INMAA), India". */
  labelOf?: (name: string) => string;
  /** The line between two points by the given means. */
  route: (a: LatLon, b: LatLon, how: How) => LatLon[];
}

export interface Stop {
  at: LatLon;
  label: string;
  role: "origin" | "via" | "destination" | "final";
}

export interface RouteModel {
  stops: Stop[];
  actual: LatLon[];
  expected: LatLon[];
  pings: Array<{ at: LatLon; when: string; source: string }>;
  current: { at: LatLon; when: string | null } | null;
  unplaced: string[];
  how: How;
}

const DEPARTED = ["sailed", "arrived", "delivered"];
const ARRIVED = ["arrived", "delivered"];
/** A report this close to a stop means the stop has been reached. */
const REACHED_KM = 150;
/**
 * Reports closer than this are joined with a straight line, as a track is
 * drawn. Only a long silence — a ship out of receiver range for days — is
 * joined along the lanes, where a straight line could cross land; joining
 * near reports that way detours to the nearest lane and back.
 */
const STRAIGHT_KM = 1500;
/** Two stops this close are one place spelled twice ("Jebel Ali (AEJEA)" and "Jebel Ali / Dubai"). */
const SAME_PLACE_KM = 50;

export function mainHow(mode: string | null): How {
  return mode === "air" ? "air" : mode === "sea_fcl" || mode === "sea_lcl" ? "sea" : "road";
}

const moveHow = (move: string, fallback: How): How => (move === "air" ? "air" : move === "sea" ? "sea" : move === "road" || move === "rail" ? "road" : fallback);

const same = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export function buildRoute(i: RouteInput): RouteModel {
  const how = mainHow(i.mode);
  const unplaced: string[] = [];
  const place = (name: string | null): LatLon | null => {
    if (!name?.trim()) return null;
    const p = i.resolve(name);
    if (!p && !unplaced.includes(name)) unplaced.push(name);
    return p;
  };

  // ---- the plan: stops and the means between them ----
  const legs = i.legs.filter((l) => l.status !== "cancelled");
  const plan: Array<{ name: string; how: How }> = [];
  const add = (name: string | null, h: How) => {
    if (!name?.trim()) return;
    if (plan.length && same(plan[plan.length - 1].name, name)) return;
    plan.push({ name, how: h });
  };
  add(i.pol, how);
  // Legs of the main carriage add the ports they call at; a road leg before
  // the port of loading is collection, not the route this map is about.
  for (const l of legs) {
    const h = moveHow(l.move, how);
    if (h !== how) continue;
    if (!plan.length) add(l.from, h);
    add(l.to, h);
  }
  add(i.pod, how);
  if (i.finalDestination && !same(i.finalDestination, i.pod)) add(i.finalDestination, "road");

  const stops: Stop[] = [];
  const stopHow: How[] = [];
  const inland = Boolean(i.finalDestination && !same(i.finalDestination, i.pod));
  plan.forEach((p, n) => {
    const at = place(p.name);
    if (!at) return;
    // The same place again, spelled another way: one stop.
    const prev = stops[stops.length - 1];
    if (prev && distanceKm(prev.at, at) < SAME_PLACE_KM) return;
    stops.push({ at, label: i.labelOf ? i.labelOf(p.name) : p.name, role: "via" });
    stopHow.push(inland && n === plan.length - 1 ? "road" : p.how);
  });
  // Roles once the stops are settled: the first leaves, the last port is the
  // destination, and an inland town beyond it is the final stop.
  if (stops.length) stops[0].role = "origin";
  if (stops.length > 1) {
    const last = stops.length - 1;
    if (stopHow[last] === "road" && stops.length > 2) {
      stops[last].role = "final";
      stops[last - 1].role = "destination";
    } else stops[last].role = "destination";
  }

  // ---- where it has been ----
  const pts = [...i.positions].sort((a, b) => (a.at < b.at ? -1 : 1)).map((p) => ({ at: [p.lat, p.lon] as LatLon, when: p.at, source: p.source }));
  const departed = DEPARTED.includes(i.stage) || pts.length > 0;
  const arrived = ARRIVED.includes(i.stage);
  const origin = stops.find((s) => s.role === "origin");
  const lastPort = [...stops].reverse().find((s) => s.role === "destination");

  const join = (points: LatLon[], h: How): LatLon[] => {
    const out: LatLon[] = [];
    for (const p of points) {
      if (!out.length) {
        out.push(p);
        continue;
      }
      const prev = out[out.length - 1];
      const leg = distanceKm(prev, p) > STRAIGHT_KM ? i.route(prev, p, h) : [prev, p];
      out.push(...leg.slice(1));
    }
    return out;
  };

  let actual: LatLon[] = [];
  if (departed && origin && (pts.length || arrived)) {
    const seq = [origin.at, ...pts.map((p) => p.at)];
    if (arrived && lastPort) seq.push(lastPort.at);
    actual = join(seq, how);
  }

  const current = arrived ? (lastPort ? { at: lastPort.at, when: null } : null) : pts.length ? { at: pts[pts.length - 1].at, when: pts[pts.length - 1].when } : null;

  // ---- where it is still to go ----
  let expected: LatLon[] = [];
  if (!arrived && stops.length >= 2) {
    const reached = (s: Stop) => pts.some((p) => distanceKm(p.at, s.at) < REACHED_KM);
    const from = current?.at ?? stops[0].at;
    const ahead = stops
      .map((s, n) => ({ s, h: stopHow[n] }))
      .filter(({ s }, n) => n > 0 && !(current && reached(s)));
    let prev = from;
    for (const { s, h } of ahead) {
      const seg = i.route(prev, s.at, h);
      expected.push(...(expected.length ? seg.slice(1) : seg));
      prev = s.at;
    }
  } else if (arrived && stops.length > 2 && stops[stops.length - 1].role === "final" && lastPort) {
    expected = i.route(lastPort.at, stops[stops.length - 1].at, "road");
  }

  return { stops, actual, expected, pings: pts, current, unplaced, how };
}
