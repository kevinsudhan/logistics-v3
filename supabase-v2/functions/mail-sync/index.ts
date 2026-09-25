/**
 * Copies every CRM login's Outlook Sent Items into the mail log (087).
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *
 * Signs in to Microsoft as the CRM's own Azure app — the one people sign in
 * through — with the client-credentials grant, then for each mailbox in
 * `mail_sync_targets()` reads what it has sent since the last copy (the first
 * copy goes back 31 days) and records it through `record_sent_mail_server`,
 * the same upsert a person's session uses (086). The subject decides the kind
 * and the job (`mailLog.ts`, a copy of src/lib/mailLog.ts that a test keeps
 * identical).
 *
 * WHAT IT NEEDS FROM MICROSOFT
 *
 * The application permission Mail.ReadBasic.All on that app, with admin
 * consent. Until the tenant's admin grants it, Graph refuses every mailbox and
 * each one's refusal is recorded (`mail_sync_error`) for Team oversight to
 * show. Mail.ReadBasic.All leaves out the body and its preview, so preview is
 * asked for only if the app has been given Mail.Read instead; the first
 * refusal of it in a run drops it for the rest.
 *
 * WHO MAY CALL IT
 *
 * pg_cron every five minutes with the shared secret (MAIL_SYNC_SECRET, see
 * supabase-v2/set-mail-sync-secret.mjs), or an administrator's "Copy sent mail
 * now" on Team oversight. Nobody else.
 * ---------------------------------------------------------------------------
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { mailKind, refInSubject } from "./mailLog.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SYNC_SECRET = Deno.env.get("MAIL_SYNC_SECRET");
const TENANT = Deno.env.get("MS_TENANT_ID");
const CLIENT_ID = Deno.env.get("MS_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("MS_CLIENT_SECRET");

const FIRST_COPY_DAYS = 31;
const MAX_PAGES = 30;
const BATCH = 100;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let CORS: Record<string, string> = {};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class Refused extends Error {}

/** Microsoft's refusal, said in words the desk can act on. */
function explain(status: number, body: string): string {
  if (/AADSTS7000215|AADSTS7000222|invalid_client/i.test(body)) {
    return "Microsoft rejected the CRM app's client secret (wrong or expired). Renew it in Azure, put it in the CRM's Microsoft sign-in settings, and run set-mail-sync-secret again.";
  }
  if (/AADSTS700016|unauthorized_client/i.test(body)) {
    return "Microsoft does not know the CRM app in this tenant.";
  }
  if (status === 401 || status === 403 || /ErrorAccessDenied|Access is denied|Authorization_RequestDenied/i.test(body)) {
    return "Waiting for Microsoft permission: the Azure admin has to grant the CRM app Mail.ReadBasic.All (application) with admin consent.";
  }
  if (status === 404 || /ErrorInvalidUser|MailboxNotEnabledForRESTAPI|ResourceNotFound/i.test(body)) {
    return "No Exchange Online mailbox at this address.";
  }
  if (status === 429) return "Microsoft asked us to slow down; the next run will carry on.";
  return `Microsoft said ${status}: ${body.slice(0, 200)}`;
}

async function appToken(): Promise<string> {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const body = await r.text();
  if (!r.ok) throw new Refused(explain(r.status, body));
  return JSON.parse(body).access_token as string;
}

interface Addressee {
  name: string;
  address: string;
}
interface GraphMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  sentDateTime?: string;
  hasAttachments?: boolean;
}

const who = (r: { emailAddress?: { name?: string; address?: string } }): Addressee => ({
  name: r.emailAddress?.name ?? "",
  address: (r.emailAddress?.address ?? "").toLowerCase(),
});

/** Whether this run may ask for the preview line: null until the first answer. */
let previewAllowed: boolean | null = null;

async function sentSince(token: string, mailbox: string, sinceIso: string): Promise<GraphMessage[]> {
  const fields = ["id", "internetMessageId", "conversationId", "subject", "toRecipients", "ccRecipients", "sentDateTime", "hasAttachments"];
  const first = (withPreview: boolean) =>
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/sentitems/messages` +
    `?$select=${[...fields, ...(withPreview ? ["bodyPreview"] : [])].join(",")}` +
    `&$filter=${encodeURIComponent(`sentDateTime ge ${sinceIso}`)}` +
    `&$orderby=${encodeURIComponent("sentDateTime desc")}&$top=100`;

  const get = (url: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  let r = await get(first(previewAllowed !== false));
  if (r.status === 403 && previewAllowed !== false) {
    // Mail.ReadBasic.All: the preview is not ours to read. Try without it.
    const without = await get(first(false));
    if (without.ok) previewAllowed = false;
    r = without;
  } else if (r.ok && previewAllowed === null) {
    previewAllowed = true;
  }

  const out: GraphMessage[] = [];
  for (let page = 0; ; page++) {
    const body = await r.text();
    if (!r.ok) throw new Refused(explain(r.status, body));
    const data = JSON.parse(body) as { value?: GraphMessage[]; "@odata.nextLink"?: string };
    out.push(...(data.value ?? []));
    const next = data["@odata.nextLink"];
    if (!next || page + 1 >= MAX_PAGES) return out;
    r = await get(next);
  }
}

async function syncMailbox(token: string, mailbox: string, lastSent: string | null) {
  // A few minutes back from the last one seen, as the browser copy does; the
  // upsert makes the overlap harmless.
  const since = lastSent
    ? new Date(new Date(lastSent).getTime() - 5 * 60_000)
    : new Date(Date.now() - FIRST_COPY_DAYS * 86_400_000);
  const items = await sentSince(token, mailbox, since.toISOString().replace(/\.\d{3}Z$/, "Z"));
  const rows = items
    .filter((m) => m.internetMessageId && m.sentDateTime)
    .map((m) => ({
      graph_id: m.id,
      internet_message_id: m.internetMessageId,
      conversation_id: m.conversationId ?? null,
      sent_at: m.sentDateTime,
      subject: m.subject ?? "",
      preview: m.bodyPreview ?? "",
      to: (m.toRecipients ?? []).map(who),
      cc: (m.ccRecipients ?? []).map(who),
      has_attachments: m.hasAttachments ?? false,
      enquiry_ref: refInSubject(m.subject),
      kind: mailKind(m.subject),
    }));

  let n = 0;
  // An empty batch still marks the mailbox as checked.
  for (let i = 0; i === 0 || i < rows.length; i += BATCH) {
    const { data, error } = await db.rpc("record_sent_mail_server", { p_mailbox: mailbox, p_rows: rows.slice(i, i + BATCH) });
    if (error) throw new Error(error.message);
    n += Number(data ?? 0);
  }
  return n;
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST." }, 405);

  // The scheduler's secret, or an administrator. The anonymous key alone is not enough.
  const secret = req.headers.get("x-mail-sync-secret");
  const byCron = Boolean(SYNC_SECRET && secret && sameSecret(secret, SYNC_SECRET));
  if (!byCron) {
    const { data, error } = await createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    }).auth.getUser();
    if (error || !data.user) return json({ error: "Sign in first." }, 401);
    const { data: me } = await db.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
    if (me?.role !== "admin") return json({ error: "Administrators only." }, 403);
  }

  const { data: targets, error } = await db.rpc("mail_sync_targets");
  if (error) return json({ error: error.message }, 500);
  const list = (targets ?? []) as Array<{ mailbox: string; last_sent: string | null }>;

  if (!TENANT || !CLIENT_ID || !CLIENT_SECRET) {
    const message = "Server copy not set up yet: it needs a client secret for the CRM's Azure app (MS_CLIENT_SECRET).";
    for (const t of list) await db.rpc("mail_sync_error", { p_mailbox: t.mailbox, p_error: message });
    return json({ configured: false, error: message }, 503);
  }

  let token: string;
  try {
    token = await appToken();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    for (const t of list) await db.rpc("mail_sync_error", { p_mailbox: t.mailbox, p_error: message });
    return json({ configured: true, error: message, mailboxes: list.map((t) => ({ mailbox: t.mailbox, error: message })) }, 502);
  }

  previewAllowed = null;
  const results: Array<{ mailbox: string; recorded?: number; error?: string }> = [];
  for (const t of list) {
    try {
      results.push({ mailbox: t.mailbox, recorded: await syncMailbox(token, t.mailbox, t.last_sent) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.rpc("mail_sync_error", { p_mailbox: t.mailbox, p_error: message });
      results.push({ mailbox: t.mailbox, error: message });
    }
  }
  return json({ configured: true, preview: previewAllowed, mailboxes: results });
});
