/**
 * Gives the nightly backup (093) its credentials.
 *
 *   node supabase-v2/set-backup-secret.mjs
 *
 * A fresh random secret, put in the two places that must agree: the
 * `db-backup` function's secrets (BACKUP_SECRET) and Vault (backup_secret),
 * where the cron job reads it at run time; the anonymous key beside it in
 * Vault (backup_anon_key) for the gateway. As 073 and 087 do.
 *
 * Nothing is printed. A copy is kept in server-v2/.keys.json (gitignored) for
 * running a backup by hand.
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

const s = await api("/secrets", [{ name: "BACKUP_SECRET", value: secret }]);
console.log(`function secret BACKUP_SECRET -> ${s.status}`);
if (!s.ok) process.exit(1);

if (!/^[A-Za-z0-9._-]+$/.test(keys.anon)) throw new Error("unexpected characters in the anon key");
const upsert = (name, value) => `
  do $$ begin
    if exists (select 1 from vault.secrets where name = '${name}') then
      perform vault.update_secret((select id from vault.secrets where name = '${name}'), '${value}');
    else
      perform vault.create_secret('${value}', '${name}', 'db-backup (093)');
    end if;
  end $$;`;
const q = await api("/database/query", { query: upsert("backup_secret", secret) + upsert("backup_anon_key", keys.anon) });
console.log(`vault backup_secret, backup_anon_key -> ${q.status}`);
if (!q.ok) process.exit(1);

writeFileSync(keysPath, JSON.stringify({ ...keys, backup_secret: secret }, null, 2));
console.log("saved to server-v2/.keys.json (gitignored)");
