/**
 * Applies a migration to the v2 project.
 *
 *   node supabase-v2/run-sql.mjs 013-partners.sql
 *   node supabase-v2/run-sql.mjs "select count(*) from public.enquiries"
 *
 * An argument ending in .sql is a file in supabase-v2/; anything else is sent
 * as the query itself, for a quick look at live data. A look that must not
 * change anything belongs in `do $$ ... raise exception 'RESULTS %' ... $$`
 * so the work rolls back (HANDOFF.md, "Testing database behaviour").
 *
 * There is no Supabase CLI on this machine, so migrations go through the
 * Management API's query endpoint. The whole file is sent as one statement
 * block, which means it is applied in a single transaction -- a migration that
 * fails halfway leaves nothing behind.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { accessToken, PROJECT } from "./token.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const TOKEN = accessToken();

const file = process.argv[2];
if (!file) {
  console.error('usage: node supabase-v2/run-sql.mjs <file.sql | "select ...">');
  process.exit(1);
}

const isFile = file.endsWith(".sql");
const sql = isFile ? readFileSync(join(root, "supabase-v2", file), "utf-8") : file;

const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});

const text = await r.text();
console.log(`${isFile ? file : "query"} -> ${r.status}`);
console.log(text.slice(0, isFile ? 1200 : 8000));
process.exit(r.ok ? 0 : 1);
