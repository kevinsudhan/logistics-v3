/**
 * The Management API credential, and the project it is allowed to point at.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT READ FROM ../araxys-crm/snapserve-setup/.env ANY MORE
 *
 * It used to be. `run-sql.mjs`, `deploy-function.mjs` and `seed-showcase.mjs`
 * each opened v1's environment file and copied every variable in it into
 * `process.env` -- which meant that applying a v2 migration loaded v1's live
 * SnapServe key, v1's service_role key, v1's cron secret, an Anthropic key and,
 * worst of the set, `SUPABASE_URL` and `SUPABASE_PROJECT_REF` both pointing at
 * v1's project. The scripts survived that only because each one ignored those
 * two variables in favour of a hardcoded constant. One script written the
 * obvious way -- `process.env.SUPABASE_URL` -- would have written to the live
 * project that answers real calls.
 *
 * Nothing here needs any of that. The Management API takes one bearer token.
 *
 * WHY server-v2/.keys.json RATHER THAN A NEW FILE
 *
 * Because five seed scripts already read it, it is already gitignored, and a
 * second secret store is a second thing to rotate and forget. This adds one
 * key to a file that exists.
 *
 * WHAT THIS DOES NOT FIX
 *
 * A Supabase access token is issued against the ACCOUNT, not a project, so the
 * token in this file can still reach v1. `PROJECT` below is what keeps it off
 * v1, and it is deliberately the only place that decides -- one constant that
 * is obviously about which project, rather than three that happen to agree.
 * Narrowing the credential itself means a project-scoped key, which the
 * Management API does not issue.
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEYS = join(root, "server-v2", ".keys.json");
const PROJECT_FILE = join(root, "server-v2", ".project.json");

/** v1's project, shared with the live voice agents. Never a target from here. */
const V1 = "wremiarcmppuncgfzrqb";

/** The development project this repo has always pointed at. */
const DEFAULT_PROJECT = "izgbrdeybhbepftloxgk";

/**
 * Which project a migration lands in.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS OVERRIDABLE NOW
 *
 * It used to be one hardcoded constant, which was right while there was one
 * project. Running the accounts desk off in production means a second one --
 * same code, different database -- and a constant cannot be two things.
 *
 * `server-v2/.project.json` overrides it per machine and is gitignored, so
 * nobody's checkout silently decides for them. Without it, the development
 * project, which is what every existing script expected.
 *
 * WHAT IT WILL NOT ACCEPT
 *
 * v1's ref, ever. A Supabase access token is issued against the ACCOUNT and
 * reaches every project on it, so this value is the only thing standing between
 * a mistyped migration and the database answering real calls. Refusing the one
 * ref that must never appear is cheap and it is the whole guarantee.
 * ---------------------------------------------------------------------------
 */
export const PROJECT = (() => {
  let id;
  try {
    id = JSON.parse(readFileSync(PROJECT_FILE, "utf-8")).id;
  } catch {
    return DEFAULT_PROJECT;
  }

  if (!id) return DEFAULT_PROJECT;
  if (id === V1) {
    throw new Error(
      `server-v2/.project.json points at ${V1} — that is v1, which is shared with\n` +
        `the live voice agents. Refusing to continue.`
    );
  }
  return id;
})();

/** The project's REST/Auth origin, for seeds that talk to it directly. */
export const projectUrl = () => `https://${PROJECT}.supabase.co`;

/**
 * Fails loudly with the fix rather than sending `Bearer undefined` and letting
 * the caller read a 401 as "the migration is wrong".
 */
export function accessToken() {
  let raw;
  try {
    raw = readFileSync(KEYS, "utf-8");
  } catch {
    throw new Error(
      `No ${KEYS}.\n` +
        `Create it with your Supabase access token:\n` +
        `  { "access_token": "sbp_..." }\n` +
        `Generate one at https://supabase.com/dashboard/account/tokens`
    );
  }

  const token = JSON.parse(raw).access_token;
  if (!token) {
    throw new Error(
      `server-v2/.keys.json has no "access_token".\n` +
        `Add it: { "access_token": "sbp_...", ... }\n` +
        `Generate one at https://supabase.com/dashboard/account/tokens`
    );
  }
  return token;
}
