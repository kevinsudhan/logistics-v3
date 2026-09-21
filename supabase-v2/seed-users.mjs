/**
 * Creates the desk accounts in the v2 Supabase project.
 *
 *   node supabase-v2/seed-users.mjs
 *
 * Idempotent: an address that already exists is reported and skipped rather than
 * failing the run, so this can be re-run after adding someone to the list.
 *
 * The role goes in app_metadata, never user_metadata. A signed-in user can PATCH
 * their own user_metadata -- putting the role there would let any employee make
 * themselves an admin. app_metadata is writable only with the service key.
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

/** Starter password. Every one of these must be changed before real use. */
const STARTER = "Junior@123";

const USERS = [
  { email: "aashish@aashishlogistics.com", name: "Aashish", role: "admin" },
  { email: "parasu@aashishlogistics.com", name: "Parasu", role: "employee" },
  { email: "aarathy@aashishlogistics.com", name: "Aarathy", role: "employee" },
  { email: "info@aashishlogistics.com", name: "Info Desk", role: "employee" },
  { email: "imports@aashishlogistics.com", name: "Imports Desk", role: "employee" },
];

for (const u of USERS) {
  const r = await fetch(`${PROJECT}/auth/v1/admin/users`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      email: u.email,
      password: STARTER,
      email_confirm: true,
      user_metadata: { full_name: u.name },
      app_metadata: { role: u.role },
    }),
  });
  const body = await r.text();
  if (r.ok) {
    console.log(`  created   ${u.role.padEnd(9)} ${u.email}`);
  } else if (/already been registered|already exists/i.test(body)) {
    console.log(`  exists    ${u.role.padEnd(9)} ${u.email}`);
  } else {
    console.log(`  FAILED    ${u.email} -> ${r.status} ${body.slice(0, 160)}`);
  }
}

const profiles = await fetch(
  `${PROJECT}/rest/v1/profiles?select=email,full_name,role&order=role`,
  { headers: { apikey: keys.service_role, Authorization: `Bearer ${keys.service_role}` } }
).then((r) => r.json());

console.log(`\nprofiles table: ${Array.isArray(profiles) ? profiles.length : "?"} rows`);
for (const p of Array.isArray(profiles) ? profiles : []) {
  console.log(`  ${p.role.padEnd(9)} ${p.email.padEnd(34)} ${p.full_name}`);
}
