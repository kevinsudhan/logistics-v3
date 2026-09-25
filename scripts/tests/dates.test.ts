import { formatDate, toDate } from "../../src/lib/dates";

/**
 * Dates in words (lib/dates.ts): the month from a fixed list, never "Sept".
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

// Local time throughout: the desk's browsers are in IST, and a stamp is shown
// as the local clock read it.
const stamp = new Date(2026, 8, 15, 14, 5); // Tue 15 Sep 2026, 14:05
const morning = new Date(2026, 8, 3, 9, 7);

console.log("\nSeptember is Sep");
is("day and month", formatDate(stamp, { day: "numeric", month: "short" }), "15 Sep");
is("with the year", formatDate(stamp, { day: "numeric", month: "short", year: "numeric" }), "15 Sep 2026");
is("two-digit day", formatDate(morning, { day: "2-digit", month: "short" }), "03 Sep");
is("two-digit year", formatDate(stamp, { day: "numeric", month: "short", year: "2-digit" }), "15 Sep 26");
is("spelled out", formatDate(stamp, { day: "numeric", month: "long", year: "numeric" }), "15 September 2026");
is("every month is three letters", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((m) => formatDate(new Date(2026, m, 1), { month: "short" }).length), Array(12).fill(3));
is("a weekday", formatDate(stamp, { weekday: "short", day: "numeric", month: "short" }), "Tue 15 Sep");

console.log("\nthe time");
is("24-hour", formatDate(stamp, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), "15 Sep, 14:05");
is("24-hour pads the hour", formatDate(morning, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), "3 Sep, 09:07");
is("12-hour when asked", formatDate(stamp, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }), "15 Sep, 2:05 pm");
is("12-hour morning", formatDate(morning, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }), "3 Sep, 9:07 am");
is("midnight on a 12-hour clock is 12", formatDate(new Date(2026, 8, 3, 0, 30), { hour: "2-digit", minute: "2-digit", hour12: true }), "12:30 am");
is("full stamp", formatDate(stamp, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }), "15 Sep 2026, 14:05");

console.log("\non India's clock");
// 18:29 UTC on the 5th is 23:59 in India, whatever the machine's own zone.
const late = "2026-10-05T18:29:00Z";
is("the IST day and time", formatDate(late, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }), "5 Oct 2026, 23:59");
is("a minute later is the 6th", formatDate("2026-10-05T18:31:00Z", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }), "6 Oct");
is("its weekday", formatDate(late, { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }), "Mon 5 Oct");
is("midnight IST is 00", formatDate("2026-10-05T18:30:00Z", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }), "00:00");

console.log("\nwhat comes in");
is("a calendar day is that day", formatDate("2026-09-15", { day: "numeric", month: "short" }), "15 Sep");
is("a calendar day is midnight local", toDate("2026-09-15")!.getHours(), 0);
is("an ISO stamp", formatDate(stamp.toISOString(), { day: "numeric", month: "short" }), "15 Sep");
is("nothing", formatDate(null, { day: "numeric", month: "short" }), "");
is("not a date", formatDate("soon", { day: "numeric", month: "short" }), "");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
