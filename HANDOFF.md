# Handoff — Araxys CRM v2

The freight desk for **Aashish Logistics Global**. This file covers `araxys-crm-v2` only.
v1 (`../araxys-crm`) is a separate, older codebase on a different Supabase project and a
different branch; it is not to be touched from here.

Written 14 September 2026, revised 21 September, **revised again 24 September 2026**. A
new session should read this whole file before changing anything. §0 is the short version.

---

## 0. Start here (new session)

- **Live site:** https://logisticsdemosif.netlify.app. It is **in real use**, with real
  enquiries and shipments created by the desk. Treat the database as production.
- **Deploy:** `git push logistics-v3 v2:main`. Netlify builds `main` of
  `github.com/kevinsudhan/logistics-v3` on every push. There is no other deploy step.
- **Before every push:** `npm test` (46 suites) and `npm run build` (typecheck, bundle and
  secret scan) must both pass.
- **Run SQL against live data:** `node supabase-v2/run-sql.mjs "select …"`, or pass a
  migration filename (§6). The last migration is **096**, so the next one is `097-….sql`.
- **Where things stand:** the tree is clean at the head in §11, everything is pushed, and
  §9 lists what is open.
- **How the user works:** they want short, direct replies and a push after each feature.
  Verify on the running system (preview screenshots, then grep the deployed chunks) before
  saying something is done. §7 covers how.

---

## 1. Do these first

### Rotate credentials

These were pasted into a chat transcript during development and must be treated as
compromised:

| Credential | Where to rotate |
|---|---|
| **Supabase personal access token** (in `server-v2/.keys.json`) | supabase.com/dashboard/account/tokens: revoke it, create a new one, put it back in `.keys.json` |
| Gemini API key `AQ.Ab8RN6Iq…` | aistudio.google.com, then update the `GEMINI_API_KEY` function secret |
| Azure client secret `JX38Q~…` | Entra ID → app registration → Certificates & secrets |
| Azure client secret made on 25 Sep for mail-sync (`MS_CLIENT_SECRET`) | Same place: add a new one, put it in `.keys.json` as `ms_client_secret`, run `node supabase-v2/set-mail-sync-secret.mjs`, then delete the old one in Azure |
| SnapServe `sk_live_705b5d…` | SnapServe account (v1 only; v2 does not use it) |
| Anthropic `sk-ant-api03-YN9atg…` | console.anthropic.com (not used by v2) |

The Supabase token is issued against the **account**, so it can reach v1 as well. That makes
it the most urgent of these. `TRACK_CRON_SECRET` is stored in three places: the function
secrets, Vault, and `.keys.json`. Rotate all three together with
`node supabase-v2/set-track-secret.mjs`.

### Decide on the Gemini billing question

`classify-enquiry` runs on Gemini's **free tier against live customer mail**. Under Google's
unpaid terms, submitted content may be used to improve their products and may be seen by
human reviewers. India is not covered by the EEA/UK/Swiss carve-out, and under the DPDP Act
Aashish Logistics is the data fiduciary for the transfer.

**Enabling billing on the Google Cloud project changes those terms with no code change.** It
costs a few hundred rupees a month at this volume, and it also removes the free-tier 503s.
Until then the function retries and falls back to `GEMINI_FALLBACK_MODELS`.

---

## 2. What it is, and where the data lives

A React + TypeScript + Vite + Tailwind front end for a freight forwarder and consolidator:

- enquiry intake from mail, with quoting and approval;
- shipments, run as a tabbed job file;
- tracking with a customer page;
- documents and mail;
- job P&L;
- a full accounts ledger.

It installs to an iPhone home screen as an app (§12).

### Backend

v2 has its own Supabase project, `izgbrdeybhbepftloxgk`. v1's project is
`wremiarcmppuncgfzrqb`, and nothing here should ever point at it.

- The browser holds **only the anon key**, and every call runs through **RLS as the
  signed-in user**. The client is built in `src/lib/supabase.ts`.
- Anything that needs more privilege is either a `SECURITY DEFINER` RPC in a migration or an
  Edge Function.
- `scripts/check-bundle-secrets.mjs` fails the build if a service-role key reaches the bundle.
- `WORKSPACE-V2.md` still says "v2 has no backend". **That is stale.** It dates from 28
  August, when everything ran on the in-memory mock.
- `services/backend.ts` still routes a handful of legacy paths (the space and records
  surface) to `mockBackend.ts`. `netlify.toml` keeps `VITE_MOCK_BACKEND=on` and
  deliberately leaves `VITE_API_BASE` unset, so nothing can reach v1.

### Edge Functions (7)

| Function | What it does | Secrets |
|---|---|---|
| `classify-enquiry` | Gemini reads a mail and extracts enquiry fields; mode `hbl` reads a B/L PDF or scan into boxes (088, high media resolution) | `GEMINI_API_KEY`, `GEMINI_FALLBACK_MODELS` |
| `track-shipment` | Flight, vessel and container positions; hourly cron sweep (073) | `AISSTREAM_API_KEY`, `AERODATABOX_KEY`, `AERODATABOX_VIA=direct`, `TRACK_CRON_SECRET` |
| `staff-accounts` | The admin console's Staff accounts: list, add (email confirmed, role in app_metadata), role, may-approve and may-assign flags, password, disable and enable. Admin callers only; refuses to disable or demote yourself or the last admin | none beyond the defaults |
| `db-backup` | The nightly backup into the `backups` bucket, 30 days kept, each run in `backup_runs`; for an admin, the run list with download links and "Back up now" | `BACKUP_SECRET` (`set-backup-secret.mjs`) |
| `outlook-token` | Keeps Outlook connected past Microsoft's hour (094). `link`: the browser hands over the Microsoft refresh token once after the Microsoft sign-in; it is redeemed and the rotated one kept, sealed, against that Supabase sign-in. `token`: a fresh access token from it. 409 `{reconnect}` when Microsoft has ended the connection | `OUTLOOK_TOKEN_KEY` (`set-outlook-key.mjs`), and the three `MS_*` below |
| `outlook-connect` | "Connect Outlook" on the Mail page (095), for a login of any kind. POST `start` (checks the caller itself) answers Microsoft's sign-in URL with the login's address filled in; Microsoft returns the browser to the GET, which connects the mailbox **only if it is the login's own** (`lib/outlookConnect.ts`, copied into the function) and goes back to the Mail page with `#outlook=connected / refused / failed`. **verify_jwt OFF** (Microsoft's redirect has no Supabase token): deploy without `--verify-jwt`. Its address must be a Web redirect URI on the Azure app | `OUTLOOK_REDIRECT_URI` (pinned), `OUTLOOK_TOKEN_KEY`, the three `MS_*`; optional `OUTLOOK_APP_ORIGINS` for another site to return to |
| `mail-sync` | Every CRM login's Sent Items into `mail_log`, app-only Graph; cron every 5 minutes (087), or an admin's button | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MAIL_SYNC_SECRET` |

Deploy a function with `node supabase-v2/deploy-function.mjs <slug>` (`--verify-jwt` for
`track-shipment` and `mail-sync`: the cron sends the anon key and the shared secret).
`node supabase-v2/set-mail-sync-secret.mjs` sets mail-sync's tenant, client id and scheduler
secret (and `MS_CLIENT_SECRET` from `ms_client_secret` in `server-v2/.keys.json`, if present).

On the Supabase account but not in this repo: `kb-sync` and `ingest-calls` (orphans from
the voice-agent era) and a `SNAPSERVE_API_KEY` secret. **Whether to delete them is the
user's call.**

### Flags (`netlify.toml` → `src/lib/features.ts`)

| Flag | Default in code | Set on the live site |
|---|---|---|
| `VITE_ACCOUNTS_DESK` | off | `on` |
| `VITE_CASE_FILE` | mail only | `full` |

**Check `netlify.toml` before saying a feature is off in production.**

---

## 3. Routes — 57 page components

### Sidebar, in order

| Section | Pages |
|---|---|
| (top) | Overview |
| Pipeline | **Enquiries** `/intake` · Inbound enquiries `/enquiries` · My enquiries · Quote approvals `/approvals` · In-process shipments · Completed shipments |
| (separate item) | **Job closing** `/job-closing` |
| Operations | **Sailing schedule** `/sailing-schedule` · Consoles · Documentation · Rate master `/rates` · Mail · Complaints |
| Customers | Directory `/customers` |
| Agents & partners | Partner mail · Directory `/partners` |
| Accounts (flag) | 14 pages under `/accounts/*` |
| Insights | Analytics |
| Admin (admins only) | Team oversight |

- **`/intake`** is an overview of how many enquiries are inbound, in process and completed,
  with the Excel register download and the mails still waiting to be sent to inbound.
- **`/sailing-schedule`** is the only sailings page. Each departure's containers are listed
  under it. `/containers` and `/space-containers` redirect here.

### Public pages (no sign-in)

- `/q/:token`: the customer accepts a quotation.
- `/t/:token`: the customer tracking page.

### The shipment job file

`/shipments/:id` has these tabs: overview · mail · parties · cargo · bill · documents ·
pickup-delivery · warehouse · customs · tracking · sign-off · containers. With the accounts
flag on, it also has invoices and costs.

---

## 4. Data model — 93 migrations

`supabase-v2/001…096`, applied in order with `run-sql.mjs` (each file runs as one
transaction).

| Range | What it establishes |
|---|---|
| `001–029` | profiles and signatures, mail linking, partners, intake, web enquiry, assignment, oversight, containers, partner RFQ |
| `030–042` | **the money model**: invoices, lines, series, payments and allocations, bills, agent statements, quote lines, consoles, gapless numbering. `041` dropped the voice-agent tables |
| `043–049` | shipment numbering, ALG/PALG references, reply log, consol details, enquiry files |
| `050–058` | customers directory, rate master, **quote approval**, the acceptance link, quote grid |
| `059–066` | checkpoints, service details, cargo dimensions, edits reset approval, in-process shipment, **progress model** (dated steps with owners) |
| `067–071` | pickup/delivery, warehouse receipts, tracking links, sign-off, sailing schedules |
| `072–078` | live tracking plus cron, customer tracking page, HAWB, route map, customs clearance, pre-alert |
| `079` | pickup and delivery desk: multiple movements per job, with attempts, LR, e-way bill and proof |
| `080` | `quotes` added to the `supabase_realtime` publication |
| `081` | `enquiries`, `shipments`, `intake` and `shipment_checkpoints` added to it too |
| `082` | the console's master B/L copied to its jobs (`mainline_no`); console and numbering functions closed to `anon` |
| `083` | free time: the job's free days and D&D rates (`shipments`), six clock dates per box (`shipment_containers`) |
| `084` | every other table on an enquiry or a job added to the realtime publication (28 tables in all) |
| `085` | the house B/L as a document (`house_bills`, history, `number_hbl`, lock); partners get `mto_registration` and `address` |
| `086` | `mail_log` (every mail each mailbox sent: recipients, subject, preview, job, kind) and `mail_log_mailboxes` (when each was last checked); `record_sent_mail`, `mail_log_since`; both live |
| `087` | the server's copy of every mailbox: `mail_log_upsert` (the one writer), `record_sent_mail_server`, `mail_sync_error`, `mail_sync_targets` (service role only); `server_error` per mailbox; cron `araxys-v2-mail-sync` every 5 minutes |
| `088` | a house B/L somebody else issued, received on our job (`received_house_bills`: issuer, their number and reference, draft → confirmed → final, corrections, release mode, the boxes, their PDF, release ticks and our DO); their number copied to `shipments.forwarders_bl_no`; `shipment_customs` gets `igm_subline`, `csn_no`, `csn_filed_on`, `cfs_code` |
| `089` | releasing our own house B/L: `house_bills` gets charges received, originals handed over (to whom), originals back (how many), release sent (to whom), released at destination, a note; `house_bill_write` refuses a release before issue, a telex release before every original is back, and reopening while an original is out; history action `released`; timeline events |
| `090` | the console's cargo manifest sent: `consoles.manifest_sent_at`, `manifest_sent_to`, `manifest_bills`, `manifest_provisional` |
| `091` | self-approval of a quotation: `quotes.self_approved`, `self_approval_reason`, `self_approval_reviewed_at/by`, `self_approval_review_note`; `self_approve_quote(id, reason)` (reason ≥ 10 chars, not over a rejection) and `review_self_approval(id, withdraw, note)` (admins; withdraw only while unsent); `require_approval_to_send` lets the first through by a transaction-local flag `app.self_approving` |
| `092` | **the anonymous key reaches nothing but the customer's two pages.** Revoked from `anon` on every public table, view and sequence. Revoked from `public, anon` on every function except `quote_by_token`, `accept_quote_by_token`, `shipment_tracking`, `shipment_track_points` and `shipment_customs_public`; `authenticated` keeps what it had, granted by name. Default privileges changed so new objects are closed too |
| `096` | the last security-advisor findings: the 13 functions without a fixed `search_path` get `''` (each read first: built-ins and `public.`-qualified names only); the 14 reporting views get **`security_invoker = true`**, so they read as the person asking and the tables' RLS holds. Only `partner_reply_log` changed in effect: employees now see their own replies, as 045 and replyLog.ts intended (through the owner-rights view they saw everyone's). Verified by snapshotting every view as each of the 5 staff before and after: no other difference |
| `095` | Connect Outlook from inside the CRM: `private.outlook_pending` (a one-time note per connect: state hash, sign-in, PKCE verifier, page to return to; deleted with its sign-in, refused after 15 minutes, taken once); `outlook_pending_put / _take`, service role only |
| `094` | Outlook stays connected: `private.outlook_links` (one row per Supabase sign-in, keyed by `auth.sessions.id` **on delete cascade**, so a sign-out deletes it; the refresh token sealed by the function); `outlook_link_put / _get / _drop`, service role only; cron `araxys-v2-outlook-links-prune` (22:30 UTC) drops rows unused for 3 days (tabs closed without signing out). The `private` schema is outside the API and the backup |
| `093` | nightly backups: `backup_export()` / `backup_export_text()` (service role only) write every public table, the accounts without passwords and the file list; the private bucket `backups`; `backup_runs` (admins read); cron `araxys-v2-db-backup` at 21:30 UTC (03:00 IST) |

**Everything on an enquiry or a job is live (084).** Whoever has a page open sees another
person's change as it is made.

- **The job file and the case file** each open one channel for the job or enquiry and every
  table under it, filtered to that record (`useLiveVersions` in `src/lib/liveVersions.tsx`,
  with `SHIPMENT_TABLES` and `ENQUIRY_TABLES`). The page re-reads its own header for the
  tables that feed it. Each tab or panel re-reads for its own tables by putting
  `useLiveVersion("table", …)` in its load effect's dependencies.
- **A form with unsaved edits must not reload under the user.** `HawbForm` shows the pattern:
  it reloads only when clean, and otherwise offers "Load theirs".
- **List pages** (Overview, the boards, In-process, Completed, Job closing, Consoles) call
  `useTablesChanges([[table, filter], …], onChange)` from `src/lib/useTableChanges.ts`; the
  callback is told which tables moved.
- **Deletes:** Realtime cannot filter a delete, so a filtered watch also listens for deletes
  on the whole table.
- **To make a new table live:** add it to the publication in a migration (copy 084), then to
  the lists above or the page's watch list.
- **A loader must not write to a table it listens to,** or every open copy of the page
  refreshes itself in a loop. Every loader was checked for this on 25 September.

**Team oversight (`/oversight`, 086)** is the admin's live view of the desk, behind the
admin role and the oversight password.

- **Tabs:** Activity (one feed of mail sent, enquiry events and job steps ticked, grouped by
  day), Mail sent (per mailbox, with the recipients, kind, job and preview), People (counts
  per person, enquiries held, jobs in process, the companies they wrote to), and Enquiries
  (the older view: arrival, taken on, timeline).
- **Filters:** the period (today, yesterday, 7 days, 30 days, this month), the person and a
  search narrow every tab. The pure logic is `lib/oversight.ts` and `lib/mailLog.ts`.
- **Where the mail comes from:** each mailbox's Outlook **Sent Items**, which covers mail
  sent from Outlook itself too. Two copiers write to `mail_log`:
  - **The server (087).** The `mail-sync` edge function signs in as the CRM's Azure app
    (app-only, client credentials) and copies every CRM login's mailbox
    (`mail_sync_targets()` = every profile email) every 5 minutes by pg_cron. The first copy
    goes back 31 days. Its rows have `synced_by` null, so only admins read them.
    **Running since 25 September.** The first run copied 510 mails: parasu@ 438, info@ 69,
    aashish@ 3, aarathy@ and imports@ none in 31 days. When Microsoft refuses a mailbox, the
    refusal goes in `server_error` and the Mail sent tab shows it.
    The Graph permission granted returns an empty `bodyPreview`, so server rows have no
    preview.
  - **Each person's browser (086)**, via `services/mailLog.ts`: 4 s after the app opens,
    every 5 minutes, when the tab comes back into view, and 8 s after each send from the CRM.
    The first copy goes back 14 days. It is the only source of Outlook's preview line,
    because `Mail.ReadBasic.All` excludes it; the server's upsert never blanks a preview.
  - The Mail sent tab lists each mailbox with when it was last checked and by whom (a
    session or the server), in amber after a day, and any server error.
    **Copy sent mail now** runs both copiers.
- **Who owns a mail:** it belongs to the person whose login is that mailbox. A shared
  mailbox (info@) is credited to whoever's session copied it, and the mailbox is shown
  beside it.
- **Only the essentials are kept:** subject, recipients and Outlook's 255-character preview,
  not the body. RLS lets admins read all rows and anyone else only rows their own session
  recorded. Rows arrive only through `record_sent_mail`.

---

## 5. Services and libraries

`src/services/` holds 47 modules. The ones added since 21 September are:

- `attachments` · `autoFill` · `charges` · `checkpoints` · `customers` · `customs`
- `enquiryDimensions` · `enquiryRegister` · `geocode` · `hawb` · `jobPnl` · `liveTracking`
- `movements` · `paging` · `publicQuote` · `quoteApproval` · `rateMaster` · `replyLog`
- `schedules` · `shipmentExtras` · `signoff` · `threadRefs` · `tracking` · `warehouse`

Pure logic lives in `src/lib/` so that it can be tested under Node:

- **Mail:** `brandedMail` (the letterhead), `quotationMail`, `confirmationMail`,
  `preAlertMail`, `trackingLinkMail`, `shipmentUpdateMail`.
- **Reports:** `jobPnl`, `enquiryRegister`, `xlsx` (a hand-written xlsx writer with a
  `report` layout), `xlsxRead`.
- **Operations:** `movements`, `customs`, `hawb`, `progress`, `worklist`, `routeModel`,
  `seaRoute`.

`src/services/paging.ts` provides `all()` and `whereIn()` for reading more than PostgREST's
1000-row page.

---

## 6. Commands

```bash
npm run dev                          # :5174
npm run build                        # tsc -b && vite build && check-bundle-secrets
npm test                             # 46 suites, pure logic
npm run preview -- --port 4173       # the built app, service worker included
node supabase-v2/run-sql.mjs 081-something.sql      # apply a migration
node supabase-v2/run-sql.mjs "select count(*) from public.enquiries"   # quick query
node supabase-v2/deploy-function.mjs track-shipment
git push logistics-v3 v2:main        # deploy
```

The workspace root `.claude/launch.json` (one level up, outside this repo) has
`araxys-crm-v2-build` for serving the build in the preview pane.

---

## 7. Testing and verification

### Unit tests

There are 46 suites in `scripts/tests/*.test.ts`, run with tsx. Each is registered as its
own script and chained into `npm test`. When you add a suite, add it to both.

The UI has no automated tests. It is verified by hand in the way described below.

### How features were verified (keep doing this)

1. **Preview harness.**
   - Add a temporary `__Preview…` route in `App.tsx` that stubs `supabase.from` and
     `supabase.rpc` with fake rows and renders the real page.
   - Screenshot it with headless Edge:
     `"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --screenshot=out.png --window-size=1440,900 <url>`.
   - Edge will not go below about 500px wide. For phone views, render the page inside an
     iframe from a temporary page in `public/`.
   - **Delete the route and any temporary files before committing.**
2. **Live data, read-only.** Use `run-sql.mjs`. For a check that must not change anything,
   run it inside a `do $$ … $$` block ending with `raise exception 'RESULTS %', r::text`. The
   work rolls back and the findings come back in the error. To impersonate a user:
   ```sql
   perform set_config('request.jwt.claims',
     json_build_object('sub', uid::text, 'role','authenticated')::text, true);
   set local role authenticated;
   ```
3. **After the push.** Wait for Netlify, then `curl` the live `index.html`, find the chunk,
   and grep it for a string that only the new code contains. Grep each chunk on its own,
   because a short pattern can match another component.

### Not verified yet

- **Signing in.** It needs a password, which the assistant does not type, so no signed-in
  screen has been checked in a real session.
- **Realtime between two users.** It was checked at the database level: an update delivered
  an UPDATE event with the enquiry filter (080), and a same-value update on `intake` reached
  an unfiltered and a row-filtered subscriber but not one filtered to another row (081). The
  pages were checked in a preview harness with a stubbed channel: each subscribes to the
  right tables and filters, and a burst of events causes one reload. For 084, a same-value
  update on `enquiry_events` reached the enquiry's own subscriber and not another's, and the
  job file and case file were each shown to hold one channel and to re-read only the tab or
  panel whose table moved. Two people watching a change land in real sessions has not been
  observed.
- **Microsoft sign-in inside the iPhone home-screen app.** Standalone mode can open the
  OAuth redirect in Safari.
- **In a real mailbox:** that a reply nests in its Outlook thread, and that the logo
  (inlined by cid) renders in a received quotation or confirmation.

---

## 8. Traps that cost real time

- **Both GitHub repositories are public.** Never commit customer data, keys or passwords.
  `backups/` and `server-v2/.keys.json` are gitignored for that reason. Check with
  `git check-ignore` before adding any new local data folder.

- **Supabase grants `anon` every new table, view and function by default.** 092 changed the
  default privileges. Still, check anything new with `has_function_privilege('anon', …)`.
  A view or `SECURITY DEFINER` function runs past RLS.
- **Sending without Outlook used to "succeed" into the demo mailbox.** `sendMail` and
  `sendTrackedMail` now throw on the live site. The demo mailbox is only for `vite dev`
  (`import.meta.env.DEV`).

- **Theme colours are plain `var(--…)`**, so Tailwind's opacity modifier
  (`bg-bg-danger/40`, `border-text-accent/25`) generates nothing and the style silently
  vanishes. Use the full colour; three backgrounds were fixed on 25 Sep.
- **iPad Safari counts the toolbars in `100vh`.** A page exactly `min-h-screen` tall scrolls
  by a toolbar's height. Use `.screen-min` / `.screen-lock-lg` in `index.css` (100vh then
  100dvh in one rule). Tailwind emits `min-h-dvh` *before* `min-h-screen`, so writing both
  classes leaves the vh one winning.

- **The Browser pane downloads a PDF instead of showing it** (the user gets a save dialog),
  and headless Chrome renders PDFs blank. To check a PDF's layout, read its text positions
  with pypdf's `visitor_text`.

- **The Management API returns the Azure sign-in secret as a SHA-256 hash** (64 hex
  characters), not the secret. Copying it anywhere gives `AADSTS7000215`. A client secret
  for app-only use has to be created in Azure.
- **`supabase-v2/functions/mail-sync/mailLog.ts` is a copy of `src/lib/mailLog.ts`**, since
  the deploy uploads only the function's folder. `test:maillog` fails when they differ.
  After editing one, copy it over the other and redeploy the function.

**A new function is callable by anyone until PUBLIC is revoked.** Postgres grants EXECUTE to
PUBLIC by default, so `grant … to authenticated` alone leaves the anonymous key in the bundle
able to call it. Every migration that creates a function needs
`revoke execute on function … from public, anon;` (075 and 070 do it; 035 did not, see 082).

**Never pass SQL as a PowerShell argument.** PowerShell 5.1 cuts a native argument at an
embedded double quote, so `node run-sql.mjs "$(Get-Content x.sql -Raw)"` sent half of 085 and
committed it (harmless, as it was additive and re-runnable, but not what was meant). Put the
migration in `supabase-v2/` and pass its file name, or send a file's text from Node.

**Heredocs mangle backslashes.** Writing code through a bash heredoc turns `\n` into a real
newline. Use the Edit/Write tools, or write a Python script to the scratchpad and run it.

**Prettier defaults to 80 columns; this repo is 160.** Use `--print-width 160` or leave
formatting alone.

**supabase-js sends four headers.** The CORS preflight for an Edge Function must allow
`authorization, x-client-info, apikey, content-type`. If it allows fewer, the error is
*"Failed to send a request to the Edge Function"*.

**Graph threading needs `createReply`, not `sendMail`.** Also, `internetMessageHeaders` is
not in Graph's default fields, and `$select` replaces the defaults rather than adding to them.

**Email HTML must be table-based with inline styles.**

- The rich-text editor's sanitiser (`RichTextEditor.tsx`) allows email tables, `bgcolor`
  and a set of whitelisted style properties. If you narrow it, **a quotation collapses the
  moment someone edits it in the compose box.**
- Do not set DOMPurify's `ALLOWED_URI_REGEXP`. It applies to every attribute, not only URLs.
- Images keep a `max-width`.

**The logo in mail is carried inline by cid.** `lib/inlineBrand.ts` and `graphMail`'s
`outgoing()` swap `/brand/*.jpg` for an inline attachment when the mail is sent. The preview
shows the same-origin URL.

**Month names come from a list, never the locale.** `toLocaleDateString` prints "Sept" in both
`en-IN` and `en-GB`. Use `formatDate(value, { day, month, year, hour, minute, hour12, timeZone })`
from `src/lib/dates.ts`: it takes the same options and spells months itself. Every screen, mail
and PDF was moved onto it on 25 September; a grep for `month: "short"` next to `toLocale`
should find nothing. Rupee amounts use `en-IN` grouping. The financial year runs April to March,
so Q1 is April to June. Days are counted in IST.

**`.card` must live in `@layer components`,** or it overrides utility classes. `surface-inset`
is a CSS variable but not a Tailwind colour; only `surface-0/1/2` exist as utilities.

**A table added to the publication is not live straight away.** The first test after 080
missed the event; a retry a moment later received it.

**Do not click download buttons in the browser pane.** It opens a save dialog on the user's
screen.

---

## 9. Open items

### Waiting on the user

- Rotating credentials and the Gemini billing decision (§1).
- **Hapag-Lloyd tracking API:** deferred by the user (`HLAG_CLIENT_ID`/`HLAG_CLIENT_SECRET`).
- **AeroDataBox rejects the key as "Invalid or inactive".** Direct plans have no free tier.
  The free Basic plan is only on RapidAPI (`AERODATABOX_VIA=rapidapi`) or API.market
  (`apimarket`), each with its own key. **The assistant must not sign up for accounts.**
- **aisstream works but hears almost nothing.** It has no shore receivers near India or the
  Gulf.
- **The server's mail copy (087)** runs on the Azure app
  `efb90aa6-9404-40d2-be1b-3b6a3d5f5866` with application permission `Mail.ReadBasic.All`
  (admin-consented) and the client secret made on 25 September.
  - The secret expires on whatever date was chosen in Azure. When it does, every mailbox
    shows "Microsoft rejected the CRM app's client secret". Renew it as in §1.
  - Optional: an Exchange `ApplicationAccessPolicy` can limit the app to the desk's
    mailboxes. That is the user's call.
- The orphan functions `kb-sync` and `ingest-calls`, and the `SNAPSERVE_API_KEY` secret:
  delete them or not.
- The 3D planner (`ContainerPlanView`, `ContainerScene`, `lib/scene3d`) is no longer
  referenced by any page since the sailings merge. Delete it or not.

### Live data worth knowing (24 September)

- Totals: 9 enquiries, 2 shipments (both `booked`, one created today by the desk), 4 quotes
  (3 accepted), 0 invoices, 0 bills.
- **ALG09004-26 has an accepted quote with test values:** ₹3 sell against ₹24.6L cost. It
  shows as a large loss on Job closing. Ask the user before changing it.
- Older intake mails are still waiting on the Enquiries page. Clearing them is the desk's
  job, not a code change.

### Product gaps

- **Free time (083)** is counted in `lib/freeTime.ts` from dates the desk types per box. Nothing fills those dates yet: tracking's `discharged`/`gate_out` events (072) and the pickup/delivery moves (079) could suggest them. The tariff is one rate per day; slab tariffs and holiday rules are not modelled. LCL (CFS storage) is not counted.
- **Sea bills (082).** The master B/L is entered once on the console and the database copies it
  to every job on it (`shipments.mainline_no`). A job not on a console has its master typed on
  the Bill tab. The pre-alert, tracking, the worklist search and the arrival notice, delivery
  order and B/L particulars read it. The house B/L is numbered `HBL/26-27/0001`, the FY series.
  **The user chose to keep that format on 25 September** over a port-based one like the HAWB's
  (`MAA/JEA/HBL0000001`); do not change it.
- **House B/L document (085)** — the sea twin of the HAWB (075).
  - The Bill tab of a sea job that issues our own HBL shows `HblForm`, with Fetch details,
    Save (numbers it on the first save that names a consignee), Print, History, release mode,
    originals and Issued, which locks it; only an admin can reopen it.
  - Release modes are original B/Ls (1–3), telex release, and express release. Express is a
    non-negotiable sea waybill with 0 originals, named consignee only; the database enforces it.
  - The PDF is `lib/documents/hblPdf.ts`: a draft, the originals ("ORIGINAL 1 OF 3"), or a
    copy.
  - **It is issued under a partner's MTO registration** (user, 25 Sep): the partner record has
    `mto_registration` and `address`, the form picks the partner, and the name and number are
    copied onto the B/L. When Aashish gets its own MTO number, add it as a partner-like source
    or a company setting.
  - **Decided with the user (25 Sep):** they will file CSN themselves as the console agent for
    Indian imports; they use all three release modes; they will send their own HBL design
    later, and until then it is the standard layout.
  - **Added on 25 Sep, from the user's sample B/L (World Jaguar's QDWJ26093202):**
    - Consignee and notify IEC and GSTIN, and the consignee's contact, printed under the
      address.
    - "Said to contain" as its own tick.
    - A freight table (charge, revenue tons, rate, prepaid, collect; OCEAN FREIGHT / AS
      ARRANGED by default, following the freight terms).
    - Cargo insurance: not covered, or covered by the attached policy.
    - Our form and the received one share the boxes, in `components/HblBoxes.tsx`.
  - **Release (089).** Once our B/L is issued, `components/HblRelease.tsx` shows the steps
    for its mode (logic in `lib/hblRelease.ts`):
    - original: charges received → originals handed over, to whom → released at destination.
    - telex: charges → (originals out, optional) → the full set back, counted → telex release
      sent → released.
    - express: charges → release instructions sent → released.

    "Write the telex release" opens the mail composer, addressed to the destination agent (the
    Party tab's destination agent, else the console's agent, else the routed agent), with the
    release text. Sending it ticks the step.

    Unpaid invoices on the job show beside "charges received". Handing over originals or
    releasing without the charges ticked asks first. "Released" waits for the step that lets
    the agent release.

    The database refuses:
    - a release on a draft;
    - a telex release before all originals are back;
    - reopening, even by an admin, while an original is out.
- **Self-approval of quotations (091, user's request 25 Sep).**
  - Anyone who needs approval can press **Approve it myself** on the quote instead of
    "Send for approval". It needs a reason of a sentence or more, which is stored on the quote
    and on the timeline (`quote_self_approved`).
  - Admins see self-approvals on **Quote approvals** under "Self-approved — for your review",
    with the reason and the sale/buy/profit. They can mark it "Seen — fine", or "Withdraw the
    approval" (with a note, only while the quote is unsent), which makes it rejected.
  - The sidebar's Quote approvals item shows a live count: the queue for approvers, plus the
    unreviewed self-approvals for admins.
  - A quote an approver sent back cannot be self-approved. An edit after approval resets it
    to draft (064), so it needs a new reason.
  - The rule in `require_approval_to_send` still refuses a direct `approval_status` change by
    a non-approver. Only `self_approve_quote` passes, by setting `app.self_approving` for its
    own transaction; a PostgREST request cannot set it.
- **Outlook stays connected (094).** Until 25 Sep the Microsoft access token from the sign-in
  died after about an hour and every send failed until the person signed in with Microsoft
  again. Now:
  - After the Microsoft sign-in, `adoptMicrosoftSession` (graphMail.ts) sends the refresh
    token to `outlook-token` once; the fresh access token it returns (and its expiry) goes into
    sessionStorage as before.
  - Every Graph call goes through `graphFetch`: under two minutes left, it renews first; on a
    401 it renews once and retries (a 401 means nothing was done, so a resend is safe). One
    renewal at a time, however many calls are waiting.
  - Only when Microsoft itself refuses (password changed, access revoked, 90 days unused) does
    the mailbox say "Connect Outlook again". A hiccup renewing keeps the connection.
  - The connection is per sign-in, as before: signing out deletes the Supabase session, which
    deletes the kept token (foreign key). Disabling a person on Staff accounts drops all theirs.
  - Redeeming needs `MS_CLIENT_SECRET`. If that secret expires in Azure, renewals fail with
    "The CRM's Microsoft client secret is wrong or has expired" and mail-sync stops too: make a
    new one and run `set-mail-sync-secret.mjs`.
  - Password sign-ins connect with "Connect Outlook" on the Mail page (095, below), and from
    then on stay connected the same way.
- **Connect Outlook only to the login's own mailbox (095).** Until 25 Sep "Connect Outlook"
  was the Microsoft sign-in itself, which replaced the CRM session with whichever account
  signed in: info@ connecting as aashish@ became aashish@, an admin.
  - Now it is a separate Microsoft sign-in run by `outlook-connect`. The CRM session is never
    touched. Microsoft opens on the login's address (`login_hint`), and on the way back the
    function asks Graph whose mailbox it is: the login's own (primary address or sign-in name,
    not an alias) is connected; anything else is refused and named.
  - The result comes back in the URL fragment and is shown once on the Mail page. A fragment the
    tab did not start (a link somebody sends) is ignored.
  - **The Azure app needs the Web redirect URI**
    `https://izgbrdeybhbepftloxgk.supabase.co/functions/v1/outlook-connect`. Without it Microsoft
    stops after the sign-in with AADSTS50011. Microsoft only checks it after a sign-in, so it
    cannot be probed from outside.
  - "Sign in with Microsoft" on the sign-in page is unchanged: the CRM account there *is* the
    Microsoft account (linked by email), so its mailbox always matches.
- **The mail editor: Outlook's formatting, what-you-see-is-what-they-get (26 Sep).**
  `components/RichTextEditor.tsx` (+ `editor/EditorMenus.tsx`), used by compose, the signature
  and Ask partners.
  - **Toolbar:** undo/redo, font, size (pt), B/I/U/S, sub/superscript, highlight, font colour
    (+ any colour), bullets, numbering, indent, alignment, link (Ctrl+K), pictures, a table grid
    (with row/column actions while in a cell), a rule, clear formatting.
  - **Shortcuts:** Ctrl+] / Ctrl+[ size, Ctrl+Shift+L bullets, Ctrl+Space clear, Tab in lists
    and tables.
  - **Still the browser's own contentEditable, on purpose:** designed mails (the quotation) are
    table layouts that a schema editor would rebuild and break.
  - **The page is the mail.** It is white and set in `lib/mailStyle.ts`'s font, size and colour,
    which are the values `asOutgoingHtml` wraps the send in. `index.css` puts back the mail-client
    defaults that Tailwind's preflight strips inside `.rich-editor` (bullets, p/heading spacing,
    inline images); without them the editor showed a different mail.
  - **Paste and quotes keep their look.** `lib/mailHtml.ts` `inlineForeign` folds a pasted or
    quoted `<style>` (Word's MsoNormal, Excel's .xl65 borders) into the elements before cleaning.
  - **Trap: Chrome's insertHTML rewrites `border:` shorthands and drops the line style,** so the
    cleaner writes every border as four per-side shorthands, which it keeps (`sideBorders`).
    Inserted tables draw right/bottom lines per cell (plus top/left on the edges) because
    insertHTML also strips `border-collapse`.
  - **Pictures** (inserted, pasted or dropped) are uploaded to the public `signatures` bucket.
    At send, `outgoing()` carries every picture of ours (logo and bucket) as an inline `cid:`
    attachment while it fits the 3MB, and gives any picture without one a `width`: Outlook
    ignores max-width.
  - **For Outlook, `forOutlook`** writes the inherited font, size and colour onto every table cell
    (Word does not inherit into tables) and gives links Outlook's blue.
  - **Reply, Reply all, Forward** (`lib/mailQuote.ts`) quote under Outlook's
    From/Sent/To/Cc/Subject header. Forward goes through Graph `createForward` (`forwardTracked`),
    so the original's attachments and inline pictures travel. Bcc is on every send path, and the
    compose window can be made bigger.
- **Views read as the person asking (096).** Every reporting view has `security_invoker = true`.
  **`create or replace view` resets it:** a migration that redefines a view must say
  `create or replace view … with (security_invoker = true) as …`, or the advisor flags it again
  and the view silently ignores RLS. New functions get `set search_path = ''` and write names as
  `public.…`.
- **Backups (093).** Nightly at 03:00 IST: every public table, the accounts (no passwords)
  and the stored-file list, as `db/YYYY-MM-DD.json.gz` in the private `backups` bucket, 30
  days kept. The admin console shows whether last night's ran (red after 26 hours or a
  failure), the files, and "Back up now".
  - **Tested restore:** `node supabase-v2/restore-backup.mjs --test` rebuilds every table
    from today's file in a scratch schema with all 135 foreign keys and compares each with
    live. On 25 Sep, 60 tables loaded and all matched except `backup_runs`, which gains its
    own row after the export.
  - **To restore for real:** a project with the migrations applied and no data, then
    `--restore <file>`. It recreates the accounts with their ids and no password, loads
    parents before children, generated columns computed, identity kept, user triggers off
    during the load, sequences moved past, all in one transaction.
  - **A copy off Supabase:** `node supabase-v2/backup-download.mjs` pulls the backups and
    every stored file into `backups/` on the machine it runs on (gitignored). Run it
    regularly: a lost project takes its bucket with it.
  - The export used to be parsed into JavaScript numbers on the way (48500.00 became
    48500). The function now files Postgres's own text.
  - **The Free plan has no managed backups.** Pro (about $25/month) adds daily snapshots of
    the whole database with schema, as a second line. The user's action in the dashboard.
- **Console cargo manifest (090).** On Consoles, an open console has a manifest section
  (`components/ConsoleManifest.tsx`; logic in `lib/consoleManifest.ts`; PDF in
  `lib/documents/manifestPdf.ts`).
  - It lists one line per job on the console, taken from its house B/L as saved: ours, or
    the received one when the job travels under the origin agent's. A job with no B/L saved
    uses its own fields.
  - Each line has the house B/L, shipper, consignee with IEC/GSTIN, notify, marks and
    container, packages, goods, gross weight, CBM, freight and release mode, with totals at
    the end.
  - Outputs: an A4 landscape PDF (header repeated on each page; the last line always shares
    a page with the totals) and an Excel sheet in the report layout.
  - "Mail it to <agent>" writes to the console's overseas agent with both files attached.
    Sending records when, to whom and how many house bills.
  - The section says "N added since — send it again" when the count has changed since.
  - It is **provisional** (in the title, subject and footer) while any B/L is a draft, a job
    has no B/L, the MBL number or vessel is missing, or a weight is missing. A provisional
    manifest can still be sent; the section lists why.
- **A B/L somebody else issued, received (088).** On a sea job whose Bill tab says "The origin
  agent's house B/L", the tab shows `components/ReceivedHbl.tsx`. An import job with no
  `bl_type` defaults to this.
  1. **Read their B/L.** It files the PDF on the Documents tab ("House B/L (agent's)") and
     reads the boxes through `classify-enquiry` mode `hbl`. On the sample it read every box
     right at high media resolution, in about 10 s. Nothing is saved until Save.
  2. **Check against the job** (`lib/receivedHbl.ts`, `checkAgainstJob`). Names are compared
     without Pvt Ltd, ports by the words they share, weights within a kilo or 0.5%, and CBM
     within 2%.
     - "Copy the corrections for the agent" writes the list and puts it on the clipboard.
     - "Fill the job's blanks from it" writes only empty job fields.
  3. **The stages** are draft → confirmed → final. Each one saves, and confirm and final leave
     a line on the case-file timeline (`hbl_received`, `hbl_confirmed`, `hbl_final`,
     `do_issued`).
  4. **Manifest (CSN), imports only.**
     - The fields: IGM number and date, the master's line, this B/L's sub-line, CFS code, CSN
       number and filed-on date.
     - They are saved on the import customs record, started if there is none. The Customs tab
       shows the same IGM fields.
     - The countdown runs to ETA − 72 hours, IST. **72 hours is the desk's rule as agreed, not
       a quoted regulation.**
  5. **Release, imports only.** The checklist is: the final B/L in; one original surrendered,
     or the telex received, or nothing for express; freight collect and local charges paid.
     When all are done, "Issue the DO" dates it with a validity period. The DO and the arrival
     notice print their number (`documentDataFromBooking` reads `forwarders_bl_no` when
     `bl_type` is `forwarder`).
- On air, the HAWB form's MAWB boxes do not write `shipments.mainline_no`, so an air pre-alert
  has no MAWB unless one is recorded some other way.
- **Security: closed on 25 Sep (092); what is left.**
  - With the public anon key alone, anyone could read the 14 reporting views (customer
    balances, margins) and call 88 `SECURITY DEFINER` functions, 24 of them with no caller
    check. 092 closed all of it. Checked from outside: 401 on the views and on
    `create_customer`, while the customer pages still answer.
  - **Sign-ups are closed (25 Sep):** `disable_signup: true`. Before that, anyone could
    create an account, and `handle_new_user` made it an employee with full access. Staff are
    now added on the admin console (**Staff accounts**, the `staff-accounts` function).
  - **The starter password was public (25 Sep).** Both GitHub repositories
    (`logistics-v3`, `araxys-crm`) are **public**. `seed-users.mjs` had set all five
    accounts to the same starter password, and all five, admin included, still had it.
    - It was replaced with a random one nobody holds, and removed from the script. It
      remains in the git history, where it no longer works.
    - Aashish, Parasu and info@ sign in with Microsoft. Imports@ and Aarathy need Microsoft
      sign-in or a password set on Staff accounts.
    - **Make the repositories private** (the user's action on GitHub). No other secret is
      in the history; the history was scanned on 25 Sep.
  - Also: minimum password length 6, leaked-password protection off, 13 functions without
    a fixed `search_path`, and the 14 views are still security definer (staff-only now).
- Shipment row ids are still `ARX-SHP-0004`. Nothing printed or mailed shows them any more
  (documents are numbered `BKG-ALG09004-26`, see `documentNo` in `lib/documents/data.ts`),
  but the job file header and the enquiry register's booking-number fallback still do.
- No full end-to-end demo has been run yet. A dummy enquiry mail was written for one: send
  it in, push it to inbound, then quote, approve, accept and book.

---

## 10. Standing constraints

- **Do not touch v1** (`../araxys-crm`, project `wremiarcmppuncgfzrqb`). It shares a
  SnapServe account with live voice agents answering real calls.
- **Priya and Arun's prompts** (in v1's `snapserve-setup/`) are the user's own work. Do not
  edit them without an explicit instruction.
- **The service-role key stays in gitignored files** (`server-v2/.keys.json`), never in the
  bundle. Never print secret values.
- **Checks against the database must not change real data.** Roll back or restore. The
  database is now in real use.
- **The assistant does not create accounts, sign up for API keys, or type passwords.**
- **Remove temporary tokens, preview routes and harness files** after testing, and before
  any commit.
- **No dummy data** beyond what `seed-showcase.mjs` creates, which is prefixed `DEMO-`.

---

## 11. Repository state

- Branch **`v2`**. There are two remotes:
  - `logistics-v3` (`github.com/kevinsudhan/logistics-v3`): **the deploy.** Push with
    `git push logistics-v3 v2:main`.
  - `origin` (`github.com/kevinsudhan/araxys-crm`): v1's repo. `origin/v2` is 63 commits
    behind and nothing reads it. **Do not push v2 to `origin/main`,** which is v1's branch.
- The working tree is clean and everything is pushed to `logistics-v3/main`.
- Commit style: a sentence-case subject that describes what the user can now do, a body
  explaining why, and the `Co-Authored-By` trailer.

---

## 12. What changed since 21 September

There are 63 commits. Grouped:

| Area | Commits | What the user can now do |
|---|---|---|
| Inbound desk | `fc00d4e` → `71b42ce` | Consol details, rate master, quoting with approval, a customer directory, service details, cargo dimensions. Editing an approved quote sends it back for approval |
| Quote approvals | `b51a843`, `24f6104` | Sale, buy and profit per quote. **Approvals appear live** for users with lower access |
| In-process job | `fa520d5` → `d6b7de4` | A tabbed job file with a progress model, warehouse, and sign-off with a checklist and lock |
| Tracking | `2a76afd` → `997c132` | Live flight, vessel and container tracking; a customer tracking page with a route map; the link emailed from the job |
| HAWB, customs, pre-alert | `82183f9`, `16a8e18`, `1a87a3d` | The house air waybill as a form; export and import clearance; a pre-alert to the destination agent |
| Worklist | `5fa9346` | In-process search, filters, a table view, Excel export, badges |
| Pickup & delivery | `35f6c1c` | Several movements per job, with attempts, LR, e-way bill, handover, proof and cost, plus a transport order by mail |
| Sailings | `f9d22f0`, `b909da9` | **One sailing schedule page.** Containers sit under their departure |
| Enquiry register | `6b50cd7`, `669cc75` | An Excel report in the style of their `ENQUIRY FILES.xlsx`, with sheets for inbound, in process and completed |
| Enquiries overview | `669cc75` | `/intake` shows the counts per stage, the download, and the mails waiting to be sent to inbound |
| Branded mail | `83bebd7`, `3904a0c` | Quotation and booking confirmation on a navy letterhead with the logo |
| Job closing | `f40ed51` | P&L per job, and per day, week, month, quarter and financial year, with a chart and an Excel export |
| Loading states | `3aa303a` | Skeletons, a start-up screen with the app icon, inline dots |
| Mail | `565c878` | The message list stays in view while a long thread scrolls |
| iPhone app | `24f6104` | Add to Home Screen gives a standalone app with the user's logo as the icon |
| Realtime desk (081) | `a15f629` | Enquiries, shipments, intake and job steps update live on every list and file page |
| Printed documents | `763a153` | PDFs numbered `BKG-ALG09004-26` (no `ARX-`), on the navy letterhead with the mail's logo |
| House B/L (085) | see `git log` | The house B/L as a form on the Bill tab: release mode, originals, issued under a partner's MTO, numbered, locked when issued, history, and a printed draft, originals or copy |
| Live everywhere (084) | see `git log` | Every change on an enquiry or a job, by anybody, shows on everybody's open page: every tab of the job file, every panel of the case file, the boards, Job closing and Consoles |
| Dates | see `git log` | "Sep", never "Sept", on every screen, mail and PDF (`lib/dates.ts`) |
| Free time (083) | see `git log` | Free days and D&D rates per job; each box's clocks on the Containers tab; an alert on the job file header and the worklist (badge, "Free time running out" filter, urgency sort, Excel column); the terms on the arrival notice |
| Team oversight (086, 087) | see `git log` | A live view of the desk: every mail each mailbox sent and to whom (from Outlook too), enquiries taken on, quoted and booked, job steps ticked, per person and per period. A server copy of every mailbox every 5 minutes |
| Sign-ups closed, staff accounts, backups (093) | see `git log` | Only an admin adds staff (Staff accounts); the leaked starter password is dead; a tested nightly backup with a status card, downloads and a restore script |
| Mail editor with Outlook's formatting | see `git log` | Font, size, colours, highlight, lists, alignment, links, pictures, tables; the editor shows exactly what the recipient's Outlook shows; paste from Word/Excel/Outlook keeps its look; Reply all, Forward (with the attachments) and Bcc |
| Connect Outlook to your own mailbox (095) | see `git log` | Password logins connect Outlook from the Mail page without signing in again, and only to their own mailbox: info@ cannot connect aashish@ |
| Outlook stays connected (094) | see `git log` | No more "sign in again" an hour after signing in: the server renews the Microsoft token silently for as long as the person stays signed in |
| Quote self-approval (091) | see `git log` | Approve a quotation yourself with a reason; the reason goes to the admins' review list with a sidebar count; admins accept or withdraw while unsent |
| iPad sign-in | see `git log` | The sign-in no longer scrolls or bounces on iPad (dvh) |
| Console manifest (090) | see `git log` | Every house B/L under a console on one PDF and Excel sheet, mailed to the destination agent; provisional until every B/L is final; flags house bills added since it was sent |
| Our B/L's release (089) | see `git log` | After issue: charges received, originals handed over and to whom, the full set back for a telex release, the telex release written to the destination agent and sent, released at destination; each on the history and the timeline, with the rules held by the database |
| Received house B/L (088) | see `git log` | The origin agent's B/L read in from their PDF, checked against the job, corrections for the agent, the job's blanks filled; the CSN with its ETA − 72h countdown; the release checklist and our DO against their number. Our own B/L gained IEC/GSTIN, said to contain, a freight table and cargo insurance |
| Sea master bill (082) | see `git log` | The console's MBL reaches its jobs; master typed on the Bill tab off a console; printed on the arrival notice, DO and B/L particulars |

### Details of the iPhone app (`24f6104`)

- `public/manifest.webmanifest` sets `display: standalone`, a navy background and a white
  theme.
- `public/icons/` holds apple-touch-icon 180, 192, 512, a maskable 512 and a favicon, all made
  from the user's logo (`63.webp`, 2000×2000).
- `public/sw.js` is network-first for pages and cache-first for `/assets/`. It is registered
  in `main.tsx` for production builds only.
- `netlify.toml` serves `sw.js` and the manifest with `no-cache`, so a deploy reaches
  installed apps the next time they open.
- **Bump `VERSION` in `sw.js`** if a change to its caching must replace old caches.
- The safe-area padding lives in `index.css` under `@media (display-mode: standalone)`.
