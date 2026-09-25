/**
 * A copy of the backups outside Supabase (093).
 *
 *   node supabase-v2/backup-download.mjs
 *
 * The nightly backups live in the project's own `backups` bucket, which is
 * no help if the project itself is lost. This pulls every backup file this
 * machine does not have yet into backups/db/, and every stored file (the
 * documents on jobs, signatures) into backups/storage/<bucket>/, so the whole
 * desk can be rebuilt from here: the migrations, the latest backup
 * (restore-backup.mjs), and the files.
 *
 * backups/ is gitignored — it is customer data and the repository is public.
 * Safe to run as often as wanted: files already here are skipped.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT } from "./token.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keys = JSON.parse(readFileSync(join(root, "server-v2", ".keys.json"), "utf-8"));
const base = `https://${PROJECT}.supabase.co/storage/v1`;
const H = { apikey: keys.service_role, Authorization: `Bearer ${keys.service_role}` };
const out = join(root, "backups");

async function list(bucket, prefix = "") {
  const r = await fetch(`${base}/object/list/${bucket}`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!r.ok) throw new Error(`list ${bucket}/${prefix}: ${r.status}`);
  const items = await r.json();
  const files = [];
  for (const it of items) {
    const path = prefix ? `${prefix}/${it.name}` : it.name;
    // A folder has no id; walk into it.
    if (it.id === null) files.push(...(await list(bucket, path)));
    else files.push(path);
  }
  return files;
}

async function fetchTo(bucket, path, dest) {
  if (existsSync(dest)) return false;
  const r = await fetch(`${base}/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: H });
  if (!r.ok) throw new Error(`${bucket}/${path}: ${r.status}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, new Uint8Array(await r.arrayBuffer()));
  return true;
}

const bucketsR = await fetch(`${base}/bucket`, { headers: H });
const buckets = (await bucketsR.json()).map((b) => b.id);

let fresh = 0;
let total = 0;
for (const bucket of buckets) {
  const files = await list(bucket);
  for (const path of files) {
    const dest = bucket === "backups" ? join(out, path) : join(out, "storage", bucket, path);
    total++;
    if (await fetchTo(bucket, path, dest)) fresh++;
  }
  console.log(`${bucket.padEnd(16)} ${files.length} file${files.length === 1 ? "" : "s"}`);
}
console.log(`${fresh} new, ${total - fresh} already here, in ${out}`);
