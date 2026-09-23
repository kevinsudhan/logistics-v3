import { daysUntil, dueState, dueText, todayIST } from "../../src/lib/progress";

/**
 * How late a step is.
 *
 * The worklist sorts and colours on this, so a wrong answer is a late job
 * shown as fine — or the desk chasing something not yet due.
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

const today = "2026-10-03";

console.log("\ntoday is India's today");
// 20:00 UTC on the 2nd is 01:30 on the 3rd in Chennai.
is("late evening UTC is already tomorrow in Chennai", todayIST(new Date("2026-10-02T20:00:00Z")), "2026-10-03");
is("early UTC is the same day", todayIST(new Date("2026-10-03T02:00:00Z")), "2026-10-03");

console.log("\ndays between");
is("same day", daysUntil("2026-10-03", today), 0);
is("across a month end", daysUntil("2026-11-01", "2026-10-31"), 1);
is("in the past", daysUntil("2026-09-30", today), -3);

console.log("\nstate");
is("done is done, whatever the date", dueState("2026-09-01", true, today), "done");
is("no date is undated, not overdue", dueState(null, false, today), "none");
is("yesterday is overdue", dueState("2026-10-02", false, today), "overdue");
is("today is today", dueState("2026-10-03", false, today), "today");
is("two days out is soon", dueState("2026-10-05", false, today), "soon");
is("a week out is later", dueState("2026-10-10", false, today), "later");

console.log("\nwords");
is("several days", dueText("2026-09-30", false, today), "3 days overdue");
is("one day", dueText("2026-10-02", false, today), "1 day overdue");
is("today", dueText("2026-10-03", false, today), "due today");
is("tomorrow", dueText("2026-10-04", false, today), "due tomorrow");
is("a date", dueText("2026-10-09", false, today), "due 9 Oct");
is("nothing for a done step", dueText("2026-09-30", true, today), "");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
