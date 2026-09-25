/**
 * The nightly backup, and the admin console's view of it (093).
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *
 *   run    backup_export() — every row of every public table, the staff
 *          accounts without passwords, the list of stored files — gzipped
 *          into the private `backups` bucket as db/YYYY-MM-DD.json.gz (a
 *          manual run adds the time), files older than 30 days removed, and
 *          the run logged in backup_runs whether it worked or not
 *   list   the recent runs, and a link to download each file that is still
 *          kept (valid ten minutes)
 *
 * WHO MAY CALL IT
 *
 * pg_cron at 03:00 IST with the shared secret (BACKUP_SECRET, see
 * supabase-v2/set-backup-secret.mjs), or an administrator from the admin
 * console. Nobody else: the file is the whole desk.
 * ---------------------------------------------------------------------------
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SECRET = Deno.env.get("BACKUP_SECRET");

const KEEP_DAYS = 30;
const BUCKET = "backups";

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let CORS: Record<string, string> = {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** IST date and time, for the file name: the desk's day, not UTC's. */
function istStamp(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000).toISOString();
  return { day: ist.slice(0, 10), time: ist.slice(11, 16).replace(":", "") };
}

async function run(trigger: "schedule" | "manual") {
  const { day, time } = istStamp();
  const file = `db/${day}${trigger === "manual" ? `-${time}` : ""}.json.gz`;
  try {
    // The text Postgres wrote, filed as it is: parsed into JavaScript numbers
    // on the way, 48500.00 became 48500 and a long decimal could lose digits.
    const { data, error } = await db.rpc("backup_export_text");
    if (error) throw new Error(`export: ${error.message}`);
    const text = data as string;
    const doc = JSON.parse(text) as { rows: number; counts: Record<string, number> };
    const bytes = await gzip(text);
    const { error: upErr } = await db.storage.from(BUCKET).upload(file, bytes, { contentType: "application/gzip", upsert: true });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    // Keep thirty days: the file name starts with the day it was taken.
    const { data: files } = await db.storage.from(BUCKET).list("db", { limit: 1000 });
    const cutoff = istStamp(new Date(Date.now() - KEEP_DAYS * 86_400_000)).day;
    const old = (files ?? []).filter((f) => f.name.slice(0, 10) < cutoff).map((f) => `db/${f.name}`);
    if (old.length) await db.storage.from(BUCKET).remove(old);

    const row = { file, bytes: bytes.byteLength, tables: Object.keys(doc.counts).length, rows: doc.rows, ok: true, trigger };
    await db.from("backup_runs").insert(row);
    return { ...row, pruned: old.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("backup_runs").insert({ file, ok: false, error: message.slice(0, 500), trigger });
    throw e;
  }
}

async function list() {
  const { data: runs, error } = await db.from("backup_runs").select("*").order("taken_at", { ascending: false }).limit(40);
  if (error) throw new Error(error.message);
  const { data: files } = await db.storage.from(BUCKET).list("db", { limit: 1000 });
  const kept = new Set((files ?? []).map((f) => `db/${f.name}`));
  const out = [];
  for (const r of runs ?? []) {
    let url: string | null = null;
    if (r.ok && r.file && kept.has(r.file)) {
      const { data } = await db.storage.from(BUCKET).createSignedUrl(r.file, 600, { download: true });
      url = data?.signedUrl ?? null;
    }
    out.push({ ...r, kept: kept.has(r.file), url });
  }
  return out;
}

Deno.serve(async (req) => {
  CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST." }, 405);

  let input: { action?: string; trigger?: string } = {};
  try {
    input = await req.json();
  } catch {
    /* an empty body is a scheduled run */
  }

  const secret = req.headers.get("x-backup-secret");
  const byCron = Boolean(SECRET && secret && sameSecret(secret, SECRET));
  if (!byCron) {
    const { data: who, error } = await createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    }).auth.getUser();
    if (error || !who.user) return json({ error: "Sign in first." }, 401);
    const { data: me } = await db.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
    if (me?.role !== "admin") return json({ error: "Administrators only." }, 403);
  }

  try {
    if (!byCron && input.action === "list") return json({ runs: await list() });
    return json({ done: await run(byCron ? "schedule" : "manual") });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
