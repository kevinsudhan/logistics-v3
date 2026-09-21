import { failureText } from "../../src/lib/errorText";

/**
 * What a failed RPC puts on screen.
 *
 * This exists because the guard in `promote_enquiry` was being reported as a
 * bug. It was not: it was refusing correctly and saying so, while the sentence
 * that told the operator how to clear it -- the Postgres hint -- was being
 * dropped on the floor by the catch block. A message without its hint leaves
 * somebody informed and stuck.
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

/** What supabase-js hands the catch block: an Error carrying the extra fields. */
function postgrest(message: string, hint = "", code = "P0001") {
  return Object.assign(new Error(message), { details: "", hint, code });
}

console.log("\nthe hint survives, because it is the actionable half");
is(
  "the written-acceptance guard, in full",
  failureText(
    postgrest(
      "Cannot start a shipment: ARX-C0007-E01 was accepted on a call but not confirmed in writing",
      "Send the quotation and confirm from their reply, or record the confirmation with a note."
    ),
    "Could not start the shipment."
  ),
  {
    message:
      "Cannot start a shipment: ARX-C0007-E01 was accepted on a call but not confirmed in writing",
    hint: "Send the quotation and confirm from their reply, or record the confirmation with a note.",
  }
);
is(
  "no quote yet is a different hint, not the same one",
  failureText(
    postgrest(
      "Cannot start a shipment: the customer has not accepted a quote on ARX-C0007-E01 yet",
      "Quote them first, then confirm their acceptance."
    ),
    "Could not start the shipment."
  ).hint,
  "Quote them first, then confirm their acceptance."
);

console.log("\nan error with no hint is not given an empty one");
is("hint absent", failureText(postgrest("boom"), "fallback").hint, null);
is("hint empty string", failureText(postgrest("boom", ""), "fallback").hint, null);
is("hint only whitespace", failureText(postgrest("boom", "   "), "fallback").hint, null);
is("hint is trimmed", failureText(postgrest("boom", "  do this  "), "fallback").hint, "do this");

console.log("\nthe fallback is used only when there is nothing to say");
is("a real message wins", failureText(postgrest("the database said no"), "fallback").message, "the database said no");
is("an empty message falls back", failureText(postgrest(""), "fallback").message, "fallback");
is("a whitespace message falls back", failureText(postgrest("   "), "fallback").message, "fallback");

console.log("\nthings that are not Errors at all");
is("a thrown string", failureText("nope", "fallback").message, "fallback");
is("null", failureText(null, "fallback").message, "fallback");
is("undefined", failureText(undefined, "fallback").message, "fallback");
// A bare object is what an older supabase-js handed back, and what a mock in a
// test is most likely to be. Its hint is still worth reading.
is("a plain object with a hint", failureText({ message: "x", hint: "try y" }, "fallback"), {
  message: "fallback",
  hint: "try y",
});
is("a non-string hint is ignored", failureText({ hint: 42 }, "fallback").hint, null);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
