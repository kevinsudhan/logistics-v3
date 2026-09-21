/**
 * Puts sailings on the board so the space and quoting path can be exercised.
 *
 *   node supabase-v2/seed-sailings.mjs
 *   node supabase-v2/seed-sailings.mjs --clear
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ALLOWED TO EXIST WHEN NOTHING ELSE IS SEEDED
 *
 * v2 shows real data or nothing, and every other fixture was deleted for that
 * reason. Sailings are the exception because they are not a record of something
 * that happened -- they are a schedule of what a forwarder has bought space on,
 * and a real desk would have entered them before the first customer rang. An
 * empty board is not an honest empty state here; it is a desk that has not been
 * set up.
 *
 * The rate card is seeded for the same reason. An agent with no rates cannot
 * quote, and the rule that she must never invent one means she simply refuses
 * every caller.
 *
 * Dates are relative to today, so the board never goes stale and a sailing
 * never sits in the past waiting to confuse somebody.
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keys = JSON.parse(readFileSync(join(root, "server-v2/.keys.json"), "utf-8"));

import { projectUrl } from "./token.mjs";
const PROJECT = projectUrl();
const H = {
  apikey: keys.service_role,
  Authorization: `Bearer ${keys.service_role}`,
  "Content-Type": "application/json",
};

const rest = async (path, init = {}) => {
  const r = await fetch(`${PROJECT}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};

const DAY = 86_400_000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

if (process.argv.includes("--clear")) {
  await rest("placements?id=not.is.null", { method: "DELETE" });
  await rest("sailings?id=not.is.null", { method: "DELETE" });
  console.log("board cleared");
  process.exit(0);
}

/**
 * A fortnight of departures on the four priced lanes.
 *
 * Cut-off is two days before sailing on every one, which is the usual gap and
 * the thing an agent has to be able to answer without checking.
 */
const SAILINGS = [
  // Jebel Ali — the busiest lane, so it gets the most frequent service.
  ["sl-jea-1", "Chennai to Jebel Ali", "MSC", "40HC", day(4), day(2)],
  ["sl-jea-2", "Chennai to Jebel Ali", "MSC", "40HC", day(11), day(9)],
  ["sl-jea-3", "Chennai to Jebel Ali", "CMA CGM", "40HC", day(18), day(16)],

  ["sl-sin-1", "Chennai to Singapore", "ONE", "40HC", day(6), day(4)],
  ["sl-sin-2", "Chennai to Singapore", "ONE", "40HC", day(13), day(11)],

  // Colombo is short-haul and moves in smaller boxes.
  ["sl-cmb-1", "Chennai to Colombo", "CMA CGM", "20GP", day(3), day(1)],
  ["sl-cmb-2", "Chennai to Colombo", "CMA CGM", "20GP", day(10), day(8)],

  ["sl-jed-1", "Chennai to Jeddah", "Maersk", "40GP", day(8), day(6)],
  ["sl-jed-2", "Chennai to Jeddah", "Maersk", "40GP", day(21), day(19)],
];

await rest("sailings", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify(
    SAILINGS.map(([id, route, carrier, container_code, sailing_date, cutoff_date]) => ({
      id,
      route,
      carrier,
      container_code,
      sailing_date,
      cutoff_date,
      mode: "LCL",
      status: "open",
    }))
  ),
});

/**
 * Two sailings arrive part-loaded.
 *
 * A board where every container is empty never exercises the interesting half:
 * whether the agent notices that a consignment does not fit, and whether the
 * remaining-space figure is derived rather than assumed. The 20GP is left with
 * 1.1 m of floor precisely so a normal enquiry has to be turned away from it.
 */
const PLACEMENTS = [
  {
    sailing_id: "sl-jea-1",
    client_name: "Existing groupage",
    x_m: 0,
    length_m: 3.6,
    pieces_across: 2,
    pieces_high: 2,
    rows_count: 3,
    quantity: 48,
    piece_length_m: 1.2,
    piece_width_m: 1.0,
    piece_height_m: 1.1,
    weight_kg: 5760,
  },
  {
    sailing_id: "sl-cmb-1",
    client_name: "Existing groupage",
    x_m: 0,
    length_m: 4.8,
    pieces_across: 2,
    pieces_high: 2,
    rows_count: 4,
    quantity: 32,
    piece_length_m: 1.2,
    piece_width_m: 0.8,
    piece_height_m: 0.9,
    weight_kg: 1920,
  },
];

await rest("placements", { method: "POST", body: JSON.stringify(PLACEMENTS) });

const RATES = [
  ["Chennai to Jebel Ali", 4800, 38000, 4200, 9],
  ["Chennai to Singapore", 4200, 34000, 3700, 7],
  ["Chennai to Colombo", 3400, 24000, 2950, 4],
  ["Chennai to Jeddah", 6100, 52000, 5400, 13],
];

await rest("rate_card", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify(
    RATES.map(([route, per_cbm_inr, minimum_inr, floor_inr, transit_days]) => ({
      route,
      per_cbm_inr,
      minimum_inr,
      floor_inr,
      transit_days,
    }))
  ),
});

const space = await rest("sailing_space?select=*&order=route,sailing_date");
console.log(`${space.length} sailings on the board\n`);
for (const s of space) {
  console.log(
    `  ${s.sailing_date}  ${s.route.padEnd(22)} ${s.container_code}  ` +
      `${String(s.free_length_m).padStart(5)} m free  ${String(s.free_cbm).padStart(6)} CBM  ` +
      `${s.consignments} loaded`
  );
}

// Push it to the agents straight away rather than waiting for the cron.
const sync = await fetch(`${PROJECT}/functions/v1/kb-sync`, {
  method: "POST",
  headers: { Authorization: `Bearer ${keys.anon}`, "Content-Type": "application/json" },
}).then((r) => r.json());

console.log(
  `\nknowledge: ${sync.published?.map((p) => `${p.name} ${p.action} (${p.chars} chars)`).join(", ")}`
);
