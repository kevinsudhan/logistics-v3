import { customsError, customsStatus, customsSteps, readIcegateNumber, readPortCode, sidesFor, type CustomsStatusInput } from "../../src/lib/customs";

/**
 * Customs clearance: where it stands, and the numbers as people type them.
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

const ex: CustomsStatusInput = {
  side: "export",
  hold_reason: null,
  checklist_approved_on: null,
  sb_number: null,
  examination: null,
  leo_date: null,
  igm_number: null,
  be_number: null,
  duty_paid_on: null,
  ooc_date: null,
};

console.log("\nan export clearance");
is("nothing yet", customsStatus(ex), "not_started");
is("checklist approved", customsStatus({ ...ex, checklist_approved_on: "2026-10-08" }), "checklist");
is("shipping bill filed", customsStatus({ ...ex, sb_number: "1234567" }), "filed");
is("customs want to look", customsStatus({ ...ex, sb_number: "1234567", examination: "required" }), "examination");
is("let export order", customsStatus({ ...ex, sb_number: "1234567", examination: "required", leo_date: "2026-10-11" }), "cleared");
is("a hold outranks everything", customsStatus({ ...ex, sb_number: "1234567", leo_date: "2026-10-11", hold_reason: "Query on HS code" }), "on_hold");
is("a blank hold is no hold", customsStatus({ ...ex, hold_reason: "  " }), "not_started");
is(
  "the strip for a filed bill",
  customsSteps({ ...ex, sb_number: "1234567", sb_date: "2026-10-10", be_date: null, igm_date: null }).map((s) => s.done),
  [true, true, false, false]
);
is("no examination needed counts as passed", customsSteps({ ...ex, sb_number: "1", examination: "not_required", sb_date: null, be_date: null, igm_date: null })[2].done, true);

console.log("\nan import clearance");
const im = { ...ex, side: "import" as const };
is("manifested", customsStatus({ ...im, igm_number: "2345678" }), "manifested");
is("bill of entry filed", customsStatus({ ...im, igm_number: "1", be_number: "7654321" }), "filed");
is("duty paid", customsStatus({ ...im, be_number: "7654321", duty_paid_on: "2026-10-20" }), "duty_paid");
is("out of charge", customsStatus({ ...im, be_number: "7654321", duty_paid_on: "2026-10-20", ooc_date: "2026-10-21" }), "cleared");

console.log("\nnumbers as typed");
is("plain", readIcegateNumber("1234567", "shipping bill"), { value: "1234567", error: null });
is("with SB No. in front and a space", readIcegateNumber("SB No. 123 4567", "shipping bill"), { value: "1234567", error: null });
is("with a dash", readIcegateNumber("123-4567", "bill of entry"), { value: "1234567", error: null });
is("too short says so", readIcegateNumber("12345", "shipping bill").error, "A shipping bill number has seven digits; this has 5.");
is("letters refused", readIcegateNumber("12AB567", "bill of entry").error, "A bill of entry number is digits only.");
is("blank is blank", readIcegateNumber("  ", "shipping bill"), { value: null, error: null });
is("a station code", readPortCode("inmaa4"), { value: "INMAA4", error: null });
is("a bad station code", readPortCode("MAA").value, null);

console.log("\nthe database's words, the desk's words");
is("dates out of order", customsError('new row violates check constraint "customs_leo_after_sb"'), "The LEO date cannot be before the shipping bill date.");
is("signed off", customsError("ARX-SHP-0004 is signed off; its customs record is closed with it"), "This job is signed off; its customs record is closed with it.");

console.log("\nwhich clearances a job needs");
is("export", sidesFor("export"), ["export"]);
is("import", sidesFor("import"), ["import"]);
is("cross trade: none by us", sidesFor("cross_trade"), []);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
