/**
 * Gives the hourly tracking sweep its credentials (073).
 *
 *   node supabase-v2/set-track-secret.mjs
 *
 * Makes a fresh random secret and puts it in the two places that must agree:
 * the `track-shipment` function's secrets (TRACK_CRON_SECRET) and Supabase
 * Vault (track_cron_secret), where the cron job reads it at run time. The
 * anonymous key goes into Vault beside it (track_anon_key) because the
 * function is deployed with verify_jwt on and the gateway wants a JWT before
 * the function's own check runs.
 *
 * Nothing is printed. Run it again to rotate: both places change together.
 * A copy is kept in server-v2/.keys.json (gitignored) so a person testing the
 * sweep by hand can send it.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { accessToken, PROJECT } from "./token.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keysPath = join(root, "server-v2", ".keys.json");
const keys = JSON.parse(readFileSync(keysPath, "utf-8"));
if (!keys.anon) throw new Error("server-v2/.keys.json has no anon key");

const TOKEN = accessToken();
const secret = randomBytes(32).toString("hex");
const api = (path, body) =>
  fetch(`https://api.supabase.com/v1/projects/${PROJECT}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const s = await api("/secrets", [{ name: "TRACK_CRON_SECRET", value: secret }]);
console.log(`function secret TRACK_CRON_SECRET -> ${s.status}`);
if (!s.ok) process.exit(1);

// Quoted as SQL literals; both values are hex or base64url, so no quote can appear.
if (!/^[A-Za-z0-9._-]+$/.test(keys.anon)) throw new Error("unexpected characters in the anon key");
const upsert = (name, value) => `
  do $$ begin
    if exists (select 1 from vault.secrets where name = '${name}') then
      perform vault.update_secret((select id from vault.secrets where name = '${name}'), '${value}');
    else
      perform vault.create_secret('${value}', '${name}', 'track-shipment sweep (073)');
    end if;
  end $$;`;
const q = await api("/database/query", { query: upsert("track_cron_secret", secret) + upsert("track_anon_key", keys.anon) });
console.log(`vault track_cron_secret, track_anon_key -> ${q.status}`);
if (!q.ok) process.exit(1);

writeFileSync(keysPath, JSON.stringify({ ...keys, track_cron_secret: secret }, null, 2));
console.log("saved to server-v2/.keys.json (gitignored)");
