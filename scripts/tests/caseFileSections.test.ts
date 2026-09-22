import { buildSections, sectionsFor } from "../../src/lib/caseFileSections";

/** The build this desk actually ships: accounts on, full case file. */
const FLAGS = { accountsDesk: true, mailOnlyCaseFile: false };

/**
 * Which tabs an enquiry shows.
 *
 * Worth pinning because the rule is about what CANNOT be done yet, and the
 * failure is quiet in both directions: too many tabs and somebody opens a
 * Documents list of twelve things all saying "not ready", too few and a won job
 * loses the page its invoice is raised on.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${label}${
      ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`
    }`
  );
  ok ? pass++ : fail++;
};

const keys = (enquiry: { status: string } | null, shipment: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sectionsFor(enquiry as any, shipment as any, FLAGS).map((s) => s.key);

const has = (k: string, enquiry: { status: string } | null, shipment: unknown = null) =>
  keys(enquiry, shipment).includes(k);

console.log("\nan inbound enquiry has nowhere to put a document or an invoice");
for (const status of ["new", "qualifying", "quoted"]) {
  is(`${status}: no documents`, has("documents", { status }), false);
  is(`${status}: no billing`, has("billing", { status }), false);
}
// A lost job is not a job. Neither tab can produce anything for it either.
is("lost: no documents", has("documents", { status: "lost" }), false);
is("declined: no billing", has("billing", { status: "declined" }), false);

console.log("\nthe tabs that are always there are still there");
for (const status of ["new", "quoted", "lost"]) {
  is(`${status}: mail`, has("mail", { status }), true);
  is(`${status}: timeline`, has("timeline", { status }), true);
}
// Shipment details is the consol agent's block, and it is asked for BEFORE the
// job is won — that is the whole reason it exists. It must not be hidden here.
is("quoted: shipment details stays", has("shipment", { status: "quoted" }), true);
is("quoted: partners & quote stays", has("quote", { status: "quoted" }), true);

console.log("\nwinning it opens them");
is("accepted: documents", has("documents", { status: "accepted" }), true);
is("accepted: billing", has("billing", { status: "accepted" }), true);

console.log("\na booking keeps them whatever the enquiry row says");
// A promoted job whose enquiry was later corrected to something else must not
// lose the page its invoice is raised on.
is(
  "shipment exists, status quoted: documents",
  has("documents", { status: "quoted" }, { id: "ARX-SHP-0001" }),
  true
);
is(
  "shipment exists, status lost: billing",
  has("billing", { status: "lost" }, { id: "ARX-SHP-0001" }),
  true
);

console.log("\nnothing is invented and nothing is lost");
is("no enquiry yet falls back to the inbound set", has("documents", null), false);
is("no enquiry yet still has mail", has("mail", null), true);
// Every visible section must be one the build actually has, or the tab strip
// offers a page that does not render.
const buildKeys = buildSections(FLAGS).map((s) => s.key);
is(
  "every inbound tab exists in the build",
  keys({ status: "new" }, null).every((k) => buildKeys.includes(k)),
  true
);
is(
  "a won enquiry shows the whole build set",
  keys({ status: "accepted" }, null),
  buildKeys
);
is("there is always at least one tab", keys({ status: "new" }, null).length > 0, true);

console.log("");
console.log("the build flags still decide what exists at all");
// A mail-only build never had documents or billing to hide.
is(
  "mail-only build",
  sectionsFor({ status: "accepted" } as never, null, {
    accountsDesk: true,
    mailOnlyCaseFile: true,
  }).map((s) => s.key),
  ["mail", "timeline"]
);
// Accounts off removes billing even on a won job.
is(
  "accounts desk off, won job",
  sectionsFor({ status: "accepted" } as never, null, {
    accountsDesk: false,
    mailOnlyCaseFile: false,
  })
    .map((s) => s.key)
    .includes("billing"),
  false
);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
