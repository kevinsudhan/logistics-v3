/**
 * Applies every migration, in order.
 *
 *   node supabase-v2/apply-all.mjs            # apply
 *   node supabase-v2/apply-all.mjs --dry-run  # just say what it would apply
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * These migrations were applied one at a time as they were written, against a
 * project that already existed. That is fine until you need a second project --
 * a staging copy, or the separate one production runs on -- at which point the
 * whole set has to run in sequence, and doing that by hand forty-three times in
 * an order that matters is how a step gets skipped.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not track what has already been applied. Every migration is written
 * to be re-runnable -- `create table if not exists`, `create or replace
 * function`, `drop policy if exists` before `create policy` -- so running the
 * set twice is safe and is the intended way to bring a project back in line.
 * The one thing it cannot undo is a migration that failed halfway, which is why
 * each file is sent as a single statement block and therefore a single
 * transaction.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { accessToken, PROJECT } from "./token.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");

const files = readdirSync(here)
  .filter((f) => /^\d{3}-.*\.sql$/.test(f))
  .sort();

if (!files.length) {
  console.error("No migrations found next to this script.");
  process.exit(1);
}

console.log(`${files.length} migrations -> project ${PROJECT}`);
if (dryRun) {
  for (const f of files) console.log(`  would apply  ${f}`);
  process.exit(0);
}

const TOKEN = accessToken();

for (const file of files) {
  const sql = readFileSync(join(here, file), "utf-8");
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });

  if (!r.ok) {
    // Stop rather than carry on. A later migration that depends on this one
    // would fail too, and a screen of cascading errors hides which one broke.
    console.error(`\n${file} -> ${r.status}`);
    console.error((await r.text()).slice(0, 1500));
    console.error(`\nStopped. Fix ${file} and run again — the set is re-runnable.`);
    process.exit(1);
  }

  console.log(`  ok  ${file}`);
}

console.log("\nSchema is up. Next: node supabase-v2/seed-users.mjs");
