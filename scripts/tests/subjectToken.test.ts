import { refFromSubject, seriesOf, subjectToken, withToken } from "../../src/services/caseFile";

/**
 * The reference in the subject line.
 *
 * This is the whole filing mechanism: a token the other side quotes back is how
 * a message three weeks from now is recognised as belonging to a conversation,
 * without anybody remembering to file it. If the parser stops recognising a
 * shape, mail stops filing itself and nothing announces that it has — the
 * threads simply go quiet.
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

console.log("\nthe shapes a reference has had");
is("a shipment reference", refFromSubject("[ALG09012-26] Rate for Colombo"), "ALG09012-26");
is("a partner reference", refFromSubject("[PALG09003-26] Your rate sheet"), "PALG09003-26");
// Still minted nowhere, still on every thread opened before 044 — and those
// threads are still running.
is("the old form", refFromSubject("[ARX-C0001-E01] Quotation"), "ARX-C0001-E01");
is("lower case comes back upper", refFromSubject("[alg09012-26] hello"), "ALG09012-26");

console.log("\nPALG is not read as ALG");
// `ALG` is a suffix of `PALG`. Ordered wrong, the alternation matches from the
// ALG and yields a reference that looks valid and points at nothing.
is("the whole token, not its tail", refFromSubject("[PALG09003-26] x"), "PALG09003-26");
is("and it is a partner one", seriesOf(refFromSubject("[PALG09003-26] x")!), "partner");
is("while ALG is a shipment one", seriesOf(refFromSubject("[ALG09012-26] x")!), "shipment");
is("as is the old form", seriesOf("ARX-C0001-E01"), "shipment");

console.log("\nit survives what mail clients do to a subject");
is("Re:", refFromSubject("Re: [ALG09012-26] Rate for Colombo"), "ALG09012-26");
is("stacked prefixes", refFromSubject("Re: FW: [ALG09012-26] Rate"), "ALG09012-26");
is("trailing text", refFromSubject("[ALG09012-26]"), "ALG09012-26");

console.log("\nwhat is not a reference");
is("no token", refFromSubject("Rate for Colombo"), null);
is("bare, no brackets", refFromSubject("ALG09012-26 rate"), null);
is("wrong digit count", refFromSubject("[ALG0912-26] x"), null);
is("no year", refFromSubject("[ALG09012] x"), null);
is("empty subject", refFromSubject(""), null);

console.log("\nadding the token");
is("onto a plain subject", withToken("Rate for Colombo", "ALG09012-26"), "[ALG09012-26] Rate for Colombo");
is("the token itself", subjectToken("PALG09003-26"), "[PALG09003-26]");
// Idempotent, or every reply in a long thread adds another copy.
is(
  "not added twice",
  withToken("Re: [ALG09012-26] Rate", "ALG09012-26"),
  "Re: [ALG09012-26] Rate"
);
// A thread that already carries one keeps it. Two references on one subject is
// how a conversation comes to be filed in two places.
is(
  "an existing reference is not replaced",
  withToken("Re: [ALG09012-26] Rate", "PALG09003-26"),
  "Re: [ALG09012-26] Rate"
);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
