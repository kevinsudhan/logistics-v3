import type { LatLon } from "../../src/lib/geo";
import { buildRoute, type RouteInput } from "../../src/lib/routeModel";

/**
 * What the route map draws, from the job.
 *
 * Straight lines stand in for the sea lanes here — what is tested is which
 * lines are drawn, from where to where, not their shape (seaRoute.test.ts
 * does that).
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${label}${
      ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`
    }`
  );
  ok ? pass++ : fail++;
};

const PLACES: Record<string, LatLon> = {
  Chennai: [13, 80],
  Colombo: [7, 80],
  "Jebel Ali": [25, 55],
  Dubai: [25.2, 55.3],
  "Abu Dhabi": [24.4, 54.6],
};
const calls: string[] = [];
const base: RouteInput = {
  mode: "sea_fcl",
  stage: "booked",
  pol: "Chennai",
  pod: "Jebel Ali",
  finalDestination: null,
  legs: [],
  positions: [],
  resolve: (n) => PLACES[n] ?? null,
  route: (a, b, how) => {
    calls.push(how);
    return [a, b];
  },
};

console.log("\nnot sailed yet");
const booked = buildRoute(base);
is("origin and destination", booked.stops.map((s) => [s.label, s.role]), [["Chennai", "origin"], ["Jebel Ali", "destination"]]);
is("nothing actual", booked.actual, []);
is("the whole way expected", booked.expected, [[13, 80], [25, 55]]);
is("no current position", booked.current, null);
is("by sea", booked.how, "sea");

console.log("\nunder way, with reports");
const sailing = buildRoute({
  ...base,
  stage: "sailed",
  positions: [
    { lat: 8, lon: 76, at: "2026-10-03T00:00:00Z", source: "aisstream" },
    { lat: 6, lon: 79, at: "2026-10-02T00:00:00Z", source: "aisstream" },
  ],
});
is("actual from the port through the reports, in time order", sailing.actual, [[13, 80], [6, 79], [8, 76]]);
is("current is the latest report", sailing.current, { at: [8, 76], when: "2026-10-03T00:00:00Z" });
is("expected from there to the destination", sailing.expected, [[8, 76], [25, 55]]);
is("each report is a ping", sailing.pings.length, 2);

console.log("\na long silence is joined by the lanes");
calls.length = 0;
buildRoute({ ...base, stage: "sailed", positions: [{ lat: 20, lon: 62, at: "2026-10-05T00:00:00Z", source: "aisstream" }] });
is("the gap goes through the route function, by sea", calls[0], "sea");

console.log("\narrived");
const arrived = buildRoute({ ...base, stage: "arrived", positions: [{ lat: 8, lon: 76, at: "2026-10-03T00:00:00Z", source: "aisstream" }] });
is("actual ends at the port of discharge", arrived.actual[arrived.actual.length - 1], [25, 55]);
is("nothing left expected", arrived.expected, []);
is("current is the port", arrived.current, { at: [25, 55], when: null });

const noReports = buildRoute({ ...base, stage: "arrived" });
is("arrived without reports: port to port", noReports.actual, [[13, 80], [25, 55]]);

console.log("\nlegs");
const tranship = buildRoute({ ...base, legs: [{ move: "sea", from: "Chennai", to: "Colombo", status: "planned" }, { move: "sea", from: "Colombo", to: "Jebel Ali", status: "planned" }] });
is("the transhipment port is a stop", tranship.stops.map((s) => [s.label, s.role]), [["Chennai", "origin"], ["Colombo", "via"], ["Jebel Ali", "destination"]]);
is("expected calls there", tranship.expected, [[13, 80], [7, 80], [25, 55]]);
const passed = buildRoute({ ...base, stage: "sailed", legs: tranship.stops.length ? [{ move: "sea", from: "Chennai", to: "Colombo", status: "completed" }, { move: "sea", from: "Colombo", to: "Jebel Ali", status: "planned" }] : [], positions: [{ lat: 7.2, lon: 79.9, at: "2026-10-04T00:00:00Z", source: "aisstream" }] });
is("a stop already reached is not expected again", passed.expected, [[7.2, 79.9], [25, 55]]);
const collection = buildRoute({ ...base, legs: [{ move: "road", from: "Sriperumbudur", to: "Chennai", status: "completed" }] });
is("a road leg to the port is not on the sea route", collection.stops.map((s) => s.label), ["Chennai", "Jebel Ali"]);

console.log("\nan inland final destination");
const inland = buildRoute({ ...base, pod: "Jebel Ali", finalDestination: "Abu Dhabi" });
is("the port and the town", inland.stops.map((s) => [s.label, s.role]), [["Chennai", "origin"], ["Jebel Ali", "destination"], ["Abu Dhabi", "final"]]);
const inlandArrived = buildRoute({ ...base, stage: "arrived", finalDestination: "Abu Dhabi" });
is("after arrival, the road to the town is still to go", inlandArrived.expected, [[25, 55], [24.4, 54.6]]);
is("same place spelled the same is one stop", buildRoute({ ...base, finalDestination: "jebel ali" }).stops.length, 2);
const twice = buildRoute({ ...base, pod: "Jebel Ali", finalDestination: "Dubai" });
is("the same place spelled twice is one stop", twice.stops.map((s) => [s.label, s.role]), [["Chennai", "origin"], ["Jebel Ali", "destination"]]);
is("named as the map names it", buildRoute({ ...base, labelOf: (n) => n.toUpperCase() }).stops.map((s) => s.label), ["CHENNAI", "JEBEL ALI"]);

console.log("\nplaces that cannot be found");
const unknown = buildRoute({ ...base, pod: "Timbuktu" });
is("are named, not guessed", unknown.unplaced, ["Timbuktu"]);
is("and draw nothing expected", unknown.expected, []);

console.log("\na flight");
calls.length = 0;
const flight = buildRoute({ ...base, mode: "air", pod: "Dubai", stage: "booked" });
is("by air", [flight.how, calls[0]], ["air", "air"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
