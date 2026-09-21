/**
 * Deploys a v2 Edge Function through the Management API.
 *
 *   node supabase-v2/deploy-function.mjs kb-sync
 *
 * The Supabase CLI is the normal route and is not installed here. The
 * Management API takes the same multipart upload the CLI sends, so the result
 * is identical.
 *
 * verify_jwt is OFF by default, which is what kb-sync and ingest-calls need:
 * they are called by pg_cron and by a button in the admin console, and turning
 * it on would make both fail with a 401 that the deploy itself would report as
 * success.
 *
 * Pass --verify-jwt for a function the BROWSER calls. Without it the URL is
 * open to anyone who finds it, and for a function that spends money per request
 * that is somebody else's bill running on your key.
 *
 *   node supabase-v2/deploy-function.mjs classify-enquiry --verify-jwt
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { accessToken, PROJECT } from "./token.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const TOKEN = accessToken();

const slug = process.argv[2];
const verifyJwt = process.argv.includes("--verify-jwt");
if (!slug) {
  console.error("usage: node supabase-v2/deploy-function.mjs <slug>");
  process.exit(1);
}

const dir = join(root, "supabase-v2", "functions", slug);

function walk(d) {
  return readdirSync(d).flatMap((entry) => {
    const p = join(d, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dir).filter((f) => /\.(ts|js|json)$/.test(f));

const form = new FormData();
form.append(
  "metadata",
  new Blob(
    [
      JSON.stringify({
        name: slug,
        entrypoint_path: "index.ts",
        verify_jwt: verifyJwt,
      }),
    ],
    { type: "application/json" }
  )
);

for (const f of files) {
  const rel = relative(dir, f).replace(/\\/g, "/");
  form.append("file", new Blob([readFileSync(f)], { type: "application/typescript" }), rel);
}

const r = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT}/functions/deploy?slug=${slug}`,
  { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: form }
);

const body = await r.text();
console.log(`deploy ${slug} -> ${r.status} (verify_jwt: ${verifyJwt})`);
if (!r.ok) {
  console.error(body.slice(0, 500));
  process.exit(1);
}
console.log(`  files: ${files.map((f) => relative(dir, f)).join(", ")}`);
console.log(`  url:   https://${PROJECT}.supabase.co/functions/v1/${slug}`);
