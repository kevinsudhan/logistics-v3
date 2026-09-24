import { ewayDays, ewayExpiry, ewayState, handoverIssues, movementStatus, moveTitle, readEwayBill, statusStrip, type MoveLike } from "../../src/lib/movements";

/**
 * Pickups and deliveries: where each stands, the e-way bill's life under
 * GST Rule 138, and what the handover showed against the booking.
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

const m = (p: Partial<MoveLike>): MoveLike => ({ planned_date: null, requested_at: null, vehicle_number: null, actual_at: null, attempts: [], ...p });

console.log("\nwhere a move stands");
is("nothing yet", movementStatus(m({})), "not_arranged");
is("a date", movementStatus(m({ planned_date: "2026-10-04" })), "planned");
is("the order went", movementStatus(m({ planned_date: "2026-10-04", requested_at: "2026-10-02T09:00:00Z" })), "requested");
is("a truck", movementStatus(m({ requested_at: "2026-10-02T09:00:00Z", vehicle_number: "TN01AB1234" })), "assigned");
is("done", movementStatus(m({ vehicle_number: "TN01AB1234", actual_at: "2026-10-04T06:00:00Z" })), "done");
const failed = m({ planned_date: "2026-10-04", vehicle_number: "TN01AB1234", attempts: [{ at: "2026-10-04T08:00:00Z", reason: "Factory closed" }] });
is("a failed attempt stands", movementStatus(failed), "failed");
is("until planned for a later day", movementStatus({ ...failed, planned_date: "2026-10-05" }), "assigned");
is("the strip", statusStrip(m({ planned_date: "2026-10-04", requested_at: "x" })).map((s) => s.done), [true, true, false, false]);

console.log("\nthe e-way bill number");
is("spaced", readEwayBill("1234 5678 9012"), { value: "123456789012", error: null });
is("with EWB No. in front", readEwayBill("EWB No. 1234-5678-9012").value, "123456789012");
is("too short says so", readEwayBill("12345").error, "An e-way bill number has twelve digits; this has 5.");

console.log("\nhow long it lasts (Rule 138)");
is("up to 200 km: one day", ewayDays(150, false), 1);
is("300 km: two days", ewayDays(300, false), 2);
is("over-dimensional: a day per 20 km", ewayDays(50, true), 3);
is("generated 10:00 on the 4th for 150 km runs to the end of the 5th", ewayExpiry("2026-10-04T04:30:00Z", 150, false), "2026-10-05T18:29:59.000Z");
is("generated late at night IST counts India's day", ewayExpiry("2026-10-04T20:00:00Z", 150, false), "2026-10-06T18:29:59.000Z");

console.log("\nwhat to warn about");
const bill = { eway_bill_no: "123456789012", eway_bill_at: "2026-10-04T04:30:00Z", eway_distance_km: 150, eway_odc: false, actual_at: null };
is("needed above ₹50,000", ewayState({ ...bill, eway_bill_no: null }, 480000, new Date("2026-10-04T00:00:00Z")).state, "needed");
is("not needed below", ewayState({ ...bill, eway_bill_no: null }, 40000, new Date()).state, "not_needed");
is("unknown value: no guess", ewayState({ ...bill, eway_bill_no: null }, null, new Date()).state, "not_needed");
is("valid", ewayState(bill, 480000, new Date("2026-10-04T12:00:00Z")).state, "valid");
is("expiring within twelve hours", ewayState(bill, 480000, new Date("2026-10-05T10:00:00Z")).state, "expiring");
is("expired before the cargo moved", ewayState(bill, 480000, new Date("2026-10-06T01:00:00Z")).state, "expired");
is("lapsed before the handover", ewayState({ ...bill, actual_at: "2026-10-06T05:00:00Z" }, 480000, new Date()).state, "lapsed");
is("handed over in time", ewayState({ ...bill, actual_at: "2026-10-05T05:00:00Z" }, 480000, new Date()).state, "valid");
is("without the date or distance", ewayState({ ...bill, eway_distance_km: null }, 480000, new Date()).state, "incomplete");

console.log("\nthe handover");
is("all as booked", handoverIssues({ pieces: 10, gross_weight_kg: 2010, condition: "good", exception_note: null }, { pieces: 10, grossKg: 2000 }), []);
is("short pieces", handoverIssues({ pieces: 9, gross_weight_kg: null, condition: null, exception_note: null }, { pieces: 10, grossKg: 2000 }), ["9 pieces against 10 booked"]);
is("weight off by more than 5%", handoverIssues({ pieces: null, gross_weight_kg: "2200", condition: null, exception_note: null }, { pieces: 10, grossKg: 2000 }), ["2,200 kg against 2,000 kg booked"]);
is("damaged, with the note", handoverIssues({ pieces: 10, gross_weight_kg: null, condition: "damaged", exception_note: "2 cartons crushed" }, { pieces: 10, grossKg: null }), ["Damaged: 2 cartons crushed"]);
is("a split pickup is not held to the whole booking", handoverIssues({ pieces: 4, gross_weight_kg: null, condition: null, exception_note: null }, { pieces: 10, grossKg: null }, 0.5), []);

console.log("\ntitles");
is("one", moveTitle("pickup", 1, 1), "Pickup");
is("several", moveTitle("delivery", 2, 3), "Delivery 2 of 3");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
