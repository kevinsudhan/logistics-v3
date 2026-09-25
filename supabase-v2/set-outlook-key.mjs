/**
 * Gives `outlook-token` (094) the key it seals Microsoft refresh tokens with.
 *
 *   node supabase-v2/set-outlook-key.mjs            set it, if it is not set yet
 *   node supabase-v2/set-outlook-key.mjs --rotate   replace it
 *
 * 32 random bytes, base64url, into the functions' secrets as OUTLOOK_TOKEN_KEY.
 * No copy is kept anywhere else and none is needed: replacing or losing it
 * only means everybody signed in right now connects Outlook once more when
 * their hour runs out. The function also needs MS_TENANT_ID, MS_CLIENT_ID and
 * MS_CLIENT_SECRET, which set-mail-sync-secret.mjs already put there.
 *
 * Nothing secret is printed.
 */
import { randomBytes } from "node:crypto";
import { accessToken, PROJECT } from "./token.mjs";

const TOKEN = accessToken();
const api = (path, init = {}) =>
  fetch(`https://api.supabase.com/v1/projects/${PROJECT}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

const have = new Set(((await (await api("/secrets")).json()) ?? []).map((s) => s.name));
for (const needed of ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"]) {
  if (!have.has(needed)) console.log(`warning: ${needed} is not set; run set-mail-sync-secret.mjs`);
}
if (have.has("OUTLOOK_TOKEN_KEY") && !process.argv.includes("--rotate")) {
  console.log("OUTLOOK_TOKEN_KEY is already set; --rotate to replace it.");
  process.exit(0);
}

const key = randomBytes(32).toString("base64url");
const r = await api("/secrets", { method: "POST", body: JSON.stringify([{ name: "OUTLOOK_TOKEN_KEY", value: key }]) });
console.log(`OUTLOOK_TOKEN_KEY -> ${r.status}`);
if (!r.ok) process.exit(1);
