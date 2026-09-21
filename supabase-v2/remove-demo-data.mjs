/**
 * Removes everything the seed scripts created.
 *
 *   node supabase-v2/remove-demo-data.mjs                     # say what would go
 *   node supabase-v2/remove-demo-data.mjs --yes               # actually delete it
 *   node supabase-v2/remove-demo-data.mjs --partner "shenzen" # plus one of your own
 *
 * `--partner` takes the name OR the organisation exactly as the directory shows
 * it, and may be repeated. It is for the test partners somebody typed in by
 * hand while trying the screen out -- the seeds cannot know about those, and
 * the UI cannot delete them because partners only archive.
 *
 * ---------------------------------------------------------------------------
 * WHY A SCRIPT AND NOT THE UI
 *
 * Because most of this cannot be deleted from the UI, deliberately. Partners
 * have no DELETE policy -- 013 says so in as many words, because deleting one
 * would orphan the history of every shipment they worked on, and `active` is
 * what retiring somebody is for. Enquiries are never deleted either: the
 * correspondence attached to a reference is the record of what a customer was
 * told.
 *
 * Those rules are right for real records and wrong for a demo customer nobody
 * ever spoke to. This is the exception, run once, before the desk goes live.
 *
 * WHY IT DEFAULTS TO SAYING RATHER THAN DOING
 *
 * It deletes from a live database and there is no undo. Without --yes it
 * counts what matches and prints it, so the thing you are about to remove can
 * be read before it goes.
 *
 * HOW THE ROWS ARE IDENTIFIED
 *
 * By the exact keys the seeds write, not by pattern-matching the word "demo".
 * A customer who really is called Demo Logistics would survive this, and a real
 * enquiry whose notes happen to say "demo" is not touched.
 *
 *   customers   id = 'DEMO-CUS-1'
 *   enquiries   ref in ('DEMO-E01')
 *   shipments   id = 'DEMO-SHP-1'
 *   partners    'Demo Consol Partner', plus the twelve seed-partners.mjs
 *               invents -- those carry no marker at all and read like real
 *               agents, which makes them the ones worth being explicit about
 *   sailings    notes like 'Demo container%'
 *   intake      the seeded rows, by their message and call ids
 *
 * ORDER MATTERS
 *
 * `shipments.enquiry_ref` and `shipments.customer_id` are ON DELETE RESTRICT,
 * so the booking goes before the enquiry and the enquiry before the customer.
 * Everything else attached to an enquiry is ON DELETE CASCADE and goes with it.
 * The whole thing is one statement block, so it is one transaction: if any part
 * is refused, nothing is removed and the error says which.
 * ---------------------------------------------------------------------------
 */
import { accessToken, PROJECT } from "./token.mjs";

const commit = process.argv.includes("--yes");

/** Repeatable flags: --partner "Name", --enquiry ARX-C0001-E01 */
const flagged = (flag) =>
  process.argv.reduce((out, arg, i) => {
    if (arg === flag && process.argv[i + 1]) out.push(process.argv[i + 1]);
    return out;
  }, []);

/** Extra partners named on the command line, matched on name or organisation. */
const extraPartners = flagged("--partner");

/**
 * Enquiries to remove outright.
 *
 * Nothing here is inferred. An enquiry is never deleted by the app -- the
 * correspondence filed against a reference is the record of what a customer was
 * told -- so the only way one goes is if somebody names it, by reference, on
 * the command line. That is the whole safeguard and it is deliberately dumb.
 */
const extraEnquiries = flagged("--enquiry");

// Single-quoted into SQL, so a name containing one has to be doubled. Rejecting
// the rest of what a name can contain would be worse than escaping it: real
// companies are called "O'Brien Shipping".
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * The twelve partners `seed-partners.mjs` invents.
 *
 * Listed out rather than matched on a marker, because these are the dangerous
 * ones: unlike the showcase partner they carry no "Demo" in the name and no
 * note saying they are safe to delete. "Gulf Line Freight LLC" with a contact
 * and a plausible note about free days reads exactly like a real agent
 * somebody added, and after a month nobody can tell which of these the desk
 * actually works with.
 *
 * Kept in step by hand. If that seed gains a partner, it goes here too.
 */
const SEEDED_PARTNERS = [
  "Pacific Consolidators Pte",
  "Gulf Line Freight LLC",
  "Seabridge Groupage",
  "Indus Consol Services",
  "Meridian Lines",
  "Orient Star Shipping",
  "Coastline Clearing Agents",
  "Trident Customs House",
  "Metro Haulage",
  "Redhills CFS & Logistics",
  "Southern Marine Surveyors",
  "Anchor Marine Insurance",
];

const partnerList = [...SEEDED_PARTNERS, ...extraPartners].map(quote).join(", ");

/**
 * Which partners go: the seeded one always, plus anything named on the command
 * line. Built once so the count and the delete cannot disagree about it -- two
 * copies of this clause is how a preview comes to be honest about one set of
 * rows and the delete removes another.
 */
const partnerWhere =
  `name = 'Demo Consol Partner' or name in (${partnerList}) or organisation in (${partnerList})`;

const enquiryWhere = extraEnquiries.length
  ? `ref in (${extraEnquiries.map(quote).join(", ")})`
  : `ref = 'DEMO-E01'`;

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await r.text();
  if (!r.ok) {
    console.error(`\n${r.status}\n${body.slice(0, 1500)}`);
    process.exit(1);
  }
  return JSON.parse(body);
}

/** What the seeds wrote, as a WHERE clause per table. */
const TARGETS = [
  ["shipments", `id = 'DEMO-SHP-1'`],
  ["enquiries", enquiryWhere],
  ["customers", `id = 'DEMO-CUS-1'`],
  ["partners", partnerWhere],
  // `seed-sailings.mjs` writes nine fixed ids — sl-jea-1, sl-cmb-2 and so on.
  // A real sailing gets a generated id, so the prefix is the whole test.
  ["sailings", `notes like 'Demo container%' or id like 'sl-%'`],
  // Consoles opened against one of those, with nothing loaded on them.
  [
    "consoles",
    `sailing_id like 'sl-%'
       and not exists (select 1 from public.shipments s where s.console_id = consoles.id)`,
  ],
  ["intake", `message_id in ('DEMO-MSG-0001','DEMO-MSG-KEVIN-01') or call_id in ('demo-call-1','demo-call-kevin')`],
];

console.log(`project ${PROJECT}`);
if (extraPartners.length) {
  console.log(`also removing partner(s) named: ${extraPartners.join(", ")}`);
}
console.log();

const counts = await sql(
  TARGETS.map(
    ([table, where]) =>
      `select '${table}' as tbl, count(*)::int as n from public.${table} where ${where}`
  ).join("\nunion all\n") + ";"
);

const rows = Array.isArray(counts) ? counts : counts.result ?? [];
let total = 0;
for (const r of rows) {
  console.log(`  ${String(r.n).padStart(3)}  ${r.tbl}`);
  total += Number(r.n) || 0;
}

if (!total) {
  console.log("\nNothing to remove — no seeded rows are left.");
  process.exit(0);
}

if (!commit) {
  console.log(`\n${total} rows would be removed, plus whatever cascades from them`);
  console.log("(enquiry events, parties, quotes, partner assignments, containers).");
  console.log("\nRe-run with --yes to do it. There is no undo.");
  process.exit(0);
}

// Deleted in dependency order, as one block and therefore one transaction.
await sql(`
  -- ---- the accounts records raised against the demo booking ----------------
  --
  -- These block the shipment: invoices.shipment_id is ON DELETE RESTRICT, and
  -- payment_allocations.invoice_id is too.
  --
  -- The lines have to go before the invoice rather than cascading with it. The
  -- AFTER DELETE trigger on invoice_lines looks its invoice up to decide
  -- whether the charges may be touched, and on a cascade the invoice row is
  -- already gone by the time it runs -- so the status reads NULL, which is not
  -- 'draft', and it refuses. Deleting the lines while the invoice still exists
  -- is the only order that works.
  --
  -- The status is flipped to draft first for the same trigger: an issued
  -- invoice's charges cannot be changed, which is exactly right for a document
  -- a customer holds and exactly wrong for a demo nobody was ever sent.
  -- Which payments touched the demo invoice, noted before the allocations that
  -- say so are deleted. Without this the only way to find them afterwards is
  -- "payments with no allocations", which is also what money received on
  -- account looks like — a real receipt nobody has applied yet.
  create temp table _demo_payments on commit drop as
    select distinct a.payment_id
      from public.payment_allocations a
      join public.invoices i on i.id = a.invoice_id
     where i.shipment_id = 'DEMO-SHP-1';

  delete from public.payment_allocations
   where invoice_id in (select id from public.invoices where shipment_id = 'DEMO-SHP-1');

  -- Only if the payment settled nothing else. A receipt split across the demo
  -- invoice and a real one is a real receipt, and it stays.
  delete from public.payments
   where id in (select payment_id from _demo_payments)
     and id not in (select payment_id from public.payment_allocations);

  update public.invoices set status = 'draft' where shipment_id = 'DEMO-SHP-1';
  delete from public.invoice_lines
   where invoice_id in (select id from public.invoices where shipment_id = 'DEMO-SHP-1');
  delete from public.invoices where shipment_id = 'DEMO-SHP-1';

  -- The booking: its enquiry_ref and customer_id are ON DELETE RESTRICT,
  -- so neither the enquiry nor the customer can go while it exists.
  delete from public.shipments where id = 'DEMO-SHP-1';

  -- Assignments before the partner, for the same reason.
  delete from public.partner_assignments
   where partner_id in (select id from public.partners where ${partnerWhere});

  -- Intake rows promoted into these enquiries go back to new. enquiry_ref is
  -- ON DELETE SET NULL, so without this they sit in the queue marked promoted
  -- with nothing to point at — a row that says it was dealt with and cannot say
  -- where it went.
  update public.intake
     set status = 'new', enquiry_ref = null, settled_at = null, settled_by = null
   where ${enquiryWhere.replace(/\bref\b/g, "enquiry_ref")};

  -- The enquiry takes its events, parties, quotes and threads with it.
  delete from public.enquiries where ${enquiryWhere};

  delete from public.intake
   where message_id in ('DEMO-MSG-0001','DEMO-MSG-KEVIN-01')
      or call_id in ('demo-call-1','demo-call-kevin');

  delete from public.customers where id = 'DEMO-CUS-1';
  delete from public.partners  where ${partnerWhere};
  -- Consoles before the sailings they sit on. Guarded on having nothing
  -- loaded: a console with shipments against it is somebody's real
  -- consolidation and stays, whatever it was opened on.
  delete from public.consoles
   where sailing_id like 'sl-%'
     and not exists (select 1 from public.shipments s where s.console_id = consoles.id);

  delete from public.sailings
   where notes like 'Demo container%'
      or (id like 'sl-%' and not exists (select 1 from public.shipments s where s.sailing_id = sailings.id));

  -- ---- put the serial counters back to the start ---------------------------
  --
  -- Only if nothing is left to number against. The demo invoice took
  -- INV/26-27/0001 and the demo container took CON/26-27/0001, so without this
  -- the first real invoice is 0002 and 0001 is a number that was issued, then
  -- deleted, and can never be accounted for.
  --
  -- A gap in a tax invoice series is the thing Rule 46(b) and the gapless
  -- counter in 042 exist to prevent, and "it was demo data" is not an answer
  -- anybody wants to give an auditor eighteen months from now. Resetting is
  -- safe here precisely because the guard below proves nothing real was ever
  -- numbered: if a single invoice remains, the counter is left alone.
  update public.invoice_series set next_number = 1
   where series = 'INV' and not exists (select 1 from public.invoices);

  update public.invoice_series set next_number = 1
   where series = 'CON' and not exists (select 1 from public.consoles);
`);

console.log("\nRemoved. Re-run without --yes to confirm nothing is left.");
