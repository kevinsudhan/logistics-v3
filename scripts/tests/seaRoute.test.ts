import { readFileSync } from "node:fs";
import { bearing, distanceKm, findPlace, greatCircle, unwrap, type LatLon } from "../../src/lib/geo";
import { buildSeaGraph, seaRoute } from "../../src/lib/seaRoute";

/**
 * Places, flights and voyages on the route map.
 *
 * The sea routes are run on the real lane network (public/data/sea-lanes.json),
 * because what matters is that the line goes the way ships go: Chennai to
 * Jebel Ali round the south of India and through Hormuz, Barcelona to Nhava
 * Sheva through Suez — never across the land in between.
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

console.log("\nplaces from the job's spelling");
is("the code in brackets", findPlace("Chennai (MAA)", "air")?.codes, ["MAA"]);
is("a port to a ship", findPlace("Chennai", "sea_fcl")?.kind, "port");
is("an airport to a plane", findPlace("Chennai", "air")?.kind, "airport");
is("Mumbai at sea is Nhava Sheva", findPlace("Mumbai, India", "sea_lcl")?.label, "Nhava Sheva");
is("the first name mentioned wins", findPlace("Jebel Ali / Dubai, UAE", "sea_fcl")?.label, "Jebel Ali");
is("a UN/LOCODE", findPlace("AEJEA", null)?.label, "Jebel Ali");
is("unknown stays unknown", findPlace("Timbuktu", "air"), null);

console.log("\nflights");
const maa: LatLon = [12.9941, 80.1709];
const dxb: LatLon = [25.2532, 55.3657];
is("Chennai to Dubai is about 2,900 km", Math.round(distanceKm(maa, dxb) / 100) * 100, 2900);
const arc = greatCircle(maa, dxb);
is("the arc starts and ends at the airports", [arc[0], arc[arc.length - 1]].map((p) => p.map((x) => Math.round(x))), [[13, 80], [25, 55]]);
is("with points along the way", arc.length > 10, true);
is("north-west out of Chennai", Math.round(bearing(maa, dxb) / 10) * 10, 300);
is("across the date line the short way", unwrap([[0, 179], [0, -179]]), [[0, 179], [0, 181]]);

console.log("\nvoyages on the real lanes");
const g = buildSeaGraph(JSON.parse(readFileSync("public/data/sea-lanes.json", "utf-8")));
is("the network loads: about 6,000 junctions", g.nodes.length > 5000, true);

const chennaiJebelAli = seaRoute(g, [13.095, 80.295], [25.0112, 55.0617])!;
is("Chennai to Jebel Ali is found", Boolean(chennaiJebelAli), true);
is("round the south of India", chennaiJebelAli.some(([lat, lon]) => lat < 8 && lon > 75 && lon < 82), true);
is("through the Strait of Hormuz", chennaiJebelAli.some(([lat, lon]) => lat > 25.5 && lat < 27.5 && lon > 55.5 && lon < 57.5), true);
is("never through the middle of India", chennaiJebelAli.some(([lat, lon]) => lat > 14 && lat < 24 && lon > 74 && lon < 84), false);

const barcelonaMumbai = seaRoute(g, [41.35, 2.16], [18.95, 72.95])!;
is("Barcelona to Nhava Sheva goes through Suez", barcelonaMumbai.some(([lat, lon]) => lat > 29 && lat < 31.5 && lon > 32 && lon < 33), true);
is("and not across the Sahara", barcelonaMumbai.some(([lat, lon]) => lat > 15 && lat < 28 && lon > 0 && lon < 25), false);

const singaporeLa = seaRoute(g, [1.26, 103.84], [33.74, -118.26])!;
is("across the Pacific without a jump", singaporeLa.every((p, i) => i === 0 || Math.abs(p[1] - singaporeLa[i - 1][1]) < 30), true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
