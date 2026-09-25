/**
 * Gives the server's mail copy (087) its credentials.
 *
 *   node supabase-v2/set-mail-sync-secret.mjs
 *
 * - The Microsoft app: the tenant and client id are copied from the project's
 *   own Microsoft (Azure) sign-in settings, so the server signs in as the same
 *   Azure app people sign in through. The client secret cannot be copied from
 *   there — the Management API hands back only a SHA-256 of it — so it is
 *   either set by hand in the dashboard (Edge Functions → Secrets →
 *   MS_CLIENT_SECRET) or read from `ms_client_secret` in server-v2/.keys.json
 *   when that is present. Make it in Azure: the app → Certificates & secrets →
 *   New client secret, and copy the Value, not the Secret ID.
 * - The scheduler's secret: a fresh random one, put in the `mail-sync`
 *   function's secrets (MAIL_SYNC_SECRET) and in Vault (mail_sync_secret),
 *   where the cron job reads it; the anonymous key goes into Vault beside it
 *   (mail_sync_anon_key) for the gateway. As 073 does for tracking.
 *
 * Nothing secret is printed. A copy of the scheduler's secret is kept in
 * server-v2/.keys.json (gitignored) for running the sweep by hand.
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
const api = (path, init = {}) =>
  fetch(`https://api.supabase.com/v1/projects/${PROJECT}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

const auth = await (await api("/config/auth")).json();
const tenant = String(auth.external_azure_url ?? "").replace(/\/+$/, "").split("/").pop();
const clientId = auth.external_azure_client_id;
const clientSecret = keys.ms_client_secret ?? null;
if (!auth.external_azure_enabled || !tenant || !clientId) {
  throw new Error("The project has no complete Microsoft sign-in settings to copy.");
}
if (/^(common|organizations|consumers)$/i.test(tenant)) {
  throw new Error(`The sign-in URL names no tenant ("${tenant}"); the server copy needs the organisation's own.`);
}

const secret = randomBytes(32).toString("hex");
const s = await api("/secrets", {
  method: "POST",
  body: JSON.stringify([
    { name: "MS_TENANT_ID", value: tenant },
    { name: "MS_CLIENT_ID", value: clientId },
    ...(clientSecret ? [{ name: "MS_CLIENT_SECRET", value: clientSecret }] : []),
    { name: "MAIL_SYNC_SECRET", value: secret },
  ]),
});
console.log(`function secrets MS_TENANT_ID, MS_CLIENT_ID,${clientSecret ? " MS_CLIENT_SECRET," : ""} MAIL_SYNC_SECRET -> ${s.status}`);
if (!s.ok) process.exit(1);
if (!clientSecret) console.log("MS_CLIENT_SECRET left as it is: set it in the dashboard, or put ms_client_secret in server-v2/.keys.json and run again.");

// Quoted as SQL literals; both values are hex or base64url, so no quote can appear.
if (!/^[A-Za-z0-9._-]+$/.test(keys.anon)) throw new Error("unexpected characters in the anon key");
const upsert = (name, value) => `
  do $$ begin
    if exists (select 1 from vault.secrets where name = '${name}') then
      perform vault.update_secret((select id from vault.secrets where name = '${name}'), '${value}');
    else
      perform vault.create_secret('${value}', '${name}', 'mail-sync (087)');
    end if;
  end $$;`;
const q = await api("/database/query", {
  method: "POST",
  body: JSON.stringify({ query: upsert("mail_sync_secret", secret) + upsert("mail_sync_anon_key", keys.anon) }),
});
console.log(`vault mail_sync_secret, mail_sync_anon_key -> ${q.status}`);
if (!q.ok) process.exit(1);

writeFileSync(keysPath, JSON.stringify({ ...keys, mail_sync_secret: secret }, null, 2));
console.log("saved to server-v2/.keys.json (gitignored)");
