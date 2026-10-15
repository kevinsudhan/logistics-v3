# Handoff — the freight forwarding and console CRM (v2)

The freight desk for **Aashish Logistics Global**, built by Araxys. This file covers v2 only:
the local checkout `araxys-crm-v2`, deployed from `github.com/kevinsudhan/logistics-v3`.
v1 (`../araxys-crm`) is a separate, older codebase on a different Supabase project and a
different branch; it is not to be touched from here.

Written 14 September 2026, revised 21, 24 and 28 September, **last revised 1 October 2026**
(§0, §9 and §11 rewritten to match the code at the head; the feature write-ups that had
collected under §9 moved to §13, their open points gathered into §9). Dated notes in §8 run to 1 October. A new
session should read this whole file before changing anything. §0 is the short version.

---

## 0. Start here (new session)

- **The desk is open again since 5 October 2026** (the user's word). It was closed for
  maintenance from 29 September (`eea5b5a`); `netlify.toml` now sets `VITE_MAINTENANCE =
  "off"`, so https://logisticsdemosif.netlify.app is the whole desk with its sign-in, and the
  customers' pages (`/q/` quotation, `/t/` tracking, `/b/` draft house B/L) as before. To
  close it again, set the flag to `"on"` and push: then only those customer pages answer.
  Everything built from 29 Sep on (pasting a quotation, the DSR, the Revise button, the rate
  table, the consol build plan's steps) is first used by the desk from 5 Oct. §9 still lists
  the decisions that were to be settled first.
- **The database is production all the same.** It holds the desk's real enquiries, shipments
  and customers, and customers can still open their links. The maintenance flag only changes
  the front end's build: the crons (mail copy, backups, tracking, Sunday rates) live in the
  database and are not touched by it. Checks must not change real data (§10).
- **Deploy:** from `araxys-crm-v2`, `git push logistics-v3 v2:main`. Netlify builds `main`
  of `github.com/kevinsudhan/logistics-v3` on every push; there is no other deploy step. A
  fresh clone of logistics-v3 has the branch as `main` and the remote as `origin` instead
  (`git push origin main`). Never push v2 to `origin/main` of `araxys-crm-v2`, which is
  v1's branch; `origin/v2` is kept level with the deploy (§11).
- **Before every push:** `npm test` (60 suites) and `npm run build` (typecheck, bundle and
  secret scan) must both pass.
- **Run SQL against live data:** `node supabase-v2/run-sql.mjs "select …"`, or pass a
  migration filename (§6). The last migration is **139**, so the next one is `140-….sql`.
  Reads of production may need the user's permission in a session; ask rather than work
  around a refusal.
- **Both GitHub repositories are public** (an anonymous clone of logistics-v3 worked on
  1 Oct). Nothing secret is in them or their history, but staff addresses, the project ref and
  this file are. Never commit anything that should not be read by strangers (§8). Making them
  private is the user's action (§9).
- **Where things stand:** §11 for the repository, §9 for what is open, in order.
- **How the user works:** they want short, direct replies and a push after each feature.
  Verify on the running system (preview screenshots, then grep the deployed chunks) before
  saying something is done. §7 covers how. While the desk is in maintenance, a change to a
  signed-in screen cannot be seen on the live site at all: check it on the dev server or a
  preview harness, and say that is where it was checked.

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
Until then the function falls back to `GEMINI_FALLBACK_MODELS` and then its built-in list.

On 28 Sep 2026 the free tier stopped the mail autofill altogether: every Gemini model answered
503 "high demand" (Gemma timed out), and the old last resort, `gemini-2.5-flash`, now answers
404 "no longer available to new users". The function now tries each model once with a 20-second
timeout inside a 60-second budget, and answers 200 with `error` saying which it was (overloaded,
out of quota, refused); the case file shows that on the fill strip instead of swallowing it. The
fix that makes it dependable is billing.

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
- `services/backend.ts` is now only the mail client: Graph once Outlook is connected, the
  in-memory mailbox in `mockBackend.ts` before that (sending into it is refused outside
  `vite dev`). The voice era's calls, records and space board, and the `VITE_MOCK_BACKEND`
  and `VITE_API_BASE` switches, were removed on 1 Oct; nothing called them.

### Edge Functions (8)

| Function | What it does | Secrets |
|---|---|---|
| `classify-enquiry` | Gemini reads a mail and extracts enquiry fields; mode `hbl` reads a B/L PDF or scan into boxes (088, high media resolution) | `GEMINI_API_KEY`, `GEMINI_FALLBACK_MODELS` |
| `track-shipment` | Flight, vessel and container positions; hourly cron sweep (073). Files what it hears for the desk; **applies nothing** since 102 (a person records the milestone) | `AISSTREAM_API_KEY`, `AERODATABOX_KEY`, `AERODATABOX_VIA=direct`, `TRACK_CRON_SECRET` |
| `staff-accounts` | The admin console's Staff accounts: list, add (email confirmed, role in app_metadata), role, may-approve and may-assign flags, password, disable and enable. Admin callers only; refuses to disable or demote yourself or the last admin | none beyond the defaults |
| `db-backup` | The nightly backup into the `backups` bucket, 30 days kept, each run in `backup_runs`; for an admin, the run list with download links and "Back up now" | `BACKUP_SECRET` (`set-backup-secret.mjs`) |
| `outlook-token` | Keeps Outlook connected past Microsoft's hour (094). `link`: the browser hands over the Microsoft refresh token once after the Microsoft sign-in; it is redeemed and the rotated one kept, sealed, against that Supabase sign-in. `token`: a fresh access token from it. 409 `{reconnect}` when Microsoft has ended the connection | `OUTLOOK_TOKEN_KEY` (`set-outlook-key.mjs`), and the three `MS_*` below |
| `outlook-connect` | "Connect Outlook" on the Mail page (095), for a login of any kind. POST `start` (checks the caller itself) answers Microsoft's sign-in URL with the login's address filled in; Microsoft returns the browser to the GET, which connects the mailbox **only if it is the login's own** (`lib/outlookConnect.ts`, copied into the function) and goes back to the Mail page with `#outlook=connected / refused / failed`. **verify_jwt OFF** (Microsoft's redirect has no Supabase token): deploy without `--verify-jwt`. Its address must be a Web redirect URI on the Azure app | `OUTLOOK_REDIRECT_URI` (pinned), `OUTLOOK_TOKEN_KEY`, the three `MS_*`; optional `OUTLOOK_APP_ORIGINS` for another site to return to |
| `mail-sync` | Every CRM login's Sent Items into `mail_log`, app-only Graph; cron every 5 minutes (087), or an admin's button | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MAIL_SYNC_SECRET` |
| `live-rates` | The Sunday rate requests (101): `weekly` from pg_cron (Sun 20:30 IST since 117, re-runs every 10 minutes to 21:20), and from the Live rates page `now`, `test` (to the caller only) and `check` (whether Microsoft lets the app send; sends nothing). App-only Graph `sendMail` from the request's mailbox, one mail per partner, 2 s apart | the three `MS_*`, and `MAIL_SYNC_SECRET` as the scheduler's secret (header `x-scheduler-secret`) |

Deploy a function with `node supabase-v2/deploy-function.mjs <slug>` (`--verify-jwt` for
`track-shipment`, `mail-sync` and `live-rates`: the cron sends the anon key and the shared secret).
`node supabase-v2/set-mail-sync-secret.mjs` sets mail-sync's tenant, client id and scheduler
secret (and `MS_CLIENT_SECRET` from `ms_client_secret` in `server-v2/.keys.json`, if present).

`kb-sync` and `ingest-calls` (the voice-agent era) were deleted on 26 Sep. They were deployed
with no sign-in check, and `kb-sync` republished the voice agents' knowledge pack through
SnapServe, so anyone who found the address could have run it. Their deployed code is saved
locally in `backups/functions/` (gitignored). **Their four secrets are still set, for the user
to remove** (the session was not allowed to delete secrets): `SNAPSERVE_API_KEY`,
`SNAPSERVE_BASE_URL`, `ANTHROPIC_API_KEY` and `EXTRACTION_DISABLED`, under Supabase → Edge
Functions → Secrets. Nothing in the repo reads them.

### Flags (`netlify.toml` → `src/lib/features.ts`)

| Flag | Default in code | Set on the live site |
|---|---|---|
| `VITE_ACCOUNTS_DESK` | off | `on` |
| `VITE_CASE_FILE` | mail only | `full` |
| `VITE_MAINTENANCE` | off | `off` since 5 Oct (was `on` 29 Sep – 5 Oct: only `/q`, `/t`, `/b` answer; §0) |

**Check `netlify.toml` before saying a feature is off in production.**

---

## 3. Routes — 58 page components

### Sidebar, in order

| Section | Pages |
|---|---|
| (top) | Overview |
| Pipeline | **Enquiries** `/intake` · Inbound enquiries `/enquiries` · My enquiries · Quote approvals `/approvals` · In-process shipments · Completed shipments |
| (separate item) | **Job closing** `/job-closing` |
| Operations | **Sailing schedule** `/sailing-schedule` · Consoles · Documentation · Rate master `/rates` · Mail |
| Customers | Directory `/customers` |
| Agents & partners | Partner mail · Live rates `/partners/live-rates` · Directory `/partners` |
| Accounts (flag) | 14 pages under `/accounts/*` |
| Insights | Analytics |
| Admin (admins only) | Team oversight |

- **`/intake`** is an overview of how many enquiries are inbound, in process and completed,
  with the Excel register download and the mails still waiting to be sent to inbound.
- **`/sailing-schedule`** is the only sailings page. Each departure's containers are listed
  under it. `/containers` and `/space-containers` redirect here.

### Public pages (no sign-in)

- `/q/:token`: the customer accepts a quotation.
- `/t/:token`: the customer tracking page. Since 102 it shows only the booking's details and
  the milestones the desk recorded on the job's Tracking tab (§13, "Customer milestones").

### The shipment job file

`/shipments/:id` has these tabs: overview · mail · parties · cargo · bill · documents ·
pickup-delivery · warehouse · customs · tracking · sign-off · containers. With the accounts
flag on, it also has invoices and costs.

---

## 4. Data model — 139 migrations

`supabase-v2/001…139`, applied in order with `run-sql.mjs` (each file runs as one
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
| `093` | nightly backups: `backup_export()` / `backup_export_text()` (service role only) write every public table, the accounts without passwords and the file list; the private bucket `backups`; `backup_runs` (admins read); cron `araxys-v2-db-backup` at 21:30 UTC (03:00 IST) |
| `094` | Outlook stays connected: `private.outlook_links` (one row per Supabase sign-in, keyed by `auth.sessions.id` **on delete cascade**, so a sign-out deletes it; the refresh token sealed by the function); `outlook_link_put / _get / _drop`, service role only; cron `araxys-v2-outlook-links-prune` (22:30 UTC) drops rows unused for 3 days (tabs closed without signing out). The `private` schema is outside the API and the backup |
| `095` | Connect Outlook from inside the CRM: `private.outlook_pending` (a one-time note per connect: state hash, sign-in, PKCE verifier, page to return to; deleted with its sign-in, refused after 15 minutes, taken once); `outlook_pending_put / _take`, service role only |
| `096` | the last security-advisor findings: the 13 functions without a fixed `search_path` get `''` (each read first: built-ins and `public.`-qualified names only); the 14 reporting views get **`security_invoker = true`**, so they read as the person asking and the tables' RLS holds. Only `partner_reply_log` changed in effect: employees now see their own replies, as 045 and replyLog.ts intended (through the owner-rights view they saw everyone's). Verified by snapshotting every view as each of the 5 staff before and after: no other difference |
| `097` | the CSN for ICEGATE: `icegate_settings` (one row: ICEGATE ID, desk PAN, authorised person's PAN, port of reporting; staff read, admins update), `consoles.csn_draft` (the form as saved), `csn_files` (every file made, job number from `csn_job_seq`, never reused) and `csn_file_new(console, event, indicator, houses)` which numbers and names the file `F_SACHM22_<event>_<ICEGATE ID>_<job>_<yyyymmdd>_DEC.json` on India's date |
| `098` | `icegate_settings.iec`: the desk's IEC for the export CSN, when it is not the PAN (the CSN uses the PAN when blank) |
| `099` | CSN amendments: `csn_files.draft` keeps the form each file was made from; `csn_file_new` takes it as a fifth argument (the four-argument version is dropped) and accepts the event SCA |
| `100` | ICEGATE's replies: `csn_files.reply_status` (accepted / rejected / failed), `reply` (as read), `replied_at/by`; `csn_file_reply(job, status, reply)` writes them (staff; the table stays read-only); `shipment_customs.cin_type/cin_no` for each house's CIN |
| `101` | Live rates: `live_rate_requests` (service, what to quote, mailbox, running), `live_rate_recipients` (partners), `live_rate_sends` (every mail, sent or refused; the function writes it, staff read it). A partner is claimed once per Sunday (unique index). Trigger: the mailbox must be a CRM login and only an admin changes it. Cron `araxys-v2-live-rates` `0,10,20,30,40,50 17 * * 0` (22:30–23:20 IST) with the scheduler's Vault secrets |
| `102` | **Customer milestones.** `milestone_templates` (per mode; customs per direction) and `shipment_milestones` (per job: day, time as told, where, a note for the customer, hidden, `added` for the desk's own updates). Staff read; written only by `save_shipment_milestone`, `add_shipment_update`, `delete_shipment_update`. A milestone that marks a stage ticks that workflow step (`milestone_to_step`), and **a stage step can be ticked no other way** (`guard_milestone_step`, flag `app.milestone_write`). The warehouse-receipt trigger is dropped; movements no longer tick stage steps; `apply_tracking_event` needs a person and records the milestone (`set_shipment_stage` went in 103). `shipment_tracking` rebuilt to the booking plus visible milestones; `shipment_track_points` and `shipment_customs_public` dropped, so the anonymous key reaches three functions. Seeded on every new booking (booked reached on creation) and backfilled from the ticked stage steps |
| `103` | **The audit's fixes.** `shipment_margin` and `console_margin` count **before GST**, as Job closing does (`invoice_net_inr`, `bill_net_inr`: lines in rupees, else the taxable value; credit notes negative). **Cancel and reopen a shipment:** `cancel_shipment(id, reason)` / `reopen_shipment(id, reason)`, with `shipments.cancelled_at/by`, `cancel_reason`; refused on a signed-off job; reopening goes back to where the milestones say; both on the timeline. `set_shipment_stage` dropped. Voice-era `capture_call_as_intake` and `forget_call` dropped, and `promote_intake`'s `public.calls` branch removed. Ten policies read `(select auth.uid())` once per query; every foreign key in `public` has an index (`…_fkx`) |
| `104` | **Your own profile: the signature, and nothing else.** 103's `(select auth.uid())` in `profiles_select_own`, together with 003's self-update policy that read `profiles` to pin the role, made every signature save fail with "infinite recursion detected in policy for relation profiles" (28 Sep, about a day). The self-update policy now only says "your own row"; the trigger `profiles_guard_self_update` refuses a browser (`current_user = 'authenticated'`) changing anything but `signature`. That also closes a hole older than 103: the pin covered `role` only, so an employee could set their own `can_approve_quotes` / `can_assign` through the API. Staff accounts (service role) and migrations are not held to it |
| `105` | **Mail snooze.** `mail_snoozes`: one row per snoozed message (its id in the Snoozed folder, when it comes back, `returned_at`, `seen_at`), visible and changeable only by its owner (RLS checked as two employees, rolled back). Outlook's snooze is not in Graph, so `services/snooze.ts` moves the message to a Snoozed folder and the Mail page brings due ones back on open and on its minute refresh |
| `106` | **A pasted quotation.** `quote_lines.section` ('ex_works' / 'other'; the PDF prints each group under its title with a subtotal), `quotes.mail_text` (set on a pasted quotation: it goes out as plain text) and `quotes.pasted_text` (the source). `require_approval_to_send` also un-approves on a change to `mail_text`. Checked rolled back: a bad section refused, the total still from the lines, approval reset |
| `107` | **Rate requests per partner, for chosen services.** `partner_quotes.services` (what that partner was asked to price), `sent_from` (the sender's mailbox: the thread and reply are there), `source` ('case_file' / 'live_rates'). `record_rfq_sent` takes `p_services` and `p_source` (old calls still work) and, in the same transaction, binds the conversation to the enquiry (`enquiry_threads`), adds the partner to `enquiry_parties` under their directory role unless that address is already there, and logs `partner_asked` once per partner per batch. Staff only; anon refused. Checked rolled back |
| `108` | **The customer's DSR.** `shipment_dsr_notes` (per shipment: the REASON and STATUS the desk writes for the report; its own table because a signed-off shipment is locked; stamped with who and when; staff read, insert, update, never delete) and `customer_dsr_sends` (every DSR mailed: to, cc, subject, the shipments on it; staff add as themselves, nothing rewritten). Both on realtime. Checked rolled back: forged sender, edit or delete of the log, delete of a note and anon all refused |
| `109` | **A quotation that cannot be right does not go.** `quote_problems(quote)` lists, in sentences: no charges; adds up to nothing; a charge with no name; a foreign charge (or the quotation itself) in a foreign currency at a rate of exchange of 1, 0 or none. `quote_ready_or_raise` refuses with that list from `submit_quote_for_approval`, `self_approve_quote` and `require_approval_to_send` (new rule 4: draft → sent/accepted, whoever sends). A charge at nothing is allowed when the whole adds up to something. Both helpers internal (no grant). Checked rolled back on the real drafts |
| `110` | **Enquiry and intake fixes.** `create_customer` takes an advisory lock and counts only ids shaped `C0001` (a `DEMO-` id made the cast fail and every new customer with it); `create_enquiry` sets `received_at` (a manual enquiry had none; `promote_intake` still sets the intake's); `promote_intake` logs `mail_linked` only when the conversation was actually bound, and `mail_elsewhere` naming the enquiry it stays on when it was already filed. Checked rolled back: sequences and `reference_series` unchanged afterwards |
| `111` | **Revert only an untouched booking.** `revert_shipment` deletes the shipment, and everything cascades with it (milestones, receipts, pickups, customs, issued house bills) while vendor `bills` went to no job (ON DELETE SET NULL). Now refused when signed off, cancelled, past booked, with a bill recorded, a house bill or HAWB issued, cargo received into the warehouse, or a pickup/delivery done — cancel instead. Checked rolled back |
| `112` | **What can go on a console.** `attach_to_console` took an air job onto a sea console, an import onto an export console, cancelled and signed-off jobs; a move between consoles was logged as a plain "Put on". Now sea only, directions must agree (cross-trade takes either), not cancelled or signed off, the same console again is a no-op, and a move says "Moved from X to Y" (the old console's master bill leaves with it). Checked rolled back |
| `113` | **Rates find the enquiry's lane.** `rates_for` matched places by exact text, so a rate for "Chennai" never met an enquiry reading "Chennai (MAA)". `place_words` / `place_matches`: every word of one place is among the other's, either way round ("Dubai" matches "Jebel Ali / Dubai, UAE"; "MAA" matches "Chennai (MAA)"; "Chennai" does not match "Kochi"). Ranking unchanged. Checked rolled back |
| `114` | **The customer's quotation page answers back.** `quote_links` gains `revision_requested_at / revision_note / revision_name` and `shipper` (jsonb) / `shipper_at`; `enquiries` gains `shipper_name / shipper_address / shipper_contact / shipper_email`, copied onto a new shipment by `shipment_from_enquiry`. Anonymous, token-keyed, security definer: `request_revision_by_token` (open or expired, not accepted/revoked/declined; a repeat within 10 minutes is not recorded twice; timeline `revision_requested`) and `shipper_by_token` (only after acceptance; fills the enquiry's and the shipment's shipper fields where blank, never over the desk's; timeline `shipper_given`). `quote_by_token` returns both. Checked rolled back as `anon` |
| `115` | **A pasted air quotation as the desk's rate table.** `quote_lines.section` gains `freight` and `destination` (beside `ex_works`, `other`); `quote_lines.gst_rate` (per cent as quoted, 0 = none, null = not stated, 0–28); `quotes.routing / carrier / transit_time`. `copy_quote_lines_to_invoice` charges `coalesce(gst_rate, 18)`; `quote_lines_reset_approval` also un-approves on a change of `gst_rate` or `section`. Checked rolled back |
| `116` | **Partners say which country they are in.** `partners.country` (text, default `''`); trigger `partners_country_required` (`guard_partner_country`, no grant) refuses a new partner without one and blanking one once given, and trims it. Older partners keep `''` until edited. The spelling is the form's (`lib/countries.ts`). Dry-run rolled back as an employee (new without a country refused, "  Taiwan " kept as "Taiwan", blanking refused, an older partner still editable, the guard not callable by anon or authenticated), then **applied 1 Oct**; the 4 partners then on the directory (2 active) have no country yet |
| `128` | **The partner's original rate on an enquiry.** Table `enquiry_buy_rates` (one per enquiry, `enquiry_ref` PK → enquiries on delete cascade): `partner_id`, `partner_label`, `pasted_text`, `lines` (jsonb array, checked), `roe`, `total_inr` (≥ 0 or null), who/when, touched by a trigger. Staff read and write. Checked rolled back as an employee |
| `129` | **The original rate built up over several pastes.** `enquiry_buy_rates.history` (jsonb array, checked, default `[]`): each paste's when, from whom, what was pasted, and what it changed (updated, added, unchanged, or replaced the whole rate). Each line in `lines` now also carries `from`, `at` and `was`. Checked rolled back as an employee |
| `130` | **The overseas agent's profit share.** `partners.profit_share_pct` (0–100, null = none agreed) and `profit_share_losses` (default true); `consoles.profit_share_pct` (a console agreed differently, 0 = none); `invoices.profit_share_pct` / `profit_share_base_inr` mark our note settling a share (checked: a debit or credit note to a partner); `bills.profit_share` marks the agent's own (checked: an agent note). `issue_invoice` no longer asks a note on an agent for the invoice it corrects (042's Rule 53(1A) check now only for notes to customers, which 037's agent notes never could pass). `raise_profit_share(partner, console | job, kind, currency, roe, amount, pct, base, description)`: drafts our OCN/ODN with the one line, export LUT, one draft at a time per console or job (advisory lock). Checked rolled back as an employee |
| `131` | **Dangerous goods accepted into a console.** `shipments.msds_date`, `dg_declaration_at`, `dg_line_ref`, `dg_accepted_at/by`, `dg_accept_note`. Trigger `shipments_dg_acceptance`: a change of UN number, class, packing group or console clears the acceptance, and a signed-in user cannot set it directly. `accept_dg_house(shipment, note)` refuses class 1, 6.2 and 7, no UN number, no MSDS, an MSDS over five years old, no declaration, no line approval; logs `dg_accepted` on the enquiry. Checked rolled back as an employee |
| `132` | **The company's registrations, our own MTO, the eBL.** Table `company_registrations` (kind mto · consol_agent · customs_bond · bank_guarantee · ebl_platform · other; number, authority, issued_on, valid_until, amount_inr, notes, active; one active mto, consol_agent and ebl_platform at a time): everybody reads, only an administrator writes (RLS), anon nothing. `house_bills.mto_own` (not with a partner) and the eBL: `release_mode` adds `ebl` (no paper originals, as `express`), `ebl_platform`, `ebl_ref`, `ebl_issued_on`, `ebl_holder`, `ebl_surrendered_on`. `house_bill_write` (123's, extended): issuing under our own MTO is refused unless the number on the B/L is the active registration in force today; an eBL is issued only with platform and reference, released only after it is surrendered, not reopened while it is out; its moments go on the timeline (`ebl_issued`, `ebl_transferred`, `ebl_surrendered`). `received_house_bills.release_mode` adds `ebl` too. Checked rolled back as an employee and an admin |
| `133` | **A pasted rate replaces a draft's charges in one step.** `replace_quote_lines(quote, lines jsonb)`, security invoker (the table's own rules apply), only on a draft: the old charges out and the new in together, so a failure no longer leaves the draft empty. Checked rolled back as an employee (replaced, total right, a refused charge leaves the old ones, a non-draft refused) |
| `134` | **An import has its own workflow.** The origin's steps (pickup, warehouse/CFS, empty pickup, stuffing, VGM, gate-in, documents, SI, B/L or HAWB, air loading) marked `direction = 'export'`; import steps added per mode (`imp_origin_booking`, air `imp_departed` (stage sailed), `imp_documents`, `imp_arrival_notice`, LCL `imp_destuffed`, `imp_do`, FCL `imp_empty_return`). Customer milestones: the origin's own (received, empty picked, stuffed, gated in) export-only. `apply_direction_steps(shipment)`: the other way's undone steps go, this way's come, dates and stage worked out again, direction milestones hidden or shown; run by `shipments_direction_steps` when `trade_direction` changes (logs `direction_changed`). The arrival notice sent ticks `imp_arrival_notice`; `received_house_bills.do_issued_on` ticks `imp_do`. Imports under way re-listed. Checked rolled back (export ↔ import, ticks) |
| `135` | **Cross trade keeps the origin's steps.** `step_for_direction` and `milestone_hidden_for`: a cross trade is worked as an export without India's customs (no LEO, no OOC; on the customer's list only the two customs milestones hidden). Used by both seeds and `apply_direction_steps`. A job with no direction works as an export. Checked rolled back |
| `136` | **Performance housekeeping (the advisor).** An index under each of the 11 unindexed foreign keys; `customer_dsr_sends_add` asks `(select auth.uid())` once a query; `company_registrations`, `shipment_checkpoints` and `checkpoint_templates` write policies split into insert/update/delete so reads check one policy. Checked rolled back |
| `137` | **Team oversight by person.** `team_actions(p_from, p_to)`: administrators only (security definer, refuses anybody else), one row per recorded action in the period — the timeline (less invoice_*/receipt_recorded, which their tables say better), steps ticked, files filed, consoles opened, CSN files and replies, warehouse receipts, queue items set aside, rate cards, sailings, live rate requests, original rates, invoices started/issued/cancelled, receipts and payments recorded/confirmed/cancelled, vendor bills, agent statements, tracking decisions. Checked rolled back (admin reads, employee refused) |
| `138` | **Arrival notices heard live.** `arrival_notice_sends` added to the realtime publication: the console's destination panel listened for it and never heard (the audit's schema-drift check, 7 Oct) |
| `139` | **Manual documents kept by B/L number.** `manual_documents`: one row per B/L (or AWB) number and document (`doc_key`; the freight invoice's two forms are `freight-invoice` and `proforma-invoice`), `values` the details typed as the Manual documents page holds them, replaced when printed again. Saved on View/Download; the page's Saved documents box finds them by B/L prefix (`services/manualDocuments.ts`). Staff read, insert and update; the saver or an admin deletes; anon nothing. The trigger writes the B/L upper case with single spaces and stamps who and when. Checked rolled back (normalised, replaced on conflict, RLS on), applied 15 Oct |
| `127` | **The arrival-notices sweep on pg_cron**: `araxys-v2-arrival-notices`, at :05 and :35 every hour (UTC), calling the function with the scheduler's secret from the vault, as live rates does |
| `126` | **Deconsolidation at destination.** `shipments.arrival_notice_sent_at / _to / _via` ('auto' or 'desk'); `consoles.arrival_auto` (default false; on only with `arrival_from`, checked), `arrival_from`, `arrival_days` (0–10, default 2), `outturn_sent_at / _to`; table `arrival_notice_sends` (every send or refusal by the function; staff read, only the service role writes). Checked rolled back as an employee: the guards hold, staff cannot write the send log |
| `125` | **The console at the CFS.** `consoles` gains `box_type` (20GP/40GP/40HC, checked: the load plan's box when no sailing says), `stuffed_on`, `stuffing_report_sent_at / _to`. Checked rolled back as an employee |
| `124` | **Selling space on our console to another forwarder.** `customers.forwarder` (boolean, default false); `shipments.coload_instructions_sent_at / _to`. The stuffing CFS is `consoles.cfs_name` (120). Checked rolled back as an employee |
| `123` | **The shipper approves our house B/L draft; a correction after issue is an amendment.** `house_bills` gains `approval` (none/sent/approved/changes), `approval_token` (unique), `draft_sent` (the snapshot sent: data, hbl_no, release_mode, originals, amendment), `draft_sent_at/_to`, `approval_at/_by/_note`, `amendment` (≥ 0), `reopen_reason`; history actions + draft_sent, approved, changes_requested. `house_bill_write` (089's, extended): reopening needs a reason, refuses once `released_on` is set, counts the amendment, resets the approval; reissuing an amendment clears the release steps (not `charges_received_on`). RPCs `hbl_draft_link`, `hbl_draft_sent`, `hbl_record_approval` (authenticated); `hbl_draft_by_token`, `hbl_answer_by_token` (anon, security definer, fixed shape). Checked rolled back as employee, anon and admin: every rule, anon denied the table and the desk's functions |
| `122` | **Who files the CSN on a co-load.** `consoles` gains `csn_by` ('us' default / 'coloader', checked; only read on a co-load — our own box is always us), `csn_list_sent_at / csn_list_sent_to`. Their CSN number goes in `csn_no / csn_date` and the jobs' customs records, as ours does. Checked rolled back as an employee |
| `121` | **A console on space bought from a co-loader.** `consoles` gains `space_from` ('line' default / 'coloader', checked), `coloader_id` (partners, on delete set null, indexed), `coloader_rate` (per W/M, ≥ 0), `coloader_currency` (3 capitals, default USD), `coloader_min_wm` (≥ 0, default 1). Under the existing consoles policies. Checked rolled back as an employee: saved, and a bad source, a negative rate, a lower-case currency or a negative minimum refused |
| `120` | **An import console's master B/L at this end.** `consoles` gains `mbl_copy` (the origin agent's copy as read: `{bill: HblData, bl_no, issuer, originals}`) / `mbl_copy_at`, `release_in_hand_at / _ref`, `line_invoice_no`, `line_charges_inr` (≥ 0, checked), `line_paid_at`, `line_do_no / line_do_at / line_do_valid_till`, `cfs_name / cfs_nominated_at / cfs_nominated_to`, `destuffed_on`; how the master is released reuses 119's `mbl_release / mbl_originals`. Under the existing consoles policies. Checked rolled back as an employee: every field recorded, a negative charge refused |
| `119` | **A console's master B/L with the line.** `consoles` gains `carrier_booking_no`, `mbl_si` (the desk's SiTerms: parties, freight, wording; boxes and totals are never stored), `mbl_stage` (none → si_sent → draft_received → draft_approved → issued → released, checked), `si_sent_at / si_sent_to`, `mbl_draft` (the line's draft as read, HblData) / `mbl_draft_at`, `mbl_draft_approved_at`, `mbl_release` (original / telex / seaway / ebl, checked) and `mbl_originals` (0–3), `mbl_released_at / mbl_release_ref`. Under the existing consoles policies. Checked rolled back as an employee: every stage recorded, a bad stage, release or 4 originals refused |
| `118` | **A sent quotation, edited, becomes its next revision.** `revise_quote(p_quote)` (security invoker, authenticated only): in one transaction the sent quotation is superseded and its next version made as a draft with the same basis, validity, sailing, currency and rate, type, terms, `mail_text`, `pasted_text`, routing, carrier and transit time, and every charge copied (section and GST too); logs `quote_revised`. Answers `{quote_id, lines: {sent line id: copy id}, existing}`; asked again it answers the draft already made rather than a third version; refuses anything not `sent`. Checked rolled back as an employee on ALG10001-26 (10 charges copied exactly, the total unchanged, an edit landing on the copy, the sent version untouched) |
| `117` | **The Sunday rate requests go at 8:30 pm IST** (the user, 1 Oct), not 10:30: `cron.alter_job` moves `araxys-v2-live-rates` to `0,10,20,30,40,50 15 * * 0` (15:00–15:50 GMT = 20:30–21:20 IST) and leaves its command as 101 wrote it. `lib/liveRates.ts` (and the function's copy) say 8:30 for the page; the function never reads the time, so it was not redeployed. Dry-run rolled back, then applied |

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

`src/services/` holds 59 modules. The ones added since 21 September are:

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
npm test                             # 60 suites, pure logic
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

There are 60 suites in `scripts/tests/*.test.ts`, run with tsx. Each is registered as its
own script and chained into `npm test`. When you add a suite, add it to both.

The UI has no automated tests. It is verified by hand in the way described below.

### The whole-system audit: `npm run audit` (28 Sep)

`scripts/audit/run.mjs` runs, against the live project, in about a minute:

1. **Schema drift** (`schema-drift.mjs`): every table, column, RPC and its parameter names,
   bucket, edge function and realtime table the code names, read from the TypeScript AST and
   checked against the live catalogue. Catches a renamed column or a dropped function before a
   screen does.
2. **Dead links** (`routes.mjs`): every in-app link against `App.tsx`'s routes.
3. **Function bodies** (`plpgsql-check.sql`): `plpgsql_check` over every PL/pgSQL function,
   installed for one transaction and rolled back.
4. **Integrity** (`integrity.sql`): sequences ahead of their data, stage / step / milestone
   agreement, pipeline states, people, files, RLS on every table, views with security_invoker.
5. **Business flow** (`e2e-flow.sql`): enquiry → quote → approval gate → customer accepts by
   link → booked → milestones → HBL → invoice → receipt → cost → delivered → sign-off, as an
   employee who needs approval, the admin and the anonymous customer; timed per step; **rolled
   back**, and the booking sequence put back only if nobody else drew from it.
6. **Operations**: cron failures, mailboxes the server copy cannot read, last backup.
7. **Supabase advisors**, and 8. **latency**: the slowest app queries and the API round trip.

It exits non-zero while anything is found.

### The longer life of one shipment: `node supabase-v2/e2e.mjs` (7 Oct)

`supabase-v2/e2e-shipment.sql`, 43 steps, run through `e2e.mjs`, which puts `shipment_no_seq` and
`warehouse_receipt_seq` back afterwards (to where they were, or the highest number really in use).
Beyond the audit's flow: mail captured into the queue and turned into an enquiry; dimensions
working out the cargo; partners added, asked for rates, their reply and original rate; the
quotation's total from its lines; a step pressed and a milestone step refused when pressed
(recorded on Tracking instead); routings, customs, pickup, warehouse receipt; pre-alert; console
opened and the job put on it; house B/L numbered, its draft approved by the shipper by link, a
second number refused; invoice from the quotation (start_invoice brings the accepted quotation's
charges — do not copy them again), receipt, carrier bill paid, credit note, debit note to an
agent, the final bill agreeing with the documents; sign-off refused while undelivered, then the
job worked to the end (every step, every milestone, proof of delivery) and signed off; a
signed-off job refusing changes; team oversight refused to an employee and crediting the
employee's actions for the admin; reopen; a phoned-in enquiry taken on and put back; a queue item
set aside and back; a job cancelled and reopened. As the employee, the admin and the customer by
link; rolled back. 43/43 on 7 Oct.

The same day every screen was rendered against that job's data (captured from inside the rolled-
back run): 42 routes as the admin and the employee's own, no console errors. It found one real
weakness — one charge line without a rate in the original-rate box threw while drawing and, with no
error boundary anywhere, blanked the whole app. Fixed twice over: the box reads a missing figure as
0, and `components/PageErrorBoundary.tsx` around the page outlet (layout/AppLayout, keyed by path)
keeps any such failure to its page ("This page could not be shown · Try again") with the sidebar
and every other page working. The audit's own flow now puts the warehouse-receipt sequence back too.
Open on 7 Oct: the audit's integrity finding — ALG09004-26 (kevin imports) is accepted and booked with
no quotation at all, from before the acceptance gate; left for the user to decide. The UI is not in it (it needs a signed-in browser):
on 28 Sep every route was rendered in a local harness with a stubbed client (realistic
anonymised data, then empty data, admin and employee, 375 px), with no console errors, no blank
page and no horizontal overflow; see the findings in §9.

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

**Customer milestones (102) were verified** by a dry run of the migration against live data,
rolled back: the guard, recording and clearing, the stage following, every refusal, movements,
a carrier event applied by a person, the customer RPC as `anon` and the privileges; then the
Tracking tab and the customer page in a preview harness, desktop and 375 px.

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

- **Small laptops (1366×768, often at Windows' 125%, which leaves the browser about 1093×525).**
The shell and Mail were reworked for them on 28 Sep:
- The sidebar folds to a 64-px icon rail (`AppLayout`, `Sidebar` `rail`), by default below
  1440 px, with names as tooltips; the chevron at its foot toggles it, remembered in this
  browser (`araxys:nav-rail`). The phone drawer always shows names.
- `main`'s padding is smaller below `xl`; Mail's height sums it (`100dvh - 88px` below xl,
  `- 104px` from it). Change one and change the other.
- Tailwind has a `short` screen (`max-height: 820px`). `PageHeader dense` (Mail) keeps its
  heading for screen readers only there.
- Mail: folders sit in the toolbar row; the list is a third of the width (240–360 px);
  "Read at full width" hides the list while a message is open (`araxys:mail-wide`); the page's
  floor is 360 px, not 560, which is what made the whole page scroll and cut the message off.
- `MailBody`'s `FitToWidth` scales a wide mail down with CSS `zoom` to fit the pane (not below
  60%, then it scrolls sideways). `.mail-body table` no longer has `max-width: 100%`, which
  squeezed a rate card's columns until every cell wrapped.
- An element made `sr-only` is absolutely positioned: inside a scrolling list, give the list
  `relative`, or its hidden headings stretch the page (the rail did, until it had one).

**Theme colours are plain `var(--…)`**, so Tailwind's opacity modifier
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

**A workflow step that marks a stage is ticked only through its milestone (102).** The guard
on `shipment_checkpoints` refuses any other change to its `done_at`, so a new trigger or function
that ticks steps must skip `stage is not null` (as `movements_to_checkpoint` does), or it will
fail whatever wrote the row that fired it. Record the milestone instead, or offer it on the
Tracking tab (`suggestionFor` in `lib/milestones.ts`).

**A policy on a table must not read that table** — not directly, and not through a subquery
whose own policies contain a subquery. Postgres answers "infinite recursion detected in policy
for relation …" and refuses the statement outright. 103 did this to `profiles` and stopped every
signature save for a day (104). Pin columns with a trigger instead, and check a change to any
`profiles` policy with the audit's business flow, which saves a signature as an employee.

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

**Mail threads (28 Sep).** The Mail page lists a folder by conversation (one row, its newest
message there, with a count) and reads a whole conversation from every folder
(`MailConversation.tsx`, `graphMail.messagesInConversation`): the opened message expanded,
the others one line each that expand in place with their own Reply / Reply all / Forward.
Deleted, junk and draft messages are left out. Archive moves the conversation's messages in
that folder. The quotation, booking confirmation and tracking-link mails no longer start new
conversations: `services/customerThread.ts` `threadWith` finds the newest message with that
person in the job's correspondence (bound threads plus anything carrying the reference) and
`ComposeMail` answers it (`replyTo` with `initial`), under the thread's own subject plus the
reference, with the thread quoted under it. Gmail splits a thread whose subject changes, which
is why the letter's own subject is not used there. No such message in the signed-in mailbox
(a phoned-in job, or mail that came to a colleague) means a new conversation, and the compose
window says so.

**Mail fixes (29 Sep).** Switching folder clears the list at once (it used to show the old
folder's rows, drawn as the new one's). Search waits for a pause in typing and drops late
answers. Drafts show who they are to and open with "Edit and send", which sends the Outlook
draft itself (`graphMail.sendDraft`). The compose and signature windows ask before discarding
(Escape and a click outside used to close them silently). To/Cc/Bcc take Outlook's
"Name <address>" (`lib/addresses.ts`). Attachments can be downloaded from the Mail page. The
attach limit is checked on the encoded size, as the send checks it. On a phone, tapping a message
scrolls to it. Conversations and the case file leave out drafts.

**Mail search (29 Sep), Outlook's way.** Searches every folder by default ("All folders" /
the current folder), and a result is a message, not a conversation: its folder is tagged,
the words are marked yellow in the name, subject and a line of the body around the first
match (`lib/searchHighlight.ts`), and opening it marks them in the message and scrolls to
the first. Graph: `searchMessages` asks `$search` for plain-text bodies to cut the line from;
each word is quoted (`kqlFor`) so "ALG09012-26" is not read as ALG09012 NOT 26. Enter
searches at once, Escape clears, choosing a folder ends the search.

**Mail, the rest of Outlook's basics (29 Sep).** The list refreshes itself every minute and on
returning to the tab (not while searching or after "Load older mail"). All / Unread / Flagged
above the list (a server `$filter`, with the `receivedDateTime` clause Graph needs beside
`$orderby`). Delete moves to Deleted Items (`graphMail.deleteMessage`); flag, mark unread/read,
and "Open in Outlook" (`webLink`) are icons beside Archive. Keyboard: arrows or j/k, R, A, F, E,
Delete, U, N, / (the keyboard button lists them). Compose suggests recipients from customers,
partners, the desk and recent correspondents (`services/addressBook.ts`, `lib/addressRank.ts`),
and "Save draft" keeps it in Outlook's Drafts (`graphMail.saveDraft`; a reply is started with
createReply so it stays threaded).

**Mail, 29 Sep (later).**
- **Attachments open inside the app** (`AttachmentViewer.tsx`, loaded on first use): PDFs page by
  page with zoom (pdfjs-dist **4.10.38**, pinned: 5+ needs Node 22 — Netlify builds on 20 — and
  newer phones), pictures and text, with Download. Other files download. A new tab was a browser
  tab in the installed app and a blank Safari page on an iPhone.
- **Every folder**: Junk, Deleted Items and the person's own folders (top level and one level
  down) under "More". `FolderId` is the six well-known ones or `id:<graph id>`. Move to, and in
  Deleted Items / Junk, Restore / Not junk in place of Delete. Nothing deletes permanently.
- **Bulk actions**: tick boxes over the avatars (Shift for a run, X from the keyboard); the bar
  marks read/unread, flags, archives, moves, snoozes or deletes, six at a time (Graph throttles).
- **Snooze** (105): see the migration table. Later today, tomorrow, the weekend, next week, or a
  date and time. Mail back from snooze is pinned to the top of the Inbox until opened, because
  Graph keeps a moved message's received date.
- **Rules**: Outlook's own inbox rules (`graphMail.listRules` etc., `RulesDialog.tsx`) — from,
  subject, subject-or-body, attachment → move, mark read, mark important, delete, stop. They need
  the delegated permission **MailboxSettings.ReadWrite**, admin-consented on 29 Sep 2026 and now
  asked for by the sign-in (`auth.tsx`), `outlook-connect` and `outlook-token`. Rules calls are
  "soft" on 403 (`GraphForbiddenError`): a 403 elsewhere clears the Outlook token. `outlook-token`
  asks for the base scopes plus this one, and if Microsoft refuses it (consent withdrawn: it says
  so as invalid_grant, which otherwise ends the connection) asks again without it — so losing the
  consent costs the Rules window, never the mailbox.
- Phone sheets (compose, rules, file to enquiry, add container, ask partners, partner form, rate
  master) had no background below `sm`; the folder tabs now wrap so a phone is not 448 px wide.

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

**The quotation's charges (29 Sep).** `QuoteCharges` was a 74–86rem table in a sideways
scroller: on a laptop a thin strip that scrolled both ways, with the currency and unit menus
clipped inside it (a scroll container clips its absolutely placed children). It now measures its
width and lays the same cells out as one row per charge where it fits, the sell line over the buy
line where it does not, or a labelled card per charge on a phone — the panel grows, nothing
scrolls inside it. A charge just added is scrolled into view with its rate field focused; the
picker has a filter and "another charge". The code column is headed "Code": headed "Charge", it
had prices typed into it (ALG09011-26).

**Paste a quotation (106, 30 Sep).** Quotation → "Paste a quotation": the rate as the desk has
it is read by classify-enquiry's `paste_quote` mode (Gemini) into lines, each under Ex works or
Other charges; the model only copies figures and sorts, it never adds up. `lib/pastedQuote.ts`
holds the values to allowed units and currencies, works out every total and lays out the plain
text; the dialog (`PasteQuoteDialog`) shows the lines to correct, asks for any missing rate of
exchange, then saves them into the draft (its charges replaced) or a new version
(`services/pasteQuote.ts`). A quotation with `mail_text` goes as the usual quotation letter
(letterhead, reference, route box, terms) with its **charges as text instead of the table**:
headings, a bulleted line per charge, the group totals and the whole in rupees in bold
(`chargesText`, rebuilt from the charges at sending by `chargesTextFor`; the user asked for
this on 30 Sep — tables only in the PDF). The PDF groups by `section` and prints the rate of
exchange under the total when any line is foreign. The charges grid shows EXW / OTH on each
line, a press moving it. The sending panel now re-reads the
charges before mailing or downloading — it read them once, so a charge renamed in the grid went
out under its old name until a reload.

**Customer DSR (108, 30 Sep).** Customers → a customer → **DSR** (or the DSR button on the list,
for customers with live shipments). The daily status report in the desk's own 21 columns (from
the sample the user sent: S.NO … REASON, STATUS), one line per shipment in progress plus those
delivered in the last 7 days (`DELIVERED_KEPT_DAYS`); cancelled never. Everything but REASON and
STATUS is read from the job (`services/dsr.ts` → `lib/dsr.ts`): booking no (the carrier's, else
the job number), BL (house bill / HAWB, else the forwarder's, else the master), the far port
(POL on an import, POD on an export), booking received (the quotation accepted, else the job
opened), booking confirmed and pickup (milestones; a pickup only planned says so), packages,
weight, CBM, vessel/voyage or flight, cut-off, ETD, ETA. REASON and STATUS are typed on the page
and saved when the field is left (`shipment_dsr_notes`); a blank STATUS reads from the
milestones ("Booking confirmed on 24 Sep 2026 · next: cargo picked up"). **Download Excel** is
the desk's copy (with the agent); **Email to customer** opens the compose window from the
sender's Outlook, to the customer's addresses, with the company letter carrying one card per
shipment (phone-readable) and the customer's copy of the sheet attached — **no agent column**
(the desk used to hide it; a hidden column is one click from visible). Each send is recorded
(`customer_dsr_sends`) and the page shows the last. ComposeMail's `onSent` now reports the final
To, Cc and subject. Tests: `scripts/tests/dsr.test.ts` (lines, both copies, the workbook read
back, the mail).

**Quotation checks (109, 30 Sep — Enquiries sweep).** Found on the live data: a charge switched to
USD kept the rupee rate of exchange of 1, so USD 15 counted as Rs 15 (ALG09011-26, ALG09012-26);
a quotation at Rs 0 was sent and accepted (ALG09009-26); a nameless charge row sat on an approved
draft (ALG09008-26). Now: the grid shows a foreign line's rate empty and outlined in red
("Rate?") until it is given, and a line switched to a currency starts at the rate another line
on the quotation already uses for it (`lib/quoteChecks.ts` `rateInUse`; none in use, none
guessed). A draft's own currency and rate are editable under its total (`setQuoteCurrency`) —
before, they were fixed when the quotation was opened. The sending panel lists what is wrong
(`quoteProblems`, the same list the database uses) and Send for approval, Approve it myself and
Email the quotation are unavailable until it is right; an admin's send whose clearance is refused
no longer opens the mail anyway. The panel re-reads the charges on every grid edit
(`chargesVersion`), so renaming a charge clears its warning.

**Enquiries sweep, part 2 (110, 30 Sep).**
- *The reader missed lanes given only in the subject.* Both the automatic fill and "Read the
  mail again" passed the enquiry reference as the subject, and the thread text showed each
  subject as a bare `--- …` separator, so "IMPORT SEA FREIGHT RATE FROM VIETNAM TO CHENNAI"
  was read past and four enquiries were marked read with nothing filled. Now the first
  message's subject is passed (`threadSubject`) and each message is labelled From / Subject
  (`messageBlock`). In `classify-enquiry`: the Subject line is the sender's words, not an
  address header; a country given as the place is written as given; when the model still
  leaves the lane blank, "FROM X TO Y" is copied out of a subject line (`lane.ts`, tested by
  `scripts/tests/lane.test.ts`), and "AIR FREIGHT" there means air; `sea_fcl` / `sea_lcl` stand
  only with FCL / LCL evidence in the text (it used to guess FCL from "SEA").
  **To do by hand:** ALG09001, 09003, 09010 and 09011 are still marked read with no lane; press
  "Read the mail again" on each (the database reset of the mark was not made).
- *File to enquiry moved a thread silently.* A conversation already on another enquiry was
  moved by one click and that enquiry lost its mail (ALG09010-26's thread went to ALG09008-26
  on 28 Sep). Now the dialog says where it is filed, marks that row, and asks before moving;
  `bindThread` refuses a move not asked for (`move`), and both timelines record it
  (`mail_moved` / "moved here from"). **Left as found:** ALG09010-26's thread is still on
  ALG09008-26 — the desk decides whether it belongs there.
- *No way to close an enquiry.* Nothing set "lost". The case file's status pill (now in the
  board's colours) has **Close enquiry** with a reason (`lib/enquiryStatus.ts`) and **Reopen**
  (back to quoted if a quotation is out, else new); both are on the timeline. The board opens
  on **Open**, with Closed (lost + declined) and All beside the stages. `declineQuote` now
  stops if the quotation could not be marked.

**Shipments sweep (111, 30 Sep).** Every tab of both jobs and both boards were opened on an
anonymised copy with no errors. Fixed: *Revert* (send the booking back to the enquiry) was offered on
every job and deleted a job's receipts, milestones and issued house bills with it, leaving its vendor
bills attached to nothing — now only an untouched booking can be reverted, on screen and in the
database (111). *Dates that cannot all be true* are said on the job (`lib/shipmentDates.ts`): cargo
ready after the ETD or after the cut-off, a cut-off after the sailing, an ETA before the ETD
(ARX-SHP-0006 is ready 1 Oct on a 30 Sep sailing). An air job no longer shows a Containers tab.
Sign-off no longer says "Ready" before its checklist has been read (or if reading it failed).
The harness (`src/__audit.ts`, never committed) now sorts, joins, limits and upserts like
PostgREST: the old one made "next step" and customer names look wrong when they were not.

**Operations sweep (112, 113, 1 Oct).** The Operations tables are empty (no schedules, boxes,
consoles or rate cards yet), so the create flows were run against the live database in rolled-back
transactions: schedule → container → console → jobs on it, and the rate lookup with invented
rates. Fixed: a console took air jobs, jobs going the other way, and moves without saying so (112;
the air HAWB tab no longer offers a console, and the menu lists only consoles going the job's way);
the rate master never matched the reader's place names (113); a schedule's cut-off after its ETD
was accepted by the form and the Excel import (`scheduleDateProblem`, tested in
`schedules.test.ts`). The test used two `sailing_schedule_seq` numbers; the sequence was set back.

**Quotation page: revise, booking confirmed, shipper (114, 1 Oct).** The customer's page (`/q/:token`,
`pages/QuoteAccept.tsx`) has **Accept this quotation** and **Revise this quote** side by side; revising
takes what they want changed. Accepting reads **Booking confirmed**, and below it asks for the
shipper (company, address, contact, email), shown back once given with "Correct it". An expired
quotation offers "Ask for a new quotation". In the CRM the quotation panel shows the open revision
request until a newer version is sent (`openRevisionRequest`), and the acceptance panel shows the
shipper given. The mail's line under the button now says it can be accepted or revised. Both pages
stay reachable in maintenance mode (App.tsx).
**Also 1 Oct:** `replyTracked` (Mail) put attachments into the PATCH of the reply draft, which Graph
ignores — every reply (a quotation in the customer's thread included) went without its files and
its inline logo. Each file is now posted onto the draft, as forwards already were.

**Pasted charges in the desk's format (1 Oct).** A pasted quotation's charges, in the mail and in
the paste dialog's preview, follow the desk's own layout: each group's heading in red, underlined, on
a yellow highlight ("EX WORKS CHARGES :", "OTHER CHARGES :"); lines in capitals with the colons
aligned ("OCEAN FREIGHT … : USD 42 PER W/M × 8 = USD 336"); a trailing "(…)" note in red; each
group's total in bold, then "TOTAL : INR …" with the exchange rates. `chargesLayout` (lib/pastedQuote)
groups the lines and `chargesHtml` (lib/quotationMail) draws them; `chargesText` (the plain-text
part) is built from the same layout. The branded letter around the charges is unchanged.

**Pasted air quotation as the desk's rate table (115, 1 Oct).** On an air enquiry a pasted rate
(a table copied from Excel, a mail, a WhatsApp line) goes out as the desk's own sheet
(`lib/airQuote.ts` `airTable`, drawn by `airTableHtml` in lib/quotationMail): a first line
"EX HEL - IST - MAA // EXW // NO OF PKGS // GWT [// CHWT] // CARRIER // TT", then CHARGES |
CURRENCY/QUANTUM | RATES | INR | GST | TOTAL VALUE IN INR under FREIGHT / EX WORKS / DESTINATION /
OTHER CHARGES, a TOTAL row, and the ROE on the yellow mark. Every figure is the app's: rupees at
the ROE, GST at the charge's rate, a "3% on OF+EXW" charge worked out from the charges it names
(`withShares`; saved as an INR line whose wording rides on its name as "(3% on OF+EXW)"), and a
charge with no figure ("at receipted") spans the figure columns and counts for nothing. The reader
(classify-enquiry, paste_quote) now returns `gst_rate`, `percent / percent_of / rate_text`,
`routing / carrier / transit_time` and the four groups; where the paste has its own group headings
the app re-files each charge under the heading above it (`sectionsByHeading`) — the model put
"EXW charges" listed under FREIGHT CHARGES back under Ex works every time. GST defaults: 0 on the
freight itself and its surcharges, 18 on the rest; the desk changes it in the paste dialog or in the
charges grid (air only). Sea quotations keep the red-heading text layout, now with the same four
groups (freight first, as the desk writes it). Tests: `scripts/tests/airQuote.test.ts` on the desk's
HEL - IST - MAA sheet (totals 3,06,763.87 / 3,24,793.31).

**A table pasted as a table (1 Oct).** A table copied from Gmail (or Outlook, Word, a page) is on
the clipboard as HTML and as plain text; Gmail's plain text has one cell per line. The paste box
(`PasteQuoteDialog`) now takes the HTML (`lib/pastedTable.ts` `tableTextFromHtml`): a line per row,
cells tab-separated, text around the table kept, a layout table read through to the tables inside
it. The box then shows what was pasted as a grid ("Edit as text" / "Paste something else"). Should
the cell-per-line text arrive anyway, it still reads: `sectionsByHeading` no longer takes a line
that is a charge's own name ("EXW CHARGES" alone on a line) for a heading.

**Charges grid made plain (1 Oct).** `QuoteCharges` is one row per charge — Charge | Cur. | Rate |
Per | Qty | ROE (only while a charge is foreign, and only on that charge) | GST (pasted air
quotations) | Amount ₹ — under group headings with subtotals on a pasted quotation. The buy side,
code, minimum, group and vendor sit on a line under each charge behind **Costs & details**
(remembered per browser, `quoteCharges:costs`). A card per charge below the row's least width.
The paste dialog warns when the rate reads as air (freight by the kilo, "AF") on an enquiry not
marked air — the mail follows the enquiry's mode. The reader now takes a per-kg quantity from the
weight the rate itself states (GWT in the title line) before the enquiry's.

**Pasting is how a quotation is made (1 Oct).** The Quotation card opens with a large paste box at
its top (`components/PasteInput.tsx`, shared with the dialog: table paste, grid view), above any
quotation, in every state short of accepted: it starts one, replaces a draft's charges, or makes a
sent one's next version. "Lay it out" opens the review with the text already being read
(`PasteQuoteDialog initialText`). Building or revising charge by charge is the link beside it.

**Revise button in the quotation mail (1 Oct).** The mail carries two buttons side by side:
**Accept this quotation** and **Revise this quote** (outlined). Both open `/q/:token`; the second
adds `?revise=1`, and the page opens with the "What would you like revised?" box ready.

**A revision reads as one (1 Oct).** `lib/quoteRevision.ts`: version 1 is the quotation, version 2
"Revision 1". A revision's mail is titled REVISED QUOTATION with "ALG09014-26 Rev 1" as its
reference (three header facts, as a phone fits), its covering note says it replaces the earlier
quotation, and a new-conversation subject reads "Revised quotation … (Rev 1)" (a reply keeps the
thread's subject, which Gmail threads on). The PDF: REVISED QUOTATION, Quotation No "… Rev 1",
file "Revised-Quotation-ALG09014-26-Rev1.pdf". The customer's page shows the same. `mail_log.
has_attachments` is Outlook's flag and leaves out inline pictures (the logo), so true means a file
(the PDF) went.

**No totals on the quotation the customer sees (1 Oct).** The mail (built table, the desk's text
layout, the air table), the PDF and the quotation page show each charge and its own figure, and no
group or grand total; the rates of exchange stay. Totals stay inside the CRM (Billing, the paste
review). The customer's page asks for nothing but the two buttons; accepting shows "Thanks for
accepting — please provide the shipper details" and one box (`lib/shipperText.ts`: first line the
name, the rest the address, an email kept as the email; a single line splits at its first comma),
then "We have the shipper details". The faded copy of the quotation under it is gone.

**Accept from the mail asks for the shipper at once (1 Oct).** The mail's "Accept this quotation"
opens `/q/:token?accept=1`: "Thanks for accepting — please provide the shipper details", the
shipper box, and nothing else (no quotation under it). "Confirm and send the shipper details" records the
acceptance and then the shipper (opening the link records nothing: mail scanners open links).
"Accept now, send the shipper details later" and "Revise this quote instead" sit under the box.
Mails sent before this open the page without `?accept=1`, with Accept / Revise as before.

**Gmail folding the Accept button (1 Oct).** Gmail hides whatever a mail in a thread repeats word for
word from an earlier one behind "•••"; a quotation revised or sent again in the customer's thread
repeated its buttons, terms and footer, so Accept went behind the dots. Hidden per-send marks
(display:none) were tried and did nothing — Gmail compares what is visible — and were taken out.
Each send now says when it was sent, visibly: "Sent 1 Oct 2026, 3:05 pm. Accepting ALG… asks…"
under the buttons (same block) and "Quotation ALG… Rev 1 · sent …" as the footer's last line
(`quotationMail.sentLine`, `letter({ stamp })`). That alone did not stop it either. The cause was
the reply itself: ComposeMail put the message being answered — the earlier quotation — quoted under
the new one, and Gmail folded from the first part the two shared. A quotation now goes without the
quoted thread (`ComposeMail quoteThread={false}`, set by QuoteSend); it still threads by its reply
headers (Graph createReply), and ordinary replies still quote. Quotations stay in the customer's
thread (the user does not want revisions split into new conversations).
After that only the button block still folded: it was the one block repeated exactly (the send time
sat in a paragraph beside it). The caption is now a second row of the buttons' own table, and each
button label ends in the send's time as a run of zero-width characters (`sendSignature`) — invisible,
surviving `sanitise` and `forOutlook`, and different on every send.

**A table pasted goes out as a table (1 Oct).** `services/pasteQuote` `tableLayout(enquiry,
pasted_text)`: the desk's rate table (CHARGES | CURRENCY/QUANTUM | RATES | INR | GST | TOTAL VALUE
IN INR) for an air enquiry **or any rate pasted as a table** (a tab in the kept paste), whatever the
enquiry's mode; text pasted on a non-air enquiry keeps the red-heading text layout. GST is kept and
shown (paste review, charges grid via `QuoteCharges withGst`) wherever the table goes. The weight a
rate states ("GWT:578 KGS", chargeable over gross — `statedWeight`) now sets a per-kg charge's
quantity when the AI put the enquiry's weight or 1 (`withStatedWeight`), and the table's first
line's GWT.

**Booking confirmation mail, plain (1 Oct).** `lib/confirmationMail.ts`: the letterhead, "Dear …,
Your booking has been confirmed.", the shipment details and the sign-off. The "Rate agreed" block
(with the quotation's total) and "What happens next" / "keep the reference in the subject" are gone.

**Partners by country (116, 1 Oct).** The user's request: partners divided by country, the country
mandatory when a partner is added, and in Live rates "click Taiwan → its agents → mail them, and what
went to them visible there". It is a way of choosing inside the two Live rates tabs, **not a tab of
its own** (the user corrected a first version that was one).
- `partners.country` (116): the database refuses a new partner without one and refuses blanking one
  once given; partners saved before keep "" and show as "Country not set" (directory, pickers) until
  edited. The partner form asks for it (required, with the list as suggestions) and saves
  `lib/countries.ts`'s spelling: "taiwan", "Taiwan, ROC" and "TW"-style short forms ("UAE", "USA",
  "U.K.", "Korea", "Burma") are one country; anything not on the list is refused with a sentence.
  Hong Kong and Macau are their own. Tests: `scripts/tests/countries.test.ts`.
- `components/CountryPartnerPicker.tsx`, used by the shipment rate request (`RateRequestForm`, so the
  case file's Ask partners too) and the Sunday request editor: country chips with counts and how many
  are chosen in each; a country lists its partners to tick ("Choose all in Taiwan"); choices carry
  across countries ("Chosen:" at the foot); the search looks across all countries. The role chips
  went (the role is on each row and the search matches it).
  On both, choosing partners is step 1 (the Sunday editor: 1 partners by country, 2 the service, 3
  the mailbox; the user, 1 Oct). While no partner has a country yet, the picker says so above
  "Country not set", with a link to the directory.
- Under a country's list, what its partners were already sent: on the shipment form, their
  `partner_quotes` from any job (`rfq.rateRequestsTo`: date, job, status, amount, services, mailbox);
  on the Sunday editor, their `live_rate_sends` (Sunday or by hand, sent or the refusal; tests left
  out). Each mail's own preview is still "Their mail" (shipment) and "Preview" (Sunday).
- Seeds (`seed-partners`, `seed-showcase`) now give a country, or 116 would refuse them.

**Partner rates on every tab of the enquiry (4 Oct).** The work runs enquiry → ask partners →
their rates → quote the customer, and asking lived only on the Partners tab. `PartnerRatesBar`
sits under the workflow on every tab but Partners: "Not asked yet", or "3 asked · 2 replied · best
USD 1,150 from …", with **Ask partners** (the same `AskPartners` / `RateRequestForm`: by country,
services per partner, one mail each) and **See replies** (to the Partners tab, where each thread
can be read and replied to). The form now has **New partner**: `PartnerForm` inline, saved to the
directory and chosen for the request at once (`PartnerForm onSaved` now passes the saved partner);
a half-typed partner holds the dialog open as a send does.

**DSR: the desk's twenty columns only (4 Oct).** `lib/dsr.ts` `DSR_COLUMNS` is exactly the desk's
sheet: S.NO, ENQ.NO, BOOKING NO, BL NO, CUSTOMER NAME, TERM, MODE, PORT, BOOKING RECEIVED, BOOKING
CNFR, PICKUP DATE, PKG, WEIGHT, CBM, VESSEL NAME, CUT-OFF, ETD, ETA, REASON, STATUS. The AGENT NAME
column (the desk's copy only, before) is gone from the screen, the desk's download and the
customer's copy alike; `dsrSheet` no longer takes `forCustomer`, and the loader no longer looks up
partner assignments.

**Editing a sent quotation makes its revision (118, 4 Oct).** A sent quotation's charges are
editable on the Quotation section (`QuotePanel`: locked only when not draft or sent). The grid says
"Sent to the customer. Change any charge below and it becomes Rev n". The first change calls
`reviseQuote` (services/quoteLines → `revise_quote`) once; that change and every later one — cell
edits, removals, new charges, rate-master fills — go to the copy (`QuoteCharges` `target()`, the
line map), and the panel then shows the new draft, to approve and send as REVISED QUOTATION Rev n.
The version the customer has keeps its figures. The paste box's "or revise it charge by charge"
(which started an empty version) is now "or change the charges below" once a quotation exists.

**Consol build plan (5 Oct), one step at a time.** 1 master B/L, export (done) · 2 master B/L,
import (done) · 3 co-loading, buying space
on another consolidator's box (done) · 4 co-loading, selling space on ours (done) · 5 console P&L (done) · 6 CFS and containers (done) · 7 destination deconsolidation (done) · 8
destination filings (UAE MPCI, EU ICS2, US AMS/ISF — when the user names the provider) · 9 agent
profit share, DG acceptance (done) · 10 own MTO registration, consolidator bond, eBL (done). No GST e-invoicing:
turnover under ₹5 crore (user, 5 Oct).

**Co-loading: space bought from another consolidator (121, 5 Oct).** A console's **Space** section
(`components/ConsoleCoload.tsx`, under "The master bill") switches between our own box with the line
and space bought from a co-loader: the co-loader (consol partners listed first), their rate per W/M,
currency and minimum W/M. `lib/coload.ts`: W/M is the houses' total, the greater of CBM and tonnes
(`wmOf`), the minimum applied once (`coloadFreight`); what the co-loader billed on the console in
each currency and in ₹, credit notes off, cancelled bills out (`coloaderBilled`) — shown beside the
freight, not as a mismatch, because their invoice carries their other charges. **Email a booking
request** (export and cross-trade): the lane, ETD, the cargo as one consignment, the commodities from
the house bills, our agent as consignee, the rate. A co-load console is the same console in every
other way: the manifest, our own house B/Ls, and the master B/L panels with the co-loader in the
line's place — on export (119) the SI goes to the co-loader for LCL/LCL, no box, seal or shipper's
load clause, the houses' totals (`MasterConsole.coload`, SI PDF titled CO-LOAD); on import (120) their
B/L copy, their release, their charges, their DO, and their CFS noted rather than nominated
(`stepsFor`, `releaseInHand`, `clearedWith`); a house's DO waits for "Co-loader's DO". The console row
shows a Co-load pill and W/M in place of the load factor; "Carrier" reads "Line they ship on".
**Costs**: every console now shows `BillsPanel` for its own bills (`bills.console_id`) when the
accounts desk is on. Tests: `scripts/tests/coload.test.ts`.

**The partner's rate and the profit on the job (128, 5 Oct; the user: "paste the original rates
their partners give … the original rate and the quoted rate … profit or loss per job, done
properly").** The partner's rate is pasted as it came in the **Original rate** box (below), in
`PasteQuoteDialog` with `purpose="cost"` (same AI reader and checking; a
partner picker or a name; no terms, validity or mail preview) and kept in `enquiry_buy_rates` by
`services/buyRates.ts`, apart from the quotation, so a quotation pasted again, revised or sent leaves
it standing; each save is on the timeline. `lib/jobProfit.ts`: charges matched on a key
(`chargeKey`: brackets, "charge(s)"/"fee(s)" dropped, O/F, OF, AF, THC, D/O, B/L-documentation,
EXW, C/C, FSC, SSC, BAF read as one), within the group first then anywhere, each partner charge used
once; a matched pair counted on the quotation's quantity (each its own when the units differ), in
rupees at the partner's rates of exchange, before GST; a partner-only charge is a cost the desk
carries, a desk-only charge all margin, an "at actuals" charge nothing; a currency with no rate of
exchange is said, not counted as free. The quotation is the accepted one, else the latest draft or
sent (`profitQuoteOf`). The **Profit on the job** card under the quotation (Shipment process) shows the original rate, your quotation, profit or loss and margin, and
every charge side by side; with no quotation yet, **Start the quotation from it** makes a draft with
the same charges for the commission to go on in the grid (`quoteFromBuyRate`). The partner rates bar says
"Original rate ₹… · quoted ₹… · profit ₹… (n%)". The job P&L's quoted cost (Job Closing) is this
rate, worked out the same way (`services/jobPnl.ts`), else the quotation lines' typed costs as
before. Tests: `scripts/tests/jobProfit.test.ts`.

**The Original rate box and pastes that add up (129, 5 Oct; the user: "a partner might revise the
rate, or send rates for half the things and send later, and all this should properly go and sit in
the original rate place").** `components/OriginalRate.tsx` sits right under the partner rates bar
on every tab: the charges so far (charge, whose and when, rate with "was …" when revised, qty, ₹,
× to take one off), the total before GST, a paste box always open, the paste history (what each
paste changed, and what was pasted), and Clear. A paste is merged into the rate
(`lib/buyRate.ts` `mergeBuyLines`, saved by `addToBuyRate`): the same charge (the `chargeKey`)
in the same group is updated in place and keeps its old figure; a charge not there is added; a
charge not in the paste stays; "This is a whole new rate" in the dialog replaces it all. Origin THC
and destination THC are two charges. Rates of exchange are merged, the total worked out again, and
the timeline says "Partner's rate from X: 1 charge updated, 2 added — the original rate is now
₹…". Tests: `scripts/tests/buyRate.test.ts`.

**The overseas agent's profit share (130, 6 Oct; consol build plan step 9).** The agreement is on the
agent (Partners: "Profit share … % of the profit", "A loss is shared too"); a console can be agreed
differently ("This console only", 0 for none). `components/ProfitSharePanel.tsx` sits on the console
under its P&L and, for a job on no console, on the job's Costs tab (the routing agent, or the
overseas agent assigned on the enquiry). It works the console's (job's) profit out as the P&L does,
less the notes that settle a share (`lib/profitShare.ts` `withoutShares`: our notes marked on the
invoice, the agent's marked on the bill with "Their profit share" in Costs), takes the agreed share —
a profit: we owe them, our **credit note** (OCN); a loss shared: they owe us, our **debit note**
(ODN); a loss not shared: nothing — and nets every note either way, drafts included, against it, so
a late bill is settled by one more note for the difference, never by sharing twice. **Draft the
credit/debit note** (in their currency at the rate of exchange, from their last note or bill)
calls `raise_profit_share`; **Issue it** here or in Accounts → Overseas credit/debit notes; it nets
on their statement of account (037). "Not final" says when a house is still at its quotation or a
cost is a draft bill. **Email the statement**: each house's revenue, cost and profit, the share,
every note and what is left. Tests: `scripts/tests/profitShare.test.ts`.

**Dangerous goods accepted into a console (131, 6 Oct; step 9).** `components/ConsoleDg.tsx`, on an
export console above the CFS section: every house marked hazardous (or with a UN number or class).
Its UN number, class, packing group, flash point and "MSDS in hand" are edited there but written to
the enquiry, which the job follows (065); the MSDS date, the shipper's signed DG declaration and the
line's (co-loader's) DG approval reference are the job's. `lib/dgAcceptance.ts`: classes 1, 6.2 and
7 are never taken; 2.3, 4.x, 5.x and 6.1 warn (many refuse them in LCL); UN number four digits, a
UN0… number only for class 1; packing group required for 3, 4.2, 4.3, 5.1, 6.1, 8 (a warning for
4.1 and 9, and when one is given to a class that has none); flash point for class 3 (a warning above
60 °C); MSDS in hand and under five years old; the declaration; the approval; and the IMDG
segregation table (7.2.4) by primary class against every other DG house — "away from" is a warning
(the same box only with the competent authority's approval), 2–4 stop it; 2.3, 6.1 and 8 warn to keep
them from foodstuffs. **Accept into the console** (`accept_dg_house`) once nothing is red, with a
note for the warnings. An accepted house that a later house conflicts with says so in red; changing
its class, UN number, packing group or console takes the acceptance back. The master B/L
instruction's checks list a DG house not yet accepted. Tests: `scripts/tests/dgAcceptance.test.ts`.

**Company setup: registrations, our own MTO, the eBL (132, 6 Oct; step 10).** Admin → **Registrations
and bond** (`components/CompanyRegistrations.tsx`): the MTO registration (DG Shipping), the consol
agent registration with Customs, the customs bond, the bank guarantee, the eBL platform and anything
else with an end date — number, who issued it, dates, amount — each said in force, running out
(inside 60 days), run out or with no end date (`lib/registrations.ts`). Renewed: **Retire** the old
one (kept) and add the new. `components/RegistrationAlerts.tsx` tells the console desk (top of
Consoles) what has run out or is running out. **None of the real numbers are in yet: the user enters
them.** The house B/L form offers "Our own · <number>" as the MTO it is issued under once the
registration is on file and in force, and takes it by default for a new B/L; the B/L then says
"Issued under our own MTO registration …" and is signed for Aashish as carrier. **Electronic B/L**:
a fourth release mode on our house B/L and on an agent's received one. No paper originals; the PDF
is one page, "print of the electronic B/L — not a document of title", with platform terms. The
release card: eBL issued on the platform (reference, issued to) → title transfers recorded →
surrendered to our agent on the platform → released (the database refuses the release before the
surrender). On an import, the agent's eBL surrendered to us is the release-checklist line; the
arrival notice tells the consignee to surrender it on the platform (the `arrival-notices` function
redeployed with that). No platform API is connected: references are typed from the platform. Tests:
`scripts/tests/companySetup.test.ts`.

**Paste a quotation: bugs fixed (6 Oct, the user: "check the quotes pasting function for any
bugs").** (1) The figure boxes in the paste screen (rate, units, %, rate of exchange) read the
number on every key, so a decimal point vanished as it was typed: 1150.5 became 11505, 83.25 became
8325. Now `components/FigureInput.tsx` keeps the text while typing (`lib/figures.ts parseFigure`,
commas allowed). (2) A currency outside the usual six (CNY, JPY…) was saved as INR, the figure
unchanged; the reader was also told to use only the six. Now `currencyOf` keeps any code and reads
₹/$/€/£/Dhs/RMB; such a charge needs its rate of exchange like any other, and the paste screen and
the charges grid offer the line's own currency. (3) Two charges of one name under different
headings (THC at origin and at destination) both took the first heading; `sectionsByHeading` now
matches each to its own row, in order. (4) The reader read only the first 12,000 characters, so a
long rate sheet lost its last charges silently; now 30,000 for a paste (`PASTE_LIMIT`), and a
longer paste is refused with what to do. (5) A draft's charges were deleted, then the new ones
added: a failure between left it empty; now one step (133). (6) The draft's own terms were kept
but not shown in the terms box, so one removed there stayed; now the box starts with them and
saves as shown (terms under other headings stay). Also: units of 0 are refused at saving, and the
charges grid reads "1,150" as 1150 (it saved 0) and puts back anything that is not a figure.
`classify-enquiry` redeployed (verify_jwt on). Tests: `scripts/tests/pastedQuote.test.ts`.

**Import or export on the shipment (134, 135, 6 Oct; the user: "explicitly give option to choose
whether the shipment is an import or export, things will change").** `TradeDirectionPicker` in the
shipment header: Export · Import · Cross trade, asking first and saying what changes. It writes the
enquiry's `trade_direction` (the job's fact, which the shipment follows, 065); the database re-lists
the workflow and the customer's milestones (134). Locked on a signed-off, cancelled or delivered job.
`stagesFor(mode, direction)`: an import's stages are booked → sailed → arrived → delivered, so the
header's "Mark …" offers sailed, not stuffed. Already following it: customs (077), the pre-alert
(078), the received B/L and CSN (088, 097), free time (083), the consoles a job can join.

**Debit & credit (7 Oct; the user: "debit credit pages… how much debit and credit is involved in each
shipment and with which party, graphs, simple and understandable").** `/accounts/debit-credit`
(`pages/accounts/DebitCredit.tsx`, in the Accounts menu after Final bill). Debit = what we billed them
(issued tax invoices and debit notes, to a customer or an agent, less our credit notes); credit = what
they billed us (every bill not cancelled — carrier, vendor, agent debit notes — less agent credit
notes); the final bill's rules (job_final_bill, 042), rupees with GST. Settled beside each document
(confirmed payment allocations, TDS as settled, as a share of the document's own currency). The page:
period (month / 3 months / FY / all) and search over everything; five figures (debit, credit,
difference, still to collect, still to pay); debit and credit month by month (paired columns); the
biggest shipments and parties (paired bars); every one in a table (by shipment / by party). A
shipment (`?job=`) opens to who it is with — paired bars per party, where each stands ("owes us",
"we owe", "settled") — and its documents; a party (`?party=`) to its shipments and documents. A
console's own documents (a master bill) are a row of their own, not split across jobs (that is the
P&L's estimate). Excel of all three lists. Logic `lib/debitCredit.ts` (tested,
`scripts/tests/debitCredit.test.ts`), reads `services/debitCredit.ts`, charts
`components/DebitCreditCharts.tsx` (debit blue #2a78d6, credit orange #eb6834 — the P&L's pair,
validated: CVD ΔE 24.7, both ≥3:1 on white). No migration.

**Team oversight, by person (7 Oct; the user: "make it employee based… each employee's name and when they
click on it it should show their actions… categorized into subsections").** `pages/Oversight.tsx` was four
tabs (Activity, Mail sent, People, Enquiries); it is now everyone on the desk down the side (name, actions
in the period, last activity, what they hold) and, for the one picked (`?person=` in the address, so Back
works and a link opens on them), their work in sections — Mail sent, Enquiries & queue, Quotes & rates,
Bookings & jobs, Documents & B/L, Consoles, Accounts (Other for a kind nobody has placed) — each with its
kinds to narrow by and the first eight with the rest a press away, or the same as one timeline. Their
mailbox's copy status, who they wrote to most, "Holding now" (open enquiries and jobs in process), and how
long after it came in they took each enquiry on. With nobody picked: the desk's figures, the enquiries
nobody has taken on (oldest first), the mailboxes being copied in. On a phone the list is the page until a
name is picked. Data: the mail log as before plus `team_actions` (137, services/teamActions.ts, paged);
sections and labels in `lib/oversight.ts` (`buildFeed`, `categoryOf`, `sectionsOf`, `labelCounts`; a new
event kind needs a line in `EVENT_LABEL` and `place(...)`), tested in `scripts/tests/oversight.test.ts`.
Still no ranking: people in name order, counts only.

**Speed (6 Oct; the user: "a lot of loading… implement caching, reduce the latencies of the entire
app").** Measured first: the database answers in 1–30 ms; a round trip Chennai → Mumbai (ap-south-1)
is 120–240 ms, the first on a new connection 1–2 s. The waiting was trips, and every page forgetting
its data. What was done:
- **`lib/queryCache.ts`**: `peek`/`put` snapshots (memory + sessionStorage for the tab's life, cleared
  on sign-out) and `shared(key, fn, ttl)`: one trip for the same read made at once (ttl 0), or kept a
  while for lists whose writes `invalidate` them (partners 30 s, people and registrations 60 s). Keys
  start with the table's name; `useTableChanges` invalidates the tables it hears change. Each caller
  gets its own array.
- **`lib/useCachedState.ts`** (`useCachedState`, `useCachedMap`): a page's state kept between visits;
  the third value says whether the page has been read before, so a list read and found empty shows
  its "none yet" at once and only a page never read shows the skeleton (nothing is kept until read).
  Also on (second pass, 6 Oct): the accounts registers, payments and settlement lists, Outstanding,
  Payables, Final bill, Agent SOA, a job's Containers, Customs, Pickup & delivery, Invoices and Costs,
  the customer and partner files, partner mail, the case file's partners and partner replies, Live
  rates for a shipment, the reply log. Not on the editors (house B/L, HAWB, invoice, customer and
  partner edit): a refresh landing under somebody typing would undo their typing.
  On: Overview, Enquiries, My enquiries, Enquiries overview, Shipments in process/completed,
  Customers, Partners, Quote approvals, Sailing schedules, Job closing, Consoles, Analytics,
  Documentation, Rate master, Live rates, Oversight; the case file (per ref), the shipment page (per
  id), its workflow bar and Tracking tab; Mail (each folder's list). A page opens on its last view and
  reads again behind it; the skeleton only when there is nothing yet. Measured with 250 ms a trip:
  board 333 ms first, 41 ms back; case file 322 ms first, 33 ms back.
- **Shared reads** (in-flight): `getEnquiry`, `partiesFor`, `quotesFor`, `shipmentFor`, `threadsFor`,
  `getConsole`, `shipmentsOn`, `manifestFor`, `getBuyRate`, `linesFor`; ten console panels asking for
  partners make one trip, six asking for a console's jobs one.
- **Fewer waves**: the case file reads the enquiry with its six other reads at once and no longer waits
  for Outlook (the mail fills in, "Reading the mailbox…"; `correspondenceFor` takes the parties and
  customer it was given). The shipment page reads its boxes with the job, and the enquiry too when the
  job's reference is known. Mail shows the folder when Graph answers (the intake lookup after) and
  checks snoozes alongside, not first.
- **Start-up**: the profile is remembered (`araxys:profile`, sessionStorage like the sign-in, the person's own) and the
  app opens on it while it is read again; read once, not twice (the INITIAL_SESSION event); a failed
  re-read keeps it. `index.html` preconnects to the database and prefetches Graph's DNS.
- **Bundle**: `vite.config.ts` `manualChunks`: vendor-react, vendor-router, vendor-supabase, kept by the
  browser across releases. `AppLayout` fetches every desk page's file when idle, most used first, one
  at a time (not on save-data). `main.tsx` reloads once on `vite:preloadError` (a page file removed by a release).
- **Service worker**: a navigation waits two seconds for the network, then opens the kept page.
- Not done, and why: jsPDF (127 KB) still loads with the case file and shipment pages — its own file,
  cached once; making it lazy would change ~40 call sites to async. Gemini's paste reading and Graph's
  mailbox search are the services' own time.

**Speed, third pass (7 Oct; the user: "scan the entire software… very fast and snappy… do not break
any function").** Measured from the desk's browser: a request on an open connection ~50 ms; the first
after 40–50 s of quiet 270–320 ms (the connection had closed); each new kind of request also pays a
CORS preflight once an hour (`access-control-max-age: 3600`, per URL), which is why a first open costs
two trips. The database stays at 1–30 ms. What was done:
- **No trip to learn who is signed in**: `myId()` (lib/supabase.ts) reads the session the tab holds.
  `auth.getUser()` asked the auth server before every write it was used for (logEvent after most
  actions, created_by/done_by fields — 15 places); the database still checks the token on the write.
- **Read ahead of the click** (`lib/warm.ts`, wired in `layout/AppLayout.tsx`): a pointer resting 80 ms
  on any link, pressing it, or the keyboard reaching it, reads the case file (with its mail), the
  job (with its workflow bar and routings), the customer, or the boards it leads to, under the pages'
  own snapshot keys — change a page's `useCachedState` key, change warm.ts too. A page opened while
  the reads are on their way joins them (shared reads); one opened after shows them at once. The
  boards (overview, enquiries, my enquiries, completed) are also warmed once at idle after start-up;
  In process is not (its cards sort by steps read after the rows). Measured with 250 ms a trip: case
  file 305 ms → 118 (hover 150 ms before the click) → 10 (400 ms); job 275 → 111 → 21.
- **Shared reads made safe** (`lib/queryCache.ts`): every request leaving the Supabase client is seen
  (`global.fetch` in lib/supabase.ts); anything but GET/HEAD counts as a write (`noteWrite`), and a
  read already on its way when a write went out is neither joined by a later caller nor kept (ttl).
  `invalidate` drops in-flight reads too. Tests: `scripts/tests/queryCache.test.ts`. Newly shared:
  `eventsFor`, `getShipment`, `listDimensions`, `listQuotes`, `shipmentMargin`, `shipmentBilling`
  (new, services/bills), `listShipmentContainers`, `checkpointsFor`, `routingsFor`, `getCustomer`,
  `getSummary`, `shipmentsFor`, `enquiriesFor`, `correspondenceFor`, `recentEvents`, `countWaiting`.
- **The case file's mail starts with the file** (and the shipment's Mail tab): its database reads go in
  the first wave, so Outlook is asked a round trip sooner.
- **Kept per job, too**: the Documents, Sign-off, Warehouse and Parties tabs' lists, the Routings panel;
  the shipment Mail tab uses the case file's own keys (`case:REF:…`), so either opens on the other's.
- **Mail** (services/graphMail.ts): a message opened is kept in memory (80, 15 min; never storage;
  not drafts; read/flag kept current by `setRead`/`setFlag`; moved/deleted forgotten; cleared with the
  Outlook link on sign-out) — reopening is instant instead of 300 ms–1 s; a row the pointer rests on is
  read ahead (`prefetchMessage`, MailListRow `onWarm`). The reading pane takes read/flagged from the
  list, which changes the moment they are pressed.
- **The line kept open** (`lib/warmLine.ts`): the gateway's health check every 20 s while the tab is in
  view and somebody moved or typed in the last 10 minutes; at once when they come back after a pause.
  The public key goes in the address, so the browser sends it without a preflight.
- **Icons in one file** (`vendor-icons`): ~120 files of a few hundred bytes were 20–60 requests per page
  opened; the build went from 204 files to 162. Graph is preconnected at start-up.
- **Phones and iPads** (7 Oct, "faster and snappier on mobile n iPad"): a finger has no hover, so a
  touch on a link reads ahead 50 ms in unless the browser calls it off as a scroll (pointercancel), or
  as the finger lifts — flicking through a list reads nothing (AppLayout; MailListRow the same).
  `html { touch-action: manipulation }`: no wait for a possible double-tap zoom. No frosted glass on a
  touch screen (Topbar solid `bg-surface-1` under `pointer: coarse`, the Mail toolbar below lg, the
  drawer's scrim): blurring what scrolls under a sticky bar costs every frame on a phone. (Note: the
  colour tokens are plain `var()`s, so `bg-surface-1/95`-style opacities generate nothing — the bar was
  only ever blur.) A phone (< 768 px) or a 2g/3g connection prefetches only the core pages (boards,
  case file, job and its common tabs, mail); Safari, which has no idle callback, waits for a second with
  no touch/scroll/key before each file. The line kept open stops two minutes after the last touch on a
  touch screen (the radio), and a tap counts as activity. The sign-in clip is not put on the page below
  lg — a hidden `<video preload>` still downloaded its 1.6 MB.
- **Mail and My enquiries opened at once** (7 Oct, "pre load the most used pages regardless of hover"):
  1.5 s after the app opens, `warmBoards` (My enquiries, Enquiries, Overview, Completed) and then
  `warmMail` (lib/warm.ts: the folder list and the Inbox's first page under the Mail page's own keys
  `mail:<box>:folders` / `mail:<box>:inbox:all`, and on a laptop or iPad the newest three bodies into
  graphMail's memory) — every device, before any hover. Not when Mail is the page already open, nor
  without Outlook connected. Reading marks nothing read. Measured with 400 ms an Outlook trip: Mail's
  first open 412 ms → 4 ms.

**At destination (step 7, 126–127, 5 Oct).** `components/ConsoleDestination.tsx` on import
consoles, data from `services/destination.ts` `destinationFor`. **Arrival notices**
(`lib/arrivalNotice.ts`, copied verbatim into `supabase-v2/functions/arrival-notices` with
`company.ts`; a test keeps them identical): per house, from the records (`arrivalHouseFrom`: their
HBL, the master, vessel, ETA, IGM, the boxes, packages, the CFS, how their B/L is released, freight
collect) to the job's consignee address or the customer's (`consigneeEmail`), with what they need to
take delivery (`deliveryNeeds`). The desk sends one from its Outlook (**Email**, recorded `desk`), or
the CRM sends them: **Send the waiting now** (function mode `console`, from the console's mailbox or
the caller's) and **Send automatically** per console (mailbox and days before the ETA; the sweep
sends each waiting house once the ETA is within the days and not more than a week past it,
`arrivalDue`). The function claims a house (sets its sent_at) before sending so nobody gets two,
undoes the claim on a refusal, logs every send in `arrival_notice_sends`, puts a sent notice on the
timeline, paces two seconds apart for 100 s a run. **It needs the Azure app's Mail.Send (application)
with admin consent, as live rates does; "Can the CRM send?" (mode `check`) says whether it has it;
until then sends are refused and shown on the console.** Deployed with `--verify-jwt`; smoke-tested
5 Oct (sweep with nothing on: ok, sent 0; anon refused; the scheduler refused anything but the
sweep). **Outturn** (`lib/outturn.ts`, `lib/documents/outturnReportPdf.ts`): per house manifested
(their HBL's packages, else the job's) against landed (its warehouse receipts, recorded here at
destuffing with condition and remarks: **Record**), clean / short / excess / damaged / not tallied;
PDF and mail to the origin agent, recorded. **Release and DO**: each house's release checklist
(088's, with the console's line DO and destuffing, 120) as chips, DO issued / ready / n to do; the DO
itself is issued on the job's Bill tab. Tests: `scripts/tests/destination.test.ts`.

**At the CFS (step 6, 125, 5 Oct).** `components/ConsoleCfs.tsx` on export and cross-trade
consoles, data from `services/consoleCfs.ts` `cfsFor` (jobs, warehouse receipts, enquiry piece sizes
and stackable/unit, job box lines, accepted quotations' lines, the manifest, the agent; the queries
were checked against the live API). **Declared and measured** (`lib/cfsMeasure.ts`): each house's
declared pieces/kg/CBM against its receipts (the warehouse's tolerances), declared or quoted W/M
against measured, and the invoice change at the quoted rate per W/M (`quotedPerWm`: the accepted
quotation's W/M and CBM lines together); **Use measured** (`applyMeasured`) puts the CFS's figures
on the job (piece_count, gross_weight_kg, volume_cbm) and logs `cfs_measured` with the declared
figures. **Load plan** (`lib/loadPlan.ts`): standard internal box sizes, doors and payloads (`BOX`);
pieces in cm/kg from the enquiry's dimension lines, stacked to the box height when stackable,
turned to take the least floor, rows across the width, houses heaviest first and each together,
short rows sharing a strip; a house without sizes drawn from its CBM 2 m high (estimated); fits /
floor m / volume % / payload %, problems (door height and width, floor overrun, payload), floor
metres per house, `smallestBox`; an SVG top view (nose left, doors right). The box is the sailing's,
else `consoles.box_type`, else the smallest it fits; the header's load factor and the P&L now use
`box_type` too. **Stuffing report** (`lib/stuffingReport.ts`, `lib/documents/stuffingReportPdf.ts`):
each box with its seal and every house in it from the jobs' box lines (a split house in each box, a
house in none listed as such), with the tally (received against declared) and condition; stuffed-on
date, PDF, mail to the destination agent with the PDF, recorded. Tests:
`scripts/tests/consoleCfs.test.ts`.

**Console P&L (step 5, 5 Oct; no migration).** `components/ConsolePnlPanel.tsx` on every console
when the accounts desk is on, above Costs. The money is the job P&L's (`lib/jobPnl.ts`
`buildEntries`: issued invoices less credit notes, bills, before GST, a console's own bills shared
across its jobs by volume), loaded for one console by `services/jobPnl.ts` `loadConsolePnl` (the
loader now shares its query and assembly with `loadPnl`, which Job Closing uses; the queries were
checked against the live API). `lib/consolePnl.ts`: a house not yet invoiced counts at its latest
accepted quotation ("quoted"); each house's own cost and its share of the box; the console's revenue,
cost, of which the box and console, GP and margin; space — usable CBM of the box (`CAPACITY_CBM` by
the sailing's container type), sold CBM and W/M, W/M to co-loaders (`PnlJob.coloader`, from
`customers.forwarder`), load factor, the box's cost per usable CBM, revenue per CBM sold, and the
break-even CBM. On a co-load console there is no box of ours: no load factor or break-even. Tests:
`scripts/tests/consolePnl.test.ts`.

**Co-loading, selling space on our console (124, 5 Oct).** A co-loader is a customer marked
**Freight forwarder (co-loader)** on their customer record (`CustomerEdit`); they come through the
normal flow (enquiry, quotation per W/M, booking, a job put on the console), so price and invoice are
the job's. On an export or cross-trade console, **Space sold to co-loaders**
(`components/ConsoleColoaders.tsx`, `lib/coloaderSale.ts`, `services/coloaderSale.ts`) lists the jobs
whose customer is a forwarder: W/M, the latest accepted quotation's ₹, our house B/L to them (draft /
issued), and the share of the box (`coloaderShare`); `coloaderIssues` flags a missing email, no
instructions sent, our B/L naming somebody else as shipper, no accepted quotation. **Stuffing CFS**
(`consoles.cfs_name`) and **Email** per co-loader: the delivery instructions (`instructionsHtml`:
console, vessel, ETD, CFS cut-off, the CFS, our reference, and the shipping instructions we need for
our B/L), recorded on the job. On the house B/L form a forwarder's job says "Co-load for …" with
**Make … the shipper** (from the customer's billing name and address). Tests:
`scripts/tests/coloaderSale.test.ts`.

**Quotations go for a single unit (5 Oct, user: "all quotes shud go for a single unit do not calculate
full").** What the customer sees quotes every charge for one unit — its rate per kg, CBM, container or
shipment, and that one unit in rupees — never multiplied out by the cargo, and no totals. The mail's
text layout and air rate table (`lib/pastedQuote.ts` `singleUnit`, `airTable(q, e, { singleUnit:
true })`, through `chargesLayoutFor` / `airTableFor`), the mail's own table for a quotation built
charge by charge ("Rate per unit", the rupee figure under a foreign rate), the PDF (columns Charge,
Currency, Amount per unit, Min, Per unit (INR)), the customer's /q/ page and the paste dialog's
preview. A share of other charges ("3% on OF+EXW", saved as "Name (3% on …)", `shareOf`) has no
figure for one unit and goes as its wording. The air table's top line still states the cargo (GWT,
CHWT). The desk's own charges grid, the approval and the stored `mail_text` keep the full figures.

**House B/L: shipper approval, amendments, the house against its master (123, 5 Oct).** Three gaps
the user agreed to close. (1) **The shipper approves the draft.** On the house B/L form (`HblForm`) a
strip under the toolbar says where it stands (`lib/hblApproval.ts` `approvalLine`) with **Email the
draft to the shipper** (to `shipments.shipper_email`; the draft PDF attached; a branded letter with
**Approve the draft** / **Ask for a correction** buttons to `/b/<token>?approve=1|correct=1` on
`VITE_PUBLIC_APP_URL`, `hblDraftHtml`) and **Approved another way** (by mail or phone, with how). The
public page `pages/HblDraft.tsx` (route `/b/:token`, also under maintenance) shows the draft as sent,
downloads it as PDF, and records approve or the correction only on a press (`services/publicHbl.ts`).
The shipper's corrections show on the form. An approval is of the draft as sent: a B/L changed after
it reads "changed since" (`changedSinceSent`, a key-order-proof compare). Issuing asks first when the
shipper has not approved this very draft (`issueWarning`) — not refused. (2) **A correction after
issue is an amendment.** Reopening (admin) asks why; the database refuses it without a reason, while
originals are out (089) or once the cargo is released; it counts `amendment`, withdraws the approval,
and the reprint says "AMENDMENT n" on every page (`hblPdf`); reissuing starts the release again with
the new set. (3) **The house against its master** (`lib/houseMaster.ts`): vessel, voyage, ports, each
of its boxes on the master and the seal, and not the master's own number (ICEGATE 2.0). The master is
the console: its particulars, and its boxes from the master copy (import, once read) or the jobs'.
Shown on the form when the job is on a console (and asked before issuing), and per console in
**House B/Ls against the master** (`components/ConsoleHouseCheck.tsx`), ours or the received one per
job. Tests: `scripts/tests/hblApproval.test.ts`.

**Who files the CSN on a co-load (122, 5 Oct).** The user's answer: sometimes us, sometimes the
co-loader, so it is chosen per console. On a co-load console the CSN panel (`ConsoleCsn`) shows "Who
files it: We file our houses / The co-loader files them" (`lib/coload.ts` `csnFiler`; our own box is
always us, with no choice shown). "We file" is the existing CSN panel, our houses under the co-loader's
B/L. "The co-loader files" (`components/ConsoleCsnByColoader.tsx`) emails them our house list — the
manifest PDF and Excel attached, a table of every house with shipper, consignee, packages, kg, CBM,
description and, on an export, each exporter's shipping bill from the job's customs record
(`services/coload.ts` `csnListFor`; `csnListIssues` flags a house without its B/L or shipping bill) —
records when it went, and takes their CSN number and date through `recordCsn`, so it lands on every
job and clears the "CSN due" alerts as ours would.

**Master B/L at this end, import consoles (120, 5 Oct).** `components/ConsoleImportMaster.tsx`
under the house list on an import console, six steps in the order they happen, each a date on the
console (`lib/importMaster.ts` `importProgress`): **1 the copy** from the origin agent, read by the
house B/L reader (`services/masterBill.ts` `readBillFile`, shared with the export draft) and checked
(`checkMasterCopy`) against the console (MBL no, vessel, voyage, ports), the jobs' boxes (each
container, its seal) and the houses' totals; `copyIssues` says what the line or Customs stops on
(consignee not us or TO ORDER, a house B/L with the master's number, freight collect, release not
said). Reading fills only the console's blanks (`blanksFromCopy`). **2 the CFS** nominated to the
line: the letter (`lib/documents/cfsNominationPdf.ts`) downloaded or mailed to the carrier's directory
contact; sending records it, or "Nominated another way". **3 the release in hand**: originals (courier
AWB), telex (number), eBL (transfer ref); a sea waybill needs none. **4 the line paid** (invoice no,
₹), with the console's bills from Accounts listed. **5 the line's DO** (number, valid till; lapsed
while the box is unopened is warned, `lineDoState`). **6 destuffed** on a date. Any step but the
copy can be taken back. **A house's DO waits for its console**: `releaseChecklist` gains
`console_do` and `console_destuffed` items when the job is on an import console (`ReceivedHbl`
loads it); they are recorded on the console, not ticked on the job. Tests:
`scripts/tests/importMaster.test.ts`.

**Master B/L with the line, export consoles (119, 5 Oct).** `components/ConsoleMasterBill.tsx`
under the house list on an export or cross-trade console (an import console keeps the plain MBL
number/date fields). The instruction (`lib/masterBill.ts`): Aashish as shipper, the overseas agent
(with its directory address) as consignee, notify same as consignee, freight prepaid at the port of
loading, "SAID TO CONTAIN n PACKAGES CONSOLIDATED CARGO AS PER ATTACHED LIST", FCL/FCL, shipper's
load and count; the boxes added up from the jobs' container lines (`boxesFrom`: one per container
number, seals and sizes from whichever job has them). The desk's edits are kept as SiTerms; the
boxes are read again each time. Checks before sending (`siIssues`): booking number, consignee,
vessel, boxes, seals, packages, weight, and a house B/L carrying the master's number (ICEGATE 2.0).
**Email the SI to the line** sends the SI PDF (`lib/documents/masterSiPdf.ts`) and the house list
(the console manifest PDF) to the carrier's directory contact; sending records `si_sent`. **Read the
draft** uses the house B/L reader (classify-enquiry `hbl`) and `checkMasterDraft` compares parties,
ports, vessel, every container and its seal, packages and weight, totals and freight; differences
become a corrections mail; approval with differences asks first. Then issued (number, date,
originals / telex / sea waybill / eBL) and released (courier AWB, telex number, eBL transfer
reference). Tests: `scripts/tests/masterBill.test.ts`. No console exists on live data yet.

## 9. Open items

Figures here are as last recorded: 28 Sep for the counts and the mailboxes, 1 Oct for the
Operations tables. They were not re-read for the 1 Oct revision; check one with `run-sql.mjs`
before acting on it.

### Waiting on the user, most urgent first

1. **Make both GitHub repositories private** (`logistics-v3`, `araxys-crm`). Still public on
   1 Oct: an anonymous clone of logistics-v3 worked. The history holds no working secret
   (scanned on 25 Sep and again on 1 Oct: only the shortened prefixes quoted in §1), but it
   publishes every staff address including the admin's, the Supabase project ref, the Azure app
   id, the schema with its policies, and this file, which names every open gap below.
2. **Rotate the credentials in §1**, the Supabase personal access token first: it is issued
   against the account, so it reaches v1 as well.
3. **Decide when to reopen the desk** (§0). Settle 4 and 5 before it does, or the desk comes
   back to sends that fail and a mail reader that does not answer.
4. **Three mailboxes stopped working at 07:45 IST on 28 Sep:** aarathy@, imports@ and parasu@
   answer "No Exchange Online mailbox at this address" to the server's copy (087) every five
   minutes. parasu@ sent 438 of the first copy's 510 mails, so most of the desk's mail is
   missing from Team oversight, and sending from the CRM as any of the three will fail. Most
   likely their Exchange Online licences changed that morning: the Microsoft 365 admin centre.
   - Licences (answered 28 Sep): Exchange Online Plan 1 per mailbox that signs in to the CRM
     is enough; no separate Entra licence is needed. Entra ID Free comes with the tenant and
     covers the app registration, its secret, delegated sign-in (Connect Outlook), application
     permissions and admin consent. Entra ID P1 is only for extras like Conditional Access,
     which the CRM does not use.
5. **The Gemini billing decision (§1).** On the free tier the mail reader sends live customer
   mail under Google's unpaid terms (a DPDP Act question), and on 28 Sep it stopped
   altogether: every model answered 503 or 404.
6. **Narrow what Mail.Send reaches (optional).** Mail.Send (application) was granted with admin
   consent on 1 Oct (checked: the app-only token for `efb90aa6-9404-40d2-be1b-3b6a3d5f5866` now
   carries `Mail.ReadBasic.All, Mail.Send`), so Live rates can send. It lets the app send as any
   mailbox in the tenant. The CRM only ever sends from a CRM login's mailbox (the table's
   trigger), and only an admin changes which. An Exchange `ApplicationAccessPolicy` would narrow
   Microsoft's side too, and would limit the mail copy (087) to the desk's mailboxes. That is the
   user's call. No Sunday request existed on 1 Oct, so nothing goes out until one is made.
7. **The Azure client secret made on 25 Sep** (the mail copy, Outlook renewals, Live rates)
   expires on the date chosen in Azure. When it does, every mailbox shows "Microsoft rejected
   the CRM app's client secret" and Outlook stops renewing. Renew it as in §1; the date is worth
   a calendar entry.
8. **Remove the voice-era function secrets** under Supabase → Edge Functions → Secrets:
   `SNAPSERVE_API_KEY`, `SNAPSERVE_BASE_URL`, `ANTHROPIC_API_KEY` and `EXTRACTION_DISABLED`
   (§2). Nothing reads them, and the session was not allowed to delete secrets.
9. **Tracking feeds.**
   - AeroDataBox rejects the key as "Invalid or inactive". Direct plans have no free tier; the
     free Basic plan is only on RapidAPI (`AERODATABOX_VIA=rapidapi`) or API.market
     (`apimarket`), each with its own key. **The assistant must not sign up for accounts.**
   - aisstream works but hears almost nothing: it has no shore receivers near India or the Gulf.
   - The Hapag-Lloyd API is deferred by the user (`HLAG_CLIENT_ID` / `HLAG_CLIENT_SECRET`).
10. **The Supabase plan.** The Free plan has no managed backups (the nightly export, §13
    "Backups", is the only copy; run `backup-download.mjs` regularly, since a lost project takes
    its bucket with it) and no leaked-password check. Pro, about $25 a month, adds both.
11. **v1's project** (`wremiarcmppuncgfzrqb`), which the live voice agents still share: keep it,
    or retire it together with the agents. Do not touch it until the user decides.
12. **The git identity on the desk machine.** Commits in `araxys-crm-v2` are authored "Your Name
    <your.email@example.com>", git's placeholder. Set `user.name` and `user.email` for the
    repository if the history should say who wrote it.

### On the live data, by hand (the desk's call, not a code change)

- ALG09001, 09003, 09010 and 09011 are marked read with no lane: the reader missed lanes given
  only in the subject before 110. Press "Read the mail again" on each.
- ALG09010-26's thread is still filed on ALG09008-26 (moved by one click on 28 Sep, before 110
  made a move ask first). The desk decides where it belongs.
- The test chain: the "TEST EMAIL" enquiry ALG09004-26 (`accepted` with no accepted quote,
  since its ₹3 quotation was deleted on 26 Sep), its booked shipment ARX-SHP-0004, and the
  customer "kevin imports" (C0004), the user's own test address. Remove them after a backup, or
  keep them as the test case.
- Older intake mails are still waiting on the Enquiries page.
- The partners on the directory before 116 (4 on 1 Oct, 2 of them active) have no country, so Live
  rates lists them under "Country not set". Give each one its country on the directory (Edit).

### Not done yet

- **A full job on the live system, end to end, by the people who will use it.** Every flow
  since 102 was checked in rolled-back transactions (the business flow in `npm run audit`) and
  in preview harnesses with stubbed data; none has been run by a signed-in person on a real
  job. A dummy enquiry mail was written for it: send it in, push it to inbound, then quote,
  approve, accept, book, record the milestones, invoice and sign off. It is the first thing to
  do after reopening. §7 "Not verified yet" lists what else only a real session can show.
- **The first real ICEGATE files.** The export CSN (SCX), amendments (SCA) and the reply reader
  follow Customs' samples where the v1.6 guide is silent or they disagree. Make the first of
  each a test file (T) and read the reply closely (§13, "The CSN for ICEGATE").

### Gaps in the product

- The customer is not mailed when a milestone is recorded; they see it when they open the
  link. A "tell the customer" mail per milestone would be the next step if the desk wants it.
- **Free time (083)** is counted in `lib/freeTime.ts` from dates the desk types per box.
  Nothing fills those dates yet: tracking's `discharged` / `gate_out` events (072) and the
  pickup/delivery moves (079) could suggest them. The tariff is one rate per day; slab tariffs
  and holiday rules are not modelled. LCL (CFS storage) is not counted.
- Live rates: the rates that come back are not read into the Rate master.
- On air, the HAWB form's MAWB boxes do not write `shipments.mainline_no`, so an air pre-alert
  has no MAWB unless one is recorded some other way.
- Shipment row ids are still `ARX-SHP-0004`. Nothing printed or mailed shows them any more
  (documents are numbered `BKG-ALG09004-26`, see `documentNo` in `lib/documents/data.ts`),
  but the job file header and the enquiry register's booking-number fallback still do.
- The house B/L is issued under a partner's MTO registration. When Aashish has its own, add it
  as a partner-like source or a company setting (§13, "House B/L document").
- Complaints has no store and no page: the placeholder that said so was removed on 1 Oct.
- The quotation mail's buttons end in a run of zero-width characters, different on every send,
  so that Gmail does not fold them away in a thread (§8, "Gmail folding the Accept button"). If
  quotations start landing in spam, look here first.
- `docs/submission-answers.md` and `docs/presentation-prompt.md` describe v1's voice agents,
  not this CRM. README.md's "Where the intelligence is" names three uses of the model;
  `classify-enquiry` now has seven modes (reading a mail, `draft`, `quote`, `rfq`, `tracking`,
  `hbl`, `paste_quote`).

### Smaller, from the 28 Sep audit

- `btree_gist` and `pg_net` live in `public`.
- No Content-Security-Policy header on the site (still none on the live response, 1 Oct).
- `classify-enquiry` and `track-shipment` take 1–2 s to cold-start.
- Five tables have two permissive SELECT policies.
- Leaked-password protection is off (it needs the Pro plan, item 10).

### Live data as last recorded

- 28 Sep: 10 enquiries, 2 shipments (both at stage `booked`), 3 quotes, 0 invoices, 0 bills.
- 1 Oct: no sailing schedules, boxes, consoles or rate cards yet (§8, "Operations sweep").
- 25 Sep, the server copy's first run: 510 mails (parasu@ 438, info@ 69, aashish@ 3, aarathy@
  and imports@ none in 31 days).

Done, for the record (all in git history): on 26 Sep, `server/` (v1's Express backend with the
voice-agent import code) went with `scripts/seed-space.ts` and the packages only it used
(express, cors, dotenv, cloudflared); the unused 3D planner (`ContainerPlanView`,
`ContainerScene`, `lib/scene3d`) went; the ₹3 test quotation on ALG09004-26 (against ₹24.6
lakh) was deleted after a backup, with its 2 lines and customer link. On 1 Oct the voice era's
client calls and their in-memory answers (`services/backend.ts`, `mockBackend.ts`) and the
Complaints placeholder went.

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

- **The desk machine's checkout is `araxys-crm-v2`, branch `v2`, with two remotes:**
  - `logistics-v3` (`github.com/kevinsudhan/logistics-v3`): **the deploy.** Push with
    `git push logistics-v3 v2:main`; Netlify builds `main` on every push.
  - `origin` (`github.com/kevinsudhan/araxys-crm`): v1's repository. `v2` tracks `origin/v2`,
    which is kept level with the deploy (the user's wish, 1 Oct): push both. A bare
    `git push` goes there and **does not deploy**. **Never push v2 to `origin/main`,** which
    is v1's branch.
- **A fresh clone** of logistics-v3 checks out `main` with logistics-v3 as `origin`: there the
  deploy is `git push origin main`, and there is no v1 remote to push to by mistake. It has no
  `server-v2/.keys.json` (gitignored); copy it from the desk machine to run the database
  scripts.
- **At the head (1 Oct 2026):** the quotation work through 115 (§8's dated notes), then three
  commits from the 1 Oct revision: September dates in the quotation mail, the voice era's
  leftover code and the Complaints placeholder removed, and this file. Pushed to
  `logistics-v3/main`. The live build is in maintenance (§0), so only `/q` and `/t` show any of
  it. After them, **partners by country** (116, §8), pushed once 116 was applied.
- **Migrations:** the last in the repository is `117-live-rates-8-30.sql`, applied 1 Oct (as was
  116), and the next is `118-….sql`. Each row in §4 records its rolled-back dry run. On 1 Oct, after 116, the
  audit's schema-drift check found every table, column and function the code names live (no
  drift), 115's included. Before relying on its columns: `select column_name from
  information_schema.columns where table_name = 'quote_lines'` should list `gst_rate`.
- **Checked at the head (1 Oct):** `npm test` (60 suites) passing, `npm run build` clean with
  its bundle secret scan, `node scripts/audit/routes.mjs` with no dead links, and
  `node scripts/audit/schema-drift.mjs` with no drift. The full
  `npm run audit` was last run on 28 Sep.
- Nothing temporary is committed: no `__Preview` routes, no `src/__audit.ts` harness, no
  tokens.
- Commit style: a sentence-case subject that describes what the user can now do, a body
  explaining why, and the `Co-Authored-By` trailer.

---

## 12. What changed since 21 September

This covers 21 to 28 September: 63 commits, up to 104. For 105–115 see the §4 table and §8's
dated notes; `git log` has the rest. Grouped:

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
| Customer milestones (102) | see `git log` | The customer's tracking page shows only what the desk records on the job's Tracking tab: each milestone with its day, time, place and a note, the desk's own updates, nothing from feeds or internal steps. The job's records are offered as "Use this"; the stage follows the milestones |
| Live rates (101) | see `git log` | Name a service, pick the partners: every Sunday 8:30 pm IST (10:30 pm until 117) each gets their own mail asking for the coming week's rates, from info@, replies under Partner mail. Send now, a test to yourself, preview, pause; every send and Microsoft's reason for any refusal on the page |
| Customer DSR (108) | see `git log` | Each customer's daily status report on their page: live shipments in the desk's columns, REASON/STATUS written there, Excel download, emailed to the customer with the sheet attached (no agent column), every send recorded |
| Live rates for a shipment (107) | see `git log` | Choose a job and partners, and per partner the services to price; one mail each from your Outlook, filed on the job as a thread under Partners, with the partner added to its parties. The case file's Ask partners uses the same form |
| ICEGATE replies (100) | see `git log` | "Read a reply" takes ICEGATE's ACK or SFL, finds the file by job number, shows each error on its house and container in the desk's words, and on an accepted live file records the CSN number and date and the MCIN/PCINs; a rejected file stops being the amendment baseline |
| CSN amendments (SCA, 099) | see `git log` | Once the CSN number is recorded, the panel lists what changed since the last live file and makes the amendment with only that, flagged U/S/D, pointing back at the CSN; houses keep their sub-lines across amendments; checked against CBIC's SCA schema |
| CSN for exports (SCX, 098) | see `git log` | An export console makes the CSN on exit: the desk as shipper with its IEC, each house pointing at its exporter's shipping bill by PCIN, shaped by cargo movement as the guide's table says; checked against CBIC's schema |
| CSN for ICEGATE (097) | see `git log` | An import console makes the CSN file in CBIC's format, checked against the official schema, numbered and named as ICEGATE expects, for the desk to sign and upload; the CSN number is recorded back on every job |
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

---

## 13. Feature notes

How the larger features work and what was decided with the user about them. Until 1 Oct
this was §9's "Product gaps"; it moved here unchanged except for the two lines marked in
"Security", and the open points it held are now listed in §9.

- **Customer milestones (102, user's instruction 28 Sep: "the tracking page the customer
  receives should not be automatic; all milestones updated by an employee within the
  shipment").**
  - The job's **Tracking tab** opens with *Customer milestones* (`components/CustomerMilestones.tsx`,
    logic in `lib/milestones.ts`): Record / Edit each with the day, the time if known (the
    place's local time, as told), where, and a note for the customer; "Not reached after all";
    "Not part of this job" (hidden, e.g. delivery on an FOB export); "Add an update" for the
    desk's own line ("Transhipped at Colombo"), whose wording can be corrected and which can be
    deleted.
  - **What the job already knows is offered, never applied:** "Use this" beside a milestone
    fills the form from the delivery or pickup on Pickup & delivery, the first warehouse receipt,
    the LEO / out-of-charge date, or a carrier's, airline's or mail's report.
  - **The customer's page** (`pages/TrackShipment.tsx`): what was recorded, oldest first, then
    what is still to come; a milestone overtaken without a record is left out; "Expected" only
    against the booking's own ETD / ETA; the planned route on the map (no positions); the
    booking's details; no ARX id. The tracking-link mail's status is the last milestone.
  - **The stage follows the milestones.** "Mark sailed…" in the job header, a flagged step on the
    workflow bar and the case file's "Completed" all open the milestone on the Tracking tab;
    "In process" from completed clears the Delivered milestone.
  - The live-tracking panel is labelled for the desk; its "Record …" button records the
    milestone (a person's click). The hourly sweep only files what it hears.
  - Existing jobs were backfilled from their ticked stage steps (both live jobs: booking
    confirmed only).
- **Cancelling a shipment (103).** Shipment details → *Called off?* → Cancel the shipment, with
  a reason (`components/CancelShipment.tsx`). The job and its records stay; it leaves the
  in-process board, its customer page says cancelled, and milestones are refused. Issued
  invoices are not touched: the form counts them and says to raise credit notes. A red banner on
  the job file says when, by whom and why, with **Reopen** (a reason again), which puts it back at
  the stage its milestones say. The case file's state switch shows "Cancelled" and links to the
  job. "Send back to the enquiry" is still the way to undo a booking made too early.

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
  - **Pictures** (inserted, pasted or dropped) are reshaped in the browser first (104,
    `lib/mailImage.ts`): scaled to twice the width they are shown at (440 px in a signature,
    1280 px in a mail) and sent as PNG, JPEG or GIF, never WebP or SVG, which Outlook does not
    show; a PNG still over the bucket's 2 MB goes as JPEG. A phone photo of 12 MB becomes about
    20 KB. What the browser cannot read (HEIC outside Safari) is refused with "save it as a JPG or
    PNG". Before this, anything over 2 MB failed with the bucket's own "the object exceeded the
    maximum allowed size".
  - Then they are uploaded to the public `signatures` bucket.
    At send, `outgoing()` carries every picture of ours (logo and bucket) as an inline `cid:`
    attachment while it fits the 3MB, and gives any picture without one a `width`: Outlook
    ignores max-width.
  - **For Outlook, `forOutlook`** writes the inherited font, size and colour onto every table cell
    (Word does not inherit into tables) and gives links Outlook's blue.
  - **Reply, Reply all, Forward** (`lib/mailQuote.ts`) quote under Outlook's
    From/Sent/To/Cc/Subject header. Forward goes through Graph `createForward` (`forwardTracked`),
    so the original's attachments and inline pictures travel. Bcc is on every send path, and the
    compose window can be made bigger.
- **The CSN for ICEGATE, import consoles (097, 26 Sep).** An import console now has a "CSN for
  ICEGATE" panel under its cargo manifest (`components/ConsoleCsn.tsx`). It makes the Cargo Summary
  Notification the desk files as consol agent 72 hours before arrival: the carrier's master B/L as a
  consolidated line (`C`, previous declaration `N`) with every house B/L under it (`H`, `N`),
  reporting event SCE, message SACHM22, version SCE1102, filed as submitter type `ANC` on the desk's
  PAN.
  - **The specification is CBIC's own**, in `docs/icegate-csn/` (the MIG for "Notified Sea Carriers
    other than ASC/ASA", v1.6, 14 Aug 2026, with its schemas and Customs' sample files). Check the
    ICEGATE MIG page for a newer version before changing anything.
  - **`lib/icegateCsn.ts`:**
    - `draftFor` fills the form from the console, each job's house B/L (the received one on an
      import), its CFS code, the boxes, the origin agent, and the desk (`COMPANY.postal`).
    - `buildCsn` writes ICEGATE's JSON.
    - `csnProblems` lists what ICEGATE would refuse. It runs the official schema over the file
      (`schemaErrors`, covering every keyword the schema uses) plus the rules the guide states in
      words: IEC for an import consignee, UN/LOCODEs, HS codes, ZZZZZ/ZZZ for non-hazardous cargo,
      container numbers and ISO size-types.
  - **Tests:** `scripts/tests/icegateCsn.test.ts` checks the checker against Customs' sample files,
    and builds a two-house console into a file that passes the schema.
  - **The file has no `digSign` block:** ICEGATE's signing utility adds it from the filer's Class III
    certificate on their PC. Then it is uploaded on ICEGATE (web upload or SMTP). ICEGATE answers
    with an SFL (structure failed) or an ACK with error codes, listed in section 7 of the guide.
  - **What the desk must still type per console:** the vessel's IMO number and the voyage call number
    (VCN) from the line's agent, plus anything a house B/L lacked (most often the importer's IEC).
    Once, an administrator sets the desk's ICEGATE ID, PAN, authorised person's PAN and port of
    reporting in the panel.
  - **The CSN number that comes back** is recorded in the panel, on the console and every job's import
    customs record, which clears the jobs' "CSN due" alerts (088).
  - **Exports too (SCX, 26 Sep).** An export console gets the same panel, filing the CSN on exit:
    - **Master line:** the desk ships the master B/L with its IEC (`icegate_settings.iec`, else the
      PAN) to the destination agent. It is cleared at the port of reporting (INMAA1), with the next
      port and the final destination given as codes. Movement is TC (foreign transhipment, as in
      Customs' sample), FT or TI.
    - **Each house (EX / H / B):** points at the exporter's shipping bill by its PCIN
      (`prevRef.cinTyp` "PCIN", the guide's and Customs' ACK spelling). The desk types the PCIN,
      which the exporter's CHA has; the SB number and date are shown from the job's export customs.
      The exporter comes from the customer record: IEC and a billing address already split into
      parts.
    - **By movement, per the guide's table:** on TC and TI the house also carries its transport
      document and location; on FT only its reference, PCIN, equipment and measures. There are no
      items or itinerary on an export house.
    - **Transhipper:** the carrier's code and bond go on the master (and the house on TC/TI) when
      given. Otherwise a warning, not an error.
    - **Every container** now carries `cntrAgntCd`, empty when not known, as Customs' own sample
      does. The panel has a column for it.
    - **Recording the CSN number** puts it on each job's export customs record.
    - **The export rules are less spelled out in the guide than the import ones:** `prevDec` "B" and
      the house objects follow Customs' sample and the v1.6 tables. Make the first real SCX a test
      file (T) or check ICEGATE's reply closely.
  - **Amendments (SCA, 27 Sep).** Once the CSN number is recorded, the panel shows "Amend the
    CSN (SCA)": what changed since the last live file, in words, and a button that makes the
    amendment (`buildAmendment`, lib/icegateCsn.ts).
    - **What it compares with:** every file now keeps the form it was made from
    (`csn_files.draft`, 099), as ICEGATE will hold it (`asFiled`). The baseline is the last live
    (P) file for the console, whether the CSN or an earlier amendment. Test files never become
    the baseline.
    - **What it carries:** only what changed, each object flagged U (updated), S (added) or D
    (deleted), plus the header naming the CSN (number and date) and the master line's `supRef`
    back to it, as CBIC's SCA schema requires. Houses are matched by job and keep the sub-line
    they were filed under. A new house gets the next sub-line ever given out (a deleted one is
    not reused), with every object S; a removed house is its reference, D. Containers are
    matched by number.
    - **Checked:** against CBIC's SCA schema (`src/lib/icegate/scaSchema.json`) before the
    button enables, and Customs' own SCA sample passes the same check.
    - **Judgement calls, to confirm on the first real one:**
      - `csnSbmtdTyp` is "ANC" (the guide: the submitter's type), while Customs' sample has "CSN".
      - `versionNo` follows the original event (SCE1102 / SCX1102); the sample amends an SCE.
      - `Amend_det` (a free-text reason) is left out: the schema does not require it.
      - Make the first amendment a test file (T).
    - **A CSN filed before 099** has no kept form, so it cannot be amended from the CRM ("no
    live file on record to compare with"). File that one amendment on ICEGATE directly, or
    download a fresh live CSN file first (not uploaded) to set the baseline.
    - **A rejected live file is not the baseline** once its reply is read in (below): the next
    amendment compares with the last live file ICEGATE did not reject, so it carries the change
    again. A reply not yet read counts as accepted.
  - **ICEGATE's replies (100, 27 Sep).** "Read a reply" on the CSN panel takes the `…_ACK.json` or
    `…_SFL.json` ICEGATE sent back (`readCsnReply`, lib/icegateReply.ts; `applyCsnReply`,
    services/icegateCsn.ts).
    - **Which file it answers:** found by its job number. Refused if the reply is for another
      sender, a job the CRM never made, a file made on another console (named), or a different
      event. The CRM's own `_DEC` file is refused with a pointer to the right one.
    - **The reply is walked, not path-read.** Customs' ACK samples disagree with each other and
      with the guide's ACK schema: `mastrCnsgnmtDec`/`mastrCnsgmtDec`, `houseCargoDec`/`hcargoDec`,
      error arrays beside or inside objects, `{}` placeholders for unchanged houses. The reader
      takes error codes ("000"/"00" = passed), the house sub-line, and the container / item /
      itinerary sequence from wherever they are. Codes without text get the guide's list
      (section 7, `src/lib/icegate/ackCodes.json`, 448 codes).
    - **Each file's status** shows in the panel: awaiting reply, accepted, rejected, structure
      failed. Each error is pinned to the house (by its B/L number and job, from the form kept
      with the file) and the container number.
    - **An accepted live file records on its own:**
      - the CSN number and date (as "Record", on the console and every job);
      - the master line's MCIN/PCIN on the console (`cin_type`, `cargo_identification_no`);
      - each house's CIN on its job's customs record (`cin_type`, `cin_no`; shown on the job's
        manifest section).
    - **Test files:** a test file's reply is kept, and nothing is recorded from it.
    - **SFL:** the CRM checks every file against CBIC's schema first, so an SFL means ICEGATE's
      live format differs from the published one. Keep the reply for whoever maintains the CRM.
    - **Unconfirmed:** the reader follows Customs' 2020 samples. Check the first real ACK reads
      as expected: the CSN number, and the CINs landing on the right jobs.
  - **Recording by hand** stays, for a reply that came some other way.

- **Live rates (101, 26 Sep).** Agents & partners → Live rates. The desk names a service
  ("FCL 20' / 40' · Chennai → Jebel Ali"), says what to quote, and picks the partners.
  - **When:** every Sunday at 8:30 pm IST (117; it was 10:30 pm) each partner gets their own mail (nobody sees who else
    was asked). It asks for the Monday to the Sunday after, so the rates are in on Monday
    morning. A mail sent by hand asks from that day to the coming Sunday.
  - **The mail:** `lib/liveRates.ts`, copied into the function with `lib/company.ts` (a test
    keeps both copies identical). The subject starts "Rate request", so Team oversight files it
    as one. It is sent from the request's mailbox (info@ by default), so replies land there and
    show under Partner mail.
  - **Sending:** the `live-rates` function, app-only (nobody signed in), needs Mail.Send (application): granted 1 Oct (§9).
    Exchange takes about 30 mails a minute from a mailbox, so mails go 2 s apart. A run stops
    after 100 s and the next 10-minute run carries on. Each partner is claimed once per Sunday,
    so re-runs retry only failures and never mail twice. A refusal of the app itself (no
    permission, bad secret) stops the run.
  - **The page:** next send and the week it asks for; whether Microsoft lets the app send (with
    the Azure steps if not); per request, last Sunday's result partner by partner with
    Microsoft's reason for any refusal, a preview of the exact mail, **Send a test to me** (to
    the signed-in person only), **Send now** (after a confirm; a second press within 5 minutes
    skips partners already mailed), Pause, Edit, Delete.
  - **Verified 26 Sep:** the database guard as an employee and an admin (rolled back); the
    function refuses anonymous callers and anything but `weekly` from the scheduler; a real
    `weekly` run with no requests sends nothing and reports `canSend: false`; the page in a
    harness. No mail was sent: the two partners on the directory are real.
  - **Not built:** reading the rates that come back into the Rate master.
  - **For a shipment (107, 30 Sep).** The page's first tab. Choose an open job (any enquiry not
    declined or lost, less bookings delivered or cancelled; `?job=REF` links straight to one),
    the partners, and for each the services to price — ticked from their role
    (`lib/rateRequest.ts` `defaultServices`: an overseas agent the far end, a line the freight, a
    CHA the clearance, a transporter the pickup), changed per partner, or typed in. Each gets
    their own mail **from the sender's Outlook** (delegated, like the case file's Ask partners:
    it works without Mail.Send), opening with their greeting and their services, then the
    message about the shipment built from the enquiry (editable, or written with AI to a brief).
    The subject carries `[REF]`, so the reply files on the job, and starts "Rate request". Each
    send is recorded by `record_rfq_sent` (107), which files the thread on the job and the
    partner among its parties. The case file's Partners tab (Partner quotes) shows each
    partner's services, "from Live rates", and **Read the threads**: the requests and replies
    from the viewer's mailbox, opened and answered there (a request sent by someone else says
    whose mailbox it is in). The case file's own "Ask partners" is the same form
    (`RateRequestForm`) in a dialog. The Sunday requests are unchanged on the second tab.
  - **Verified 30 Sep:** the migration rolled back (services cleaned, one row and one timeline
    entry per partner per batch, thread bound, party added, old call still accepted, anon
    refused); the page in a harness with invented partners (role defaults, a custom service,
    a partner with no service refused, per-partner preview, the record of three sends, the case
    file rows and threads, the dialog, a 375 px phone). No real mail was sent.
- **Passwords (26 Sep).** Auth settings: at least 10 characters, with letters and a number
  (`password_min_length` 10, `password_required_characters` letters:digits). The staff-accounts
  function and the Staff accounts screen check the same rule first, so the admin reads a plain
  sentence. Existing passwords keep working until changed. Leaked-password checking needs the
  Pro plan, which the desk has decided against for now.
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
    - **Make the repositories private** (the user's action on GitHub; still public on
      1 Oct, §9). No other secret is in the history: scanned on 25 Sep, and again on 1 Oct
      (only the shortened prefixes quoted in §1).
  - Since then: passwords need at least 10 characters with letters and a number (26 Sep,
    "Passwords" below); the 13 functions have a fixed `search_path` and the 14 views read as
    the person asking (096). Leaked-password protection is still off: it needs the Pro plan.
    *(Corrected 1 Oct; this line had said all four were still open.)*
