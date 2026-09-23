import { milestoneBar } from "../../src/lib/milestoneBar";

/** The customer page's milestone bar: reached by stage, dated by step. */

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

const AIR = ["booked", "cargo_received", "sailed", "arrived", "delivered"];
const word = (s: string) => ({ sailed: "Departed", cargo_received: "Received" })[s] ?? s;
const steps = [
  { stage: "booked", done_at: "2026-09-22T10:00:00Z" },
  { stage: null, done_at: "2026-09-23T10:00:00Z" },
  { stage: "cargo_received", done_at: "2026-09-24T09:00:00Z" },
  { stage: "sailed", done_at: null },
  { stage: "arrived", done_at: "2026-09-26T08:00:00Z" },
];

const bar = milestoneBar(AIR, word, steps, "arrived");
is("reached up to the job's stage", bar.map((m) => m.done), [true, true, true, true, false]);
is("the current one", bar.find((m) => m.current)?.stage, "arrived");
is("a skipped tick is still reached, without a date", [bar[2].done, bar[2].at], [true, null]);
is("dated by its own step", bar[1].at, "2026-09-24T09:00:00Z");
is("labels are the mode's words", bar[2].label, "Departed");

const fresh = milestoneBar(AIR, word, [], "booked");
is("a new booking is at the first", fresh.map((m) => m.current), [true, false, false, false, false]);

const cancelled = milestoneBar(AIR, word, steps, "cancelled");
is("a cancelled job reaches nothing", cancelled.some((m) => m.done || m.current), false);

const twice = milestoneBar(AIR, word, [{ stage: "sailed", done_at: "2026-09-25T12:00:00Z" }, { stage: "sailed", done_at: "2026-09-25T08:00:00Z" }], "sailed");
is("two steps for one milestone: the earlier", twice[2].at, "2026-09-25T08:00:00Z");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
