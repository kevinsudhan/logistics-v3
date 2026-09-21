# Handoff — Araxys CRM v2

The freight desk for **Aashish Logistics Global**. This file covers `araxys-crm-v2` only.
v1 (`../araxys-crm`) is a separate, older codebase on a different Supabase project and a
different branch; it is not to be touched from here.

Written 14 September 2026. **Revised 21 September 2026** — the sections on the backend, the
accounts surface and the billing gap were materially wrong after a week of work; see §12 for
what changed.

Read **§1 Do these first** before anything else.

---

## 1. Do these first

### Rotate four credentials

These were pasted into a chat transcript during development and must be treated as
compromised:

| Credential | Where to rotate |
|---|---|
| Gemini API key `AQ.Ab8RN6Iq…` | aistudio.google.com → then update the `GEMINI_API_KEY` secret in Supabase |
| SnapServe `sk_live_705b5d…` | SnapServe account (v1 only — v2 no longer uses it at all) |
| Anthropic `sk-ant-api03-YN9atg…` | console.anthropic.com (not used by v2) |
| Azure client secret `JX38Q~…` | Entra ID → app registration → Certificates & secrets |

Only the first and last are live in v2.

### Decide on the Gemini billing question

`classify-enquiry` — now the **only** Edge Function in v2 — runs on Gemini's **free tier
against live customer mail**. That was a deliberate, informed choice, written into the
function's header comment, but it means Google's unpaid terms apply: submitted content is
used "to provide, improve, and develop Google products", and human reviewers may see it.
India is not covered by the EEA/UK/Swiss carve-out.

What passes through is real: rate cards, quotations, and the names, addresses and phone
numbers of customers who have not been asked about it. Under the DPDP Act that makes Aashish
Logistics the data fiduciary for the transfer.

**Enabling billing on the Google Cloud project flips those terms with no code change** — no
key change, nothing to edit. At this volume it is a few hundred rupees a month, and it also
removes the free-tier 503s (roughly one request in four during testing, which is why the
function retries).

---

## 2. What it is, and where the data actually lives

A React + TypeScript + Vite + Tailwind front end for a freight forwarder and consolidator:
enquiry intake from mail and the website, quoting, container stowage in 3D, shipments,
documents, and a full accounts ledger.

### The backend question, answered properly

`WORKSPACE-V2.md` says "v2 has no backend". **That is no longer true and is the single most
misleading thing in this repo.** It was written on 28 August, when the front end ran entirely
against an in-memory mock. Since then v2 has grown its own database.

There are two data paths, and which one a screen uses depends on when it was built:

| Path | Services | Goes to |
|---|---|---|
| **Supabase, directly** | `billing` `bills` `classify` `consoles` `containers` `enquiries` `graphMail` `intake` `partners` `quoteLines` `receipts` `reports` `rfq` `shipmentContainers` | **v2's own project** `izgbrdeybhbepftloxgk` |
| **`backend.ts`, mock-gated** | `classify` `enquiries` `forwardChain` `intake` `rfq` `webEnquiry` | in-memory mock unless `VITE_MOCK_BACKEND=off` |

The client is built once in `src/lib/supabase.ts` from `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, so every direct call goes through **RLS as the signed-in user** —
there is no service-role key in the browser, and `scripts/check-bundle-secrets.mjs` fails the
build if one ever reaches the bundle.

### Why v1 is safe regardless

v2 is on a **different Supabase project**:

```
v1   wremiarcmppuncgfzrqb.supabase.co     shared with the live voice agents
v2   izgbrdeybhbepftloxgk.supabase.co     v2 only
```

That is the real isolation, and it is stronger than the mock ever was. The mock now only
guards the legacy space/records surface. There is also no `snapserve-setup/.env` in this
folder, so the scripts that PATCH live agent prompts cannot run from here even by accident.

### Stack

- React 18, TypeScript, Vite, Tailwind, React Router
- Supabase (Postgres + RLS + Auth + one Edge Function)
- Microsoft Graph for mail (`graphMail.ts`)
- Gemini for enquiry classification
- 3D stowage rendered as SVG — no 3D library; the projection is `src/lib/scene3d.ts`

---

## 3. Routes — 40 pages

**Desk (21)**
`Overview` `Intake` `Enquiries` `MyEnquiries` `CaseFile` `Oversight` `Consoles` `Containers`
`SpaceContainers` `ShipmentsInProcess` `ShipmentsCompleted` `ShipmentDetail` `Partners`
`Payables` `Billing` `Mail` `Documentation` `Analytics` `Complaints` `AdminControl` `Login`

**Shipment detail, tabbed (5)** — `shipment/`
`ShipmentOverview` `ShipmentParties` `ShipmentContainers` `ShipmentCosts` `ShipmentInvoices`

**Accounts (14)** — `accounts/`
`Proformas` `Invoices` `FinalBill` `CreditNotes` `DebitNotes` `OverseasCreditNotes`
`OverseasDebitNotes` `Receipts` `ReceiptDetails` `Payments` `PaymentDetails` `Outstanding`
`PayablesReport` `AgentSOA`

The accounts section is the newest surface and did not exist when this file was first
written.

---

## 4. Data model — 42 migrations

`supabase-v2/001…042`, applied in order. The ones worth knowing:

| Range | What it establishes |
|---|---|
| `001–004` | profiles, profile sync, signatures and signature images |
| `005–007` | operations, space/sailings, KB cron |
| `008–011`, `023`, `041` | the voice-agent surface — **now removed**, see below |
| `012–019` | mail linking, partners, written acceptance, intake, web enquiry, assignment |
| `020–025` | take-it-on, oversight lock, received-at, assign-to-others, promote-to-person |
| `026–029` | containers, partner RFQ, booking documents, signature cleanup |
| `030–040` | **the money model** |
| `041` | drops the voice tables |
| `042` | notes and gapless numbering |

### The money model (030–040)

Tables: `invoices` `invoice_lines` `invoice_series` `payments` `payment_allocations`
`bills` `bill_lines` `agent_statements` `statement_lines` `quote_lines` `consoles`
`shipment_containers`.

That is sell side, buy side, receivables with allocation, agent statements, and per-series
invoice numbering — the four things §9 of the original handoff called the largest hole in
the product. GST/HSN handling appears across `030`, `036`, `038`, `039`, `040` and `042`.

### Voice agents are gone from v2

`023` unscheduled the cron jobs; `041` drops the tables; the `ingest-calls` and `kb-sync`
Edge Functions and `setup-v2-agents.mjs` are deleted. `classify-enquiry` is the only function
left. Priya and Arun live in v1 and are not v2's concern.

---

## 5. Services — 21 modules

`applyPlan` `backend` `billing` `bills` `caseFile` `classify` `consoles` `containers`
`enquiries` `forwardChain` `graphMail` `intake` `mockBackend` `mockMail` `partners`
`quoteLines` `receipts` `reports` `rfq` `shipmentContainers` `webEnquiry`

`reports.ts` (370 lines) is the newest and backs the accounts pages.

`applyPlan.ts` was split out of `intake.ts` **specifically so it could be tested** —
`intake.ts` builds the Supabase client at import time, which needs Vite's `import.meta.env`
and cannot load under plain Node. Follow that pattern for anything else worth testing.

---

## 6. Commands

```bash
npm run dev            # :5174 — run alongside v1 on :5173
npm run build          # tsc -b && vite build && check-bundle-secrets
npm test               # 10 suites, all pure logic
npm run server         # tsx watch server/index.ts  (legacy Express, space engine)
npm run sync:kb        # regenerate KB docs
npm run check:secrets  # run the bundle scan on its own
```

Both CRMs run side by side on different ports. v2 is 5174.

---

## 7. Testing — 10 suites, all passing

```
test:space       cargo fitting in 3D, incl. the tall-crate volume maths gets wrong
test:scene       3D projection, camera presets and bounds
test:fields      the field catalogue
test:web         website form parsing without inventing a field
test:fwd     22  forward chain; refusing to call an ordinary reply a forward
test:apply   14  applying a reading fills blanks, never overwrites
test:greet   24  salutations — titles, initials, particles, surname-first
test:container   container number check digit
test:allocate    payment allocation across invoices
test:xlsx        spreadsheet export
```

Pure logic only. **The UI is not tested.**

### Testing database behaviour

Run SQL in a `do $$ … $$` block ending with `raise exception 'RESULTS %', r::text` — the work
rolls back and the findings arrive in the error message. Impersonate a role with:

```sql
perform set_config('request.jwt.claims',
  json_build_object('sub', uid::text, 'role','authenticated')::text, true);
set local role authenticated;
```

That is how RLS was verified for `partner_quotes`, `sailings` and `shipments`.

### What was never verified

**Nothing signed-in was checked in a browser.** Sign-in requires typing a password, which the
assistant that built this does not do. Every signed-in screen was verified through temporary
harness routes rendering the real components with fake data, plus live SQL. Specifically
unconfirmed against a real mailbox:

- a reply actually nesting in an Outlook thread (headers are correct; not watched landing)
- the repaired signature rendering at the right size in a received message
- Microsoft YaHei applying in the recipient's client

Send yourself one reply on an existing thread and all three are answered at once.

---

## 8. Traps that cost real time

Read this before debugging anything that smells similar. Every one of these was paid for.

**Heredocs mangle backslashes.** Writing TypeScript through a bash heredoc turns `\n` into a
literal newline, which broke a regex and two `.join("\n")` calls and produced errors far from
the cause. Use the Write/Edit tools for code containing escapes.

**supabase-js sends four headers, not one.** An Edge Function CORS preflight must allow
`authorization, x-client-info, apikey, content-type`. Allowing less makes the browser refuse
the request before it leaves, surfacing as *"Failed to send a request to the Edge Function"* —
which reads like the function is down when it was never reached. `classify-enquiry` now
reflects whatever the browser asks for.

**Graph threading needs `createReply`, not `sendMail`.** `/me/sendMail` starts a new
conversation and sets no `In-Reply-To` or `References`, so replies landed outside the thread
however right the "Re:" subject looked. `/createReply` returns a draft already carrying the
threading headers; PATCH its body and send. `/reply` would also thread but appends Graph's own
quoted copy, duplicating the one the compose box already built.

**`internetMessageHeaders` is not in Graph's default field set,** and `$select` *replaces* the
default rather than adding to it — so `getMessage` must name every field it needs, including
`body`.

**DOMPurify's `ALLOWED_URI_REGEXP` applies to every attribute value,** not just URIs. Setting
it stripped `border="1"` and `bgcolor="#FFFF00"` and took the colour out of rate cards. It is
deliberately not set; the default was measured and blocks what matters.

**Sanitising an attribute by name is not sanitising it.** The rich-text editor allowed `style`
and never read it, so a paste carried Tailwind's whole `--tw-*` block through and *replaced*
`max-width:220px` on a signature image — which is why Parasu's signature arrived enormous. Now
the declarations are whitelisted and every image gets a `max-width` regardless.

**`.card` must live in `@layer components`.** Written as bare CSS after `@tailwind utilities`,
it silently beats `bg-surface-2` or `border-dashed` on the same element.

**`surface-inset` is a CSS variable but not in the Tailwind config** — `bg-surface-inset`
renders nothing. Only `surface-0/1/2` exist as utilities.

---

## 9. Known gaps

Ordered by what actually bites. **Billing is no longer top of this list** — see §12.

### Consol-specific

- **Chargeable weight (w/m) is computed nowhere.** Every LCL quote turns on it. Small job,
  still the highest value-per-hour item on this list.
- `consoles` exists as a table now, but **master-vs-house B/L is not modelled**: the registry
  issues one B/L, whereas a consolidator issues an MBL and N HBLs on its own series.
- **No load factor or profitability per container.**

### Operational

- **Documents are not stored** — regenerated on demand, so there is no record of what was
  issued to whom and when. A B/L reprinted after a correction differs silently from the one
  the customer holds.
- **No attachments** anywhere — packing lists and MSDS arrive by mail and cannot be filed.
- **Milestones are a stage, not dated events**, so there is nothing to show a customer.
- **No free-time / demurrage clock.**

### Smaller

- Every document prints `Document no: ARX-…` and enquiry refs are `ARX-C0001-E02`. `ARX` is
  the vendor's prefix on the customer's paperwork. Changing it means changing both together.
- The partner-quote panel is on the case file, not on board rows. Deliberate — six partner
  rows plus twelve document rows on forty board rows would bury the board.
- `scripts/shot-sink.mjs` exists only to refresh README screenshots. Not part of the app.
- `WORKSPACE-V2.md` is stale (see §2). Either correct it or delete it; leaving it is worse
  than either, because it tells a new reader v2 cannot write to a database when it can.

**If picking one thing: chargeable weight.** It is small, every LCL quote depends on it, and
the ledger underneath it is now in place.

---

## 10. Standing constraints

- **Do not touch v1** (`../araxys-crm`). Different branch, different Supabase project, and it
  shares a SnapServe account with live voice agents answering real calls.
- **Voice agents are out of v2** — tables dropped in `041`, functions deleted. Priya and
  Arun's prompts in v1's `snapserve-setup/` are the user's own work and must not be edited
  without explicit instruction.
- **No dummy data in v2** beyond what `seed-showcase.mjs` creates, and everything it creates
  is prefixed `DEMO-`.
- **The build fails if a credential reaches the bundle.** `check-bundle-secrets.mjs` runs as
  part of `build`, not as a skippable step.
- **The browser only ever holds the anon key.** Every direct Supabase call goes through RLS as
  the signed-in user. If something needs the service role, it belongs in an Edge Function.

---

## 11. Repository state

- Branch **`v2`** of `github.com/kevinsudhan/araxys-crm`. `main` is v1's branch — do not merge
  without deciding what happens to the mock, which must not reach production.
- Working tree **clean**. Everything committed. The previous version of this file reported
  153 uncommitted files; that is resolved.
- Head at time of writing: `4253260 Show the model writing, in the place the writing will appear`.

---

## 12. What changed since 14 September

The six commits after the original handoff invalidated three of its sections.

| Commit | Effect on this document |
|---|---|
| `b436f84` `6484a97` | Voice agents recorded then removed. §4, §10 rewritten. |
| `f65fa08` | Project ref restored for the seed scripts. |
| `978d766` | **Accounts as fourteen pages** and a serial number that fits. §3 rewritten. |
| `b695f21` | Two browser-found fixes. |
| `4253260` | Model output streams into the place the writing will appear. |

Plus migrations `041` (drop voice tables) and `042` (notes and numbering), and the new
`reports.ts` / `billing.ts` services.

**The three corrections that matter:**

1. **v2 has a real backend.** Fourteen services write to v2's own Supabase project. The
   "no backend" framing survives only in `WORKSPACE-V2.md`, which is stale.
2. **Billing is largely built.** Twelve tables covering sell side, buy side, receivables with
   allocation, agent statements and gapless numbering. The original handoff's "if picking one
   thing, build invoices with line items and a payments table" is done.
3. **The tree is clean.** Nothing is pending.
