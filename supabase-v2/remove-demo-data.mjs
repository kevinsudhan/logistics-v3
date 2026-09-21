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

/** Extra partners named on the command line, matched on name or organisation. */
const extraPartners = process.argv.reduce((names, arg, i) => {
  if (arg === "--partner" && process.argv[i + 1]) names.push(process.argv[i + 1]);
  return names;
}, []);

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
  ["enquiries", `ref = 'DEMO-E01'`],
  ["customers", `id = 'DEMO-CUS-1'`],
  ["partners", partnerWhere],
  ["sailings", `notes like 'Demo container%'`],
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
  -- The booking first: its enquiry_ref and customer_id are ON DELETE RESTRICT,
  -- so neither the enquiry nor the customer can go while it exists.
  delete from public.shipments where id = 'DEMO-SHP-1';

  -- Assignments before the partner, for the same reason.
  delete from public.partner_assignments
   where partner_id in (select id from public.partners where ${partnerWhere});

  -- The enquiry takes its events, parties, quotes and threads with it.
  delete from public.enquiries where ref = 'DEMO-E01';

  delete from public.intake
   where message_id in ('DEMO-MSG-0001','DEMO-MSG-KEVIN-01')
      or call_id in ('demo-call-1','demo-call-kevin');

  delete from public.customers where id = 'DEMO-CUS-1';
  delete from public.partners  where ${partnerWhere};
  delete from public.sailings  where notes like 'Demo container%';
`);

console.log("\nRemoved. Re-run without --yes to confirm nothing is left.");
