/**
 * Connects the signed-in person's own Outlook mailbox to their CRM session (095).
 *
 * ---------------------------------------------------------------------------
 * Two doors, one function, because Microsoft sends the browser back here:
 *
 *   POST { action: "start", return_to }    from the Mail page, signed in
 *     Notes the sign-in, a one-time state and a PKCE verifier (095), and
 *     answers { url }: Microsoft's sign-in, with the login's address filled in.
 *
 *   GET ?code&state                        Microsoft, sending the browser back
 *     Takes the note (once), trades the code for tokens, and asks Graph whose
 *     mailbox it is. Only if it is the CRM login's own (lib/outlookConnect.ts)
 *     is the refresh token kept, sealed, against that sign-in — the same row a
 *     Microsoft sign-in gets (094), renewed by outlook-token. Then back to the
 *     page it started from, with how it went in the fragment:
 *     #outlook=connected, #outlook=refused&as=…, #outlook=failed&why=….
 *
 * The CRM session is never touched: somebody signed in as info@ with a
 * password is still info@ afterwards, connected or not.
 *
 * verify_jwt is OFF — Microsoft's redirect carries no Supabase token. The
 * start checks the caller itself (the auth server, via getUser), and the
 * return is authorised by the one-time state alone.
 *
 * THE REDIRECT ADDRESS has to be registered on the Azure app, exactly:
 *   https://izgbrdeybhbepftloxgk.supabase.co/functions/v1/outlook-connect
 * (Azure → App registrations → the CRM app → Authentication → Web → Redirect
 * URIs). Until it is, Microsoft stops on its own page with AADSTS50011.
 * ---------------------------------------------------------------------------
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { b64u, seal, sealReady, sessionOf } from "./seal.ts";
import { APP_ORIGINS, microsoftAddress, microsoftSaid, outcomeFragment, returnTarget, sameMailbox, type ConnectOutcome, type MicrosoftMe } from "./outlookConnect.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const TENANT = Deno.env.get("MS_TENANT_ID");
const CLIENT_ID = Deno.env.get("MS_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("MS_CLIENT_SECRET");
const REDIRECT_URI = Deno.env.get("OUTLOOK_REDIRECT_URI") ?? `${SUPABASE_URL}/functions/v1/outlook-connect`;
const ORIGINS = [...APP_ORIGINS, ...(Deno.env.get("OUTLOOK_APP_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean)];

/** The same scopes the Microsoft sign-in asks for (src/lib/auth.tsx). */
const SCOPES = "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let CORS: Record<string, string> = {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => json({ error: message }, status);

/** Back to the page the connect started from, saying how it went. */
const back = (to: string, o: ConnectOutcome) =>
  new Response(null, { status: 302, headers: { Location: `${to}${outcomeFragment(o)}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

async function sha256(text: string): Promise<string> {
  return b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

const random = (n: number) => b64u(crypto.getRandomValues(new Uint8Array(n)));

// --- start -----------------------------------------------------------------

async function start(req: Request): Promise<Response> {
  const authorization = req.headers.get("Authorization") ?? "";
  const { data: who, error: whoErr } = await createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  }).auth.getUser();
  const claims = sessionOf(authorization);
  if (whoErr || !who.user || !claims || claims.sub !== who.user.id) return fail("Sign in first.", 401);
  const banned = (who.user as { banned_until?: string | null }).banned_until;
  if (banned && Date.parse(banned) > Date.now()) return fail("This account is disabled.", 403);
  if (!who.user.email) return fail("This login has no email address to connect.");

  let input: { action?: string; return_to?: string };
  try {
    input = await req.json();
  } catch {
    return fail("Body must be JSON.");
  }
  if (input.action !== "start") return fail("Unknown action.");
  const to = returnTarget(input.return_to ?? "", ORIGINS);
  if (!to) return fail("That page is not one this can return to.");

  const state = random(32);
  const verifier = random(48);
  const challenge = b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const { data: noted, error } = await admin.rpc("outlook_pending_put", {
    p_state_hash: await sha256(state),
    p_session: claims.session,
    p_user: who.user.id,
    p_verifier: verifier,
    p_return_to: to,
  });
  if (error) return fail(error.message, 500);
  if (!noted) return fail("This sign-in has ended. Sign in again.", 401);

  const url = new URL(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID!,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    response_mode: "query",
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Microsoft opens on this account; the check on the way back is what enforces it.
    login_hint: who.user.email,
  }).toString();
  return json({ url: url.toString() });
}

// --- the way back -------------------------------------------------------------

async function finish(url: URL): Promise<Response> {
  const state = url.searchParams.get("state");
  if (!state) return new Response("Nothing to connect.", { status: 400, headers: { "Content-Type": "text/plain" } });

  const { data: rows, error } = await admin.rpc("outlook_pending_take", { p_state_hash: await sha256(state) });
  const note = (rows as { session_id: string; user_id: string; verifier: string; return_to: string; fresh: boolean }[] | null)?.[0];
  if (error || !note) {
    return back(`${ORIGINS[0]}/mail`, { kind: "failed", why: "That Microsoft sign-in was already used, or was not started from the CRM. Connect Outlook again." });
  }
  const to = note.return_to;
  if (!note.fresh) return back(to, { kind: "failed", why: "The Microsoft sign-in took too long. Connect Outlook again." });

  const msError = url.searchParams.get("error");
  if (msError) {
    return back(to, {
      kind: "failed",
      why: msError === "access_denied" ? "The Microsoft sign-in was cancelled." : microsoftSaid(url.searchParams.get("error_description")) || msError,
    });
  }
  const code = url.searchParams.get("code");
  if (!code) return back(to, { kind: "failed", why: "Microsoft sent no sign-in back." });

  // The code for tokens.
  let tokens: { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  try {
    const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: note.verifier,
        scope: SCOPES,
      }),
    });
    tokens = await r.json().catch(() => ({}));
  } catch (e) {
    return back(to, { kind: "failed", why: `Microsoft could not be reached (${e instanceof Error ? e.message : e}).` });
  }
  if (!tokens.access_token) {
    const said = microsoftSaid(tokens.error_description);
    return back(to, {
      kind: "failed",
      why: tokens.error === "invalid_client" || /AADSTS7000215|AADSTS7000222/.test(said) ? "The CRM's Microsoft client secret is wrong or has expired. Tell your administrator." : said || tokens.error || "Microsoft refused the sign-in.",
    });
  }

  // Whose mailbox is it.
  const meR = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meR.ok) return back(to, { kind: "failed", why: `Microsoft would not say whose mailbox this is (${meR.status}).` });
  const me = (await meR.json()) as MicrosoftMe;

  const { data: person, error: personErr } = await admin.auth.admin.getUserById(note.user_id);
  if (personErr || !person.user?.email) return back(to, { kind: "failed", why: "This CRM login could not be read." });
  const banned = (person.user as { banned_until?: string | null }).banned_until;
  if (banned && Date.parse(banned) > Date.now()) return back(to, { kind: "failed", why: "This account is disabled." });

  if (!sameMailbox(person.user.email, me)) return back(to, { kind: "refused", as: microsoftAddress(me) });

  if (!tokens.refresh_token) {
    return back(to, { kind: "failed", why: "Microsoft did not let the CRM stay connected (no offline access). Tell your administrator." });
  }
  const { data: kept, error: keepErr } = await admin.rpc("outlook_link_put", {
    p_session: note.session_id,
    p_user: note.user_id,
    p_token: await seal(tokens.refresh_token, note.session_id),
    p_renewal: false,
  });
  if (keepErr) return back(to, { kind: "failed", why: keepErr.message });
  if (!kept) return back(to, { kind: "failed", why: "Your CRM sign-in ended while Microsoft was open. Sign in and connect again." });
  return back(to, { kind: "connected" });
}

Deno.serve(async (req) => {
  CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (!TENANT || !CLIENT_ID || !CLIENT_SECRET || !sealReady()) {
    const message = "Connecting Outlook is not set up on the server (MS_CLIENT_SECRET, OUTLOOK_TOKEN_KEY).";
    return req.method === "GET" ? back(`${ORIGINS[0]}/mail`, { kind: "failed", why: message }) : fail(message, 503);
  }

  try {
    if (req.method === "POST") return await start(req);
    if (req.method === "GET") return await finish(new URL(req.url));
    return fail("GET or POST.", 405);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return req.method === "GET" ? back(`${ORIGINS[0]}/mail`, { kind: "failed", why: message }) : fail(message, 500);
  }
});
