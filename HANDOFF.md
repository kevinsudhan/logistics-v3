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
- **Before every push:** `npm test` (38 suites) and `npm run build` (typecheck, bundle and
  secret scan) must both pass.
- **Run SQL against live data:** `node supabase-v2/run-sql.mjs "select …"`, or pass a
  migration filename (§6). The last migration is **082**, so the next one is `083-….sql`.
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
| SnapServe `sk_live_705b5d…` | SnapServe account (v1 only; v2 does not use it) |
| Anthropic `sk-ant-api03-YN9atg…` | console.anthropic.com (not used by v2) |

The Supabase token is issued against the **account**, so it can reach v1 as well. That makes
it the most urgent of the five. `TRACK_CRON_SECRET` is stored in three places: the function
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

### Edge Functions (2)

| Function | What it does | Secrets |
|---|---|---|
| `classify-enquiry` | Gemini reads a mail and extracts enquiry fields | `GEMINI_API_KEY`, `GEMINI_FALLBACK_MODELS` |
| `track-shipment` | Flight, vessel and container positions; hourly cron sweep (073) | `AISSTREAM_API_KEY`, `AERODATABOX_KEY`, `AERODATABOX_VIA=direct`, `TRACK_CRON_SECRET` |

Deploy a function with `node supabase-v2/deploy-function.mjs <slug>`.

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

## 4. Data model — 82 migrations

`supabase-v2/001…082`, applied in order with `run-sql.mjs` (each file runs as one
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

**Realtime covers those five tables.** Overview, Enquiries overview, Inbound enquiries, My
enquiries, In-process, Completed, the job file (header and steps) and the case file refresh
when a row they show changes. To make another table live, add it to the publication in a
migration (copy 081), then call `useTableChanges(table, filter, onChange)`, or
`useTablesChanges([[table, filter], …], onChange)` for several tables on one channel with one
refresh, from `src/lib/useTableChanges.ts`. **A page's loader must not write to a table it
listens to,** or every open copy of the page refreshes itself in a loop.

---

## 5. Services and libraries

`src/services/` holds 45 modules. The ones added since 21 September are:

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
npm test                             # 38 suites, pure logic
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

There are 38 suites in `scripts/tests/*.test.ts`, run with tsx. Each is registered as its
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
  right tables and filters, and a burst of events causes one reload. Two people watching a
  change land in real sessions has not been observed.
- **Microsoft sign-in inside the iPhone home-screen app.** Standalone mode can open the
  OAuth redirect in Safari.
- **In a real mailbox:** that a reply nests in its Outlook thread, and that the logo
  (inlined by cid) renders in a received quotation or confirmation.

---

## 8. Traps that cost real time

**A new function is callable by anyone until PUBLIC is revoked.** Postgres grants EXECUTE to
PUBLIC by default, so `grant … to authenticated` alone leaves the anonymous key in the bundle
able to call it. Every migration that creates a function needs
`revoke execute on function … from public, anon;` (075 and 070 do it; 035 did not, see 082).

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

**Month names are hard-coded arrays.** `toLocaleDateString("en-IN")` prints "Sept", and so does
`"en-GB"`, so do not use either for dates (`docDate` in `lib/documents/letterhead.ts` is one). Rupee amounts use `en-IN` grouping. The financial year runs April to March,
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

- There is no free-time or demurrage clock.
- **Sea bills (082).** The master B/L is entered once on the console and the database copies it
  to every job on it (`shipments.mainline_no`). A job not on a console has its master typed on
  the Bill tab. The pre-alert, tracking, the worklist search and the arrival notice, delivery
  order and B/L particulars read it. The house B/L is issued from the Bill tab or the console
  (`issue_house_bl`, 035) as `HBL/26-27/0001`, the generic FY series. **Open question for the
  user:** keep that, or number HBLs like the HAWB (`MAA/JEA/HBL0000001`)? No HBL has been
  issued on live data yet, so it can still change without renumbering anything. There is no
  HBL form, lock or history like the HAWB's (075).
- On air, the HAWB form's MAWB boxes do not write `shipments.mainline_no`, so an air pre-alert
  has no MAWB unless one is recorded some other way.
- **Security audit (flagged 24 Sep, a separate task).** 62 `SECURITY DEFINER` functions were
  executable by `anon` because nothing revoked PUBLIC. 082 closed the five console and
  numbering ones. The rest need going through (§8).
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
