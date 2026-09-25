/**
 * Staff accounts, managed by an administrator (25 Sep 2026).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Public sign-up is switched off: until 25 Sep anybody could create an
 * account, and every new account became an employee with the run of the
 * desk. With it off, the only way in is an account an administrator made —
 * which needs the service key, which must never be in the browser. So the
 * browser asks this function, and this function checks the caller is an
 * administrator before doing anything.
 *
 * WHAT IT DOES
 *
 *   list           everybody, with role, how they sign in, last sign-in, and
 *                  whether they are disabled
 *   create         a person: email confirmed, role in app_metadata (never
 *                  user_metadata, which the user can write). No password by
 *                  default: they sign in with Microsoft, and the Microsoft
 *                  identity is linked to this account by its email
 *   set_role       employee or admin
 *   set_flags      may approve quotations, may assign enquiries
 *   set_password   one the administrator chooses: 10 or more characters, letters
 *                  and at least one number (the project's own rule since 26 Sep)
 *   set_disabled   signed out of everything, Outlook disconnected (094) and
 *                  unable to sign back in, or
 *                  let back in
 *
 * Nobody can disable or demote themselves, and the last administrator cannot
 * be demoted or disabled: the desk would have nobody left to undo it.
 * ---------------------------------------------------------------------------
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let CORS: Record<string, string> = {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => json({ error: message }, status);

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The project's password rule (Auth settings, 26 Sep 2026): 10 or more
 * characters, with letters and at least one number. Checked here as well so
 * the administrator reads this sentence rather than Supabase's refusal.
 */
const PASSWORD_RULE = "A password needs at least 10 characters, with letters and at least one number.";
const weakPassword = (pw: string) => pw.length < 10 || !/[a-z]/i.test(pw) || !/\d/.test(pw);
const FOREVER = "876000h";

type Role = "admin" | "employee";

async function everybody() {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const { data: profiles, error: e2 } = await admin.from("profiles").select("id, email, full_name, role, can_approve_quotes, can_assign");
  if (e2) throw new Error(e2.message);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  const now = Date.now();
  return data.users
    .map((u) => {
      const p = byId.get(u.id);
      const banned = (u as { banned_until?: string | null }).banned_until;
      return {
        id: u.id,
        email: u.email ?? p?.email ?? "",
        full_name: p?.full_name ?? (u.user_metadata?.full_name as string | undefined) ?? "",
        role: (p?.role ?? "employee") as Role,
        can_approve_quotes: Boolean(p?.can_approve_quotes),
        can_assign: Boolean(p?.can_assign),
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        // The listing carries no identities; app_metadata.providers says how they sign in.
        sign_in: [...new Set(((u.app_metadata?.providers as string[] | undefined) ?? (u.identities ?? []).map((i) => i.provider)).map((p) => (p === "azure" ? "microsoft" : p === "email" ? "password" : p)))],
        disabled: Boolean(banned && Date.parse(banned) > now),
      };
    })
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
}

async function activeAdmins(except?: string) {
  const people = await everybody();
  return people.filter((p) => p.role === "admin" && !p.disabled && p.id !== except).length;
}

Deno.serve(async (req) => {
  CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("POST.", 405);

  // Who is asking, and are they an administrator.
  const { data: who, error: whoErr } = await createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  }).auth.getUser();
  if (whoErr || !who.user) return fail("Sign in first.", 401);
  const { data: me } = await admin.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
  if (me?.role !== "admin") return fail("Administrators only.", 403);
  const self = who.user.id;

  let input: {
    action?: string;
    id?: string;
    email?: string;
    full_name?: string;
    role?: Role;
    password?: string;
    disabled?: boolean;
    can_approve_quotes?: boolean;
    can_assign?: boolean;
  };
  try {
    input = await req.json();
  } catch {
    return fail("Body must be JSON.");
  }

  try {
    switch (input.action) {
      case "list":
        return json({ people: await everybody() });

      case "create": {
        const email = (input.email ?? "").trim().toLowerCase();
        const name = (input.full_name ?? "").trim();
        const role: Role = input.role === "admin" ? "admin" : "employee";
        if (!EMAIL.test(email)) return fail("That is not an email address.");
        if (!name) return fail("Give their name.");
        if (input.password !== undefined && input.password !== "" && weakPassword(input.password)) return fail(PASSWORD_RULE);
        const { data, error } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          ...(input.password ? { password: input.password } : {}),
          user_metadata: { full_name: name },
          app_metadata: { role },
        });
        if (error) return fail(/already/i.test(error.message) ? "There is already an account for that email." : error.message);
        return json({ created: data.user?.id, people: await everybody() });
      }

      case "set_role": {
        if (!input.id) return fail("Whose role?");
        const role: Role = input.role === "admin" ? "admin" : "employee";
        if (input.id === self && role !== "admin") return fail("You cannot remove your own administrator role.");
        if (role === "employee" && (await activeAdmins(input.id)) === 0) return fail("That is the last administrator.");
        const { error } = await admin.auth.admin.updateUserById(input.id, { app_metadata: { role } });
        if (error) return fail(error.message);
        return json({ people: await everybody() });
      }

      case "set_flags": {
        if (!input.id) return fail("Whose permissions?");
        const patch: Record<string, boolean> = {};
        if (typeof input.can_approve_quotes === "boolean") patch.can_approve_quotes = input.can_approve_quotes;
        if (typeof input.can_assign === "boolean") patch.can_assign = input.can_assign;
        if (!Object.keys(patch).length) return fail("Nothing to change.");
        const { error } = await admin.from("profiles").update(patch).eq("id", input.id);
        if (error) return fail(error.message);
        return json({ people: await everybody() });
      }

      case "set_password": {
        if (!input.id) return fail("Whose password?");
        if (!input.password || weakPassword(input.password)) return fail(PASSWORD_RULE);
        const { error } = await admin.auth.admin.updateUserById(input.id, { password: input.password });
        if (error) return fail(error.message);
        return json({ people: await everybody() });
      }

      case "set_disabled": {
        if (!input.id) return fail("Who?");
        if (input.id === self && input.disabled) return fail("You cannot disable your own account.");
        const target = (await everybody()).find((p) => p.id === input.id);
        if (!target) return fail("No such person.", 404);
        if (input.disabled && target.role === "admin" && (await activeAdmins(input.id)) === 0) return fail("That is the last administrator.");
        const { error } = await admin.auth.admin.updateUserById(input.id, { ban_duration: input.disabled ? FOREVER : "none" });
        if (error) return fail(error.message);
        // Their Outlook connections go too, whatever sign-ins are still open (094).
        if (input.disabled) await admin.rpc("outlook_link_drop", { p_user: input.id });
        return json({ people: await everybody() });
      }

      default:
        return fail("Unknown action.");
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
});
