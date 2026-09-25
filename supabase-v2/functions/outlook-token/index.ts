/**
 * Keeps a signed-in person's Outlook connected past the hour (094).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The browser calls Microsoft Graph with the access token Supabase hands back
 * at the Microsoft sign-in, and that token lives about an hour. Microsoft also
 * hands back a refresh token, which buys a new access token without asking the
 * person anything — but only together with the Azure app's client secret,
 * which must never be in the browser. So:
 *
 *   link    once, straight after the Microsoft sign-in: the browser sends the
 *           refresh token. It is redeemed at once (so a bad one is found out
 *           now, not in an hour) and the one Microsoft sends back is kept,
 *           sealed, against this sign-in. The fresh access token goes back.
 *   token   whenever the browser's access token has run out: a new one, from
 *           the kept refresh token, which is replaced by the one Microsoft
 *           rotates in.
 *
 * Both answer { access_token, expires_in }. When Microsoft has ended the
 * connection — the password changed, access was revoked, 90 days unused — the
 * answer is 409 with { reconnect: true }, the kept token is forgotten, and the
 * browser offers "Connect Outlook" as before.
 *
 * WHOSE TOKEN
 *
 * The kept token belongs to one Supabase sign-in (the session id in the
 * caller's JWT), is deleted with it at sign-out (094's foreign key), and is
 * only ever handed to a request carrying that same sign-in. The token itself
 * only reaches the mailbox of the person who signed in to Microsoft: it is
 * delegated, as before. Nothing here widens what anybody can reach; it only
 * stops it expiring mid-afternoon.
 *
 * SEALING
 *
 * AES-GCM with OUTLOOK_TOKEN_KEY (32 random bytes, base64, in this function's
 * secrets: supabase-v2/set-outlook-key.mjs) and the session id as associated
 * data, so the database alone holds nothing usable and a sealed token copied
 * onto another sign-in's row does not open.
 * ---------------------------------------------------------------------------
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const TENANT = Deno.env.get("MS_TENANT_ID");
const CLIENT_ID = Deno.env.get("MS_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("MS_CLIENT_SECRET");
const SEAL_KEY = Deno.env.get("OUTLOOK_TOKEN_KEY");

/** The same scopes the sign-in asks for (src/lib/auth.tsx). */
const SCOPES = "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let CORS: Record<string, string> = {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => json({ error: message }, status);
const reconnect = (message: string) => json({ error: message, reconnect: true }, 409);

// --- sealing ---------------------------------------------------------------

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

let keyP: Promise<CryptoKey> | null = null;
const sealKey = () => (keyP ??= crypto.subtle.importKey("raw", unb64u(SEAL_KEY!), "AES-GCM", false, ["encrypt", "decrypt"]));

async function seal(plain: string, session: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(session) }, await sealKey(), new TextEncoder().encode(plain));
  return `${b64u(iv)}.${b64u(new Uint8Array(ct))}`;
}

async function unseal(sealed: string, session: string): Promise<string | null> {
  const [iv, ct] = sealed.split(".");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv), additionalData: new TextEncoder().encode(session) }, await sealKey(), unb64u(ct));
    return new TextDecoder().decode(pt);
  } catch {
    // Another sign-in's row, or a key that has since been replaced.
    return null;
  }
}

// --- Microsoft ---------------------------------------------------------------

type Exchange =
  | { ok: true; access_token: string; expires_in: number; refresh_token: string }
  | { ok: false; ended: boolean; message: string };

/**
 * Redeems a refresh token. `ended` is Microsoft saying the connection is over
 * (invalid_grant, interaction_required): forget it and ask for a new sign-in.
 * Anything else — the client secret expired, Microsoft unreachable — is ours
 * to fix and is not the person's fault, so their connection is kept.
 */
async function exchange(refresh: string): Promise<Exchange> {
  let r: Response;
  try {
    r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, grant_type: "refresh_token", refresh_token: refresh, scope: SCOPES }),
    });
  } catch (e) {
    return { ok: false, ended: false, message: `Microsoft could not be reached: ${e instanceof Error ? e.message : e}` };
  }
  const body = await r.json().catch(() => ({}));
  if (r.ok && body.access_token) {
    return { ok: true, access_token: body.access_token, expires_in: Number(body.expires_in) || 3600, refresh_token: body.refresh_token ?? refresh };
  }
  const code = String(body.error ?? r.status);
  // "AADSTS700082: The refresh token has expired due to inactivity…", before the trace ids.
  const said = String(body.error_description ?? "").split(/\r?\n| Trace ID:/)[0].trim();
  if (code === "invalid_grant" || code === "interaction_required") {
    return { ok: false, ended: true, message: said || code };
  }
  if (code === "invalid_client" || /AADSTS7000215|AADSTS7000222/.test(said)) {
    return { ok: false, ended: false, message: "The CRM's Microsoft client secret is wrong or has expired (MS_CLIENT_SECRET)." };
  }
  return { ok: false, ended: false, message: said || `Microsoft answered ${r.status}` };
}

// --- the request ---------------------------------------------------------------

/** The Supabase session id from a JWT the gateway has already verified. */
function sessionOf(authorization: string): { sub: string; session: string } | null {
  try {
    const part = authorization.replace(/^Bearer\s+/i, "").split(".")[1];
    const claims = JSON.parse(new TextDecoder().decode(unb64u(part)));
    return claims.sub && claims.session_id ? { sub: claims.sub, session: claims.session_id } : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("POST.", 405);

  if (!TENANT || !CLIENT_ID || !CLIENT_SECRET || !SEAL_KEY) {
    return fail("Keeping Outlook connected is not set up on the server (MS_CLIENT_SECRET, OUTLOOK_TOKEN_KEY).", 503);
  }

  // Who is asking. getUser asks the auth server, so a signed-out or disabled
  // account is refused even while its JWT has minutes left to run.
  const authorization = req.headers.get("Authorization") ?? "";
  const { data: who, error: whoErr } = await createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  }).auth.getUser();
  const claims = sessionOf(authorization);
  if (whoErr || !who.user || !claims || claims.sub !== who.user.id) return fail("Sign in first.", 401);
  const banned = (who.user as { banned_until?: string | null }).banned_until;
  if (banned && Date.parse(banned) > Date.now()) return fail("This account is disabled.", 403);
  const user = who.user.id;
  const session = claims.session;

  let input: { action?: string; refresh_token?: string };
  try {
    input = await req.json();
  } catch {
    return fail("Body must be JSON.");
  }

  try {
    switch (input.action) {
      case "link": {
        const given = (input.refresh_token ?? "").trim();
        if (!given) return fail("No refresh token.");
        const got = await exchange(given);
        if (!got.ok) return got.ended ? reconnect(`Microsoft would not keep Outlook connected: ${got.message}`) : fail(got.message, 502);
        const { data: kept, error } = await admin.rpc("outlook_link_put", {
          p_session: session,
          p_user: user,
          p_token: await seal(got.refresh_token, session),
          p_renewal: false,
        });
        if (error) throw new Error(error.message);
        if (!kept) return fail("This sign-in has ended.", 401);
        return json({ access_token: got.access_token, expires_in: got.expires_in });
      }

      case "token": {
        const { data: sealed, error } = await admin.rpc("outlook_link_get", { p_session: session, p_user: user });
        if (error) throw new Error(error.message);
        const refresh = sealed ? await unseal(sealed as string, session) : null;
        if (!refresh) return reconnect("Outlook is not connected on this sign-in.");
        const got = await exchange(refresh);
        if (!got.ok) {
          if (!got.ended) return fail(got.message, 502);
          await admin.rpc("outlook_link_drop", { p_session: session });
          return reconnect(`Microsoft ended the Outlook connection: ${got.message}`);
        }
        const { error: e2 } = await admin.rpc("outlook_link_put", {
          p_session: session,
          p_user: user,
          p_token: await seal(got.refresh_token, session),
          p_renewal: true,
        });
        if (e2) throw new Error(e2.message);
        return json({ access_token: got.access_token, expires_in: got.expires_in });
      }

      default:
        return fail("Unknown action.");
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
});
