import {
  byWhen,
  customerView,
  entryProblem,
  expectedFor,
  istParts,
  milestoneWhen,
  placeFor,
  suggestionFor,
  type Evidence,
  type MilestoneLike,
} from "../../src/lib/milestones";

/** The customer's milestones (102): what the page shows, in what order, and what the job offers. */

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

const m = (position: number, label: string, stage: string | null, reached_on: string | null = null, reached_time: string | null = null, extra: Partial<MilestoneLike> = {}): MilestoneLike => ({
  position,
  label,
  stage,
  reached_on,
  reached_time,
  ...extra,
});

// An LCL export, part way.
const lcl = [
  m(10, "Booking confirmed", "booked", "2026-09-22", "10:14:00"),
  m(20, "Cargo picked up", null, "2026-09-24"),
  m(30, "Received at the CFS", "cargo_received", "2026-09-24", "16:40:00"),
  m(40, "Export customs cleared", null),
  m(50, "Vessel sailed", "sailed", "2026-09-27", "14:30:00", { location: "Chennai" }),
  m(60, "Arrived at destination port", "arrived"),
  m(70, "Import customs cleared", null, null, null, { hidden: true }),
  m(80, "Out for delivery", null),
  m(90, "Delivered", "delivered"),
];

const v = customerView(lcl);
is("done, by when it happened", v.done.map((x) => x.label), ["Booking confirmed", "Received at the CFS", "Cargo picked up", "Vessel sailed"]);
is("a day with no time goes after the timed ones that day", v.done.slice(1, 3).map((x) => x.position), [30, 20]);
is("the latest", v.latest?.label, "Vessel sailed");
is("still to come, in the list's order", v.ahead.map((x) => x.label), ["Arrived at destination port", "Out for delivery", "Delivered"]);
is("overtaken without a record: not shown as to come", v.passed.map((x) => x.label), ["Export customs cleared"]);
is("hidden is nowhere", [...v.done, ...v.ahead, ...v.passed].some((x) => x.hidden), false);
is("the furthest stage", v.stage, "sailed");

// Delivered with out-for-delivery never recorded: the cargo is not going backwards.
const home = customerView([...lcl.slice(0, 8), m(90, "Delivered", "delivered", "2026-10-09", null, { note: "Received by Mr Rao." })]);
is("delivered is the latest", home.latest?.label, "Delivered");
is("nothing is still to come", home.ahead.length, 0);
is("the unrecorded steps are passed", home.passed.map((x) => x.position), [40, 60, 80]);
is("delivered stage", home.stage, "delivered");

// An update of the desk's own sits after the list: it must not pass the list's open milestones.
const ts = customerView([...lcl, m(1001, "Transhipped at Colombo", null, "2026-09-30", "08:15", { added: true })]);
is("the update is on the line, in time", ts.done.map((x) => x.position), [10, 30, 20, 50, 1001]);
is("and is the latest", ts.latest?.label, "Transhipped at Colombo");
is("arrival is still to come", ts.ahead[0]?.label, "Arrived at destination port");
is("the stage is still the sailing", ts.stage, "sailed");

is("a fresh job", customerView([m(10, "Booking confirmed", "booked", "2026-09-28", "09:00"), m(20, "Cargo picked up", null)]).ahead.length, 1);
is("nothing recorded", customerView([m(20, "Cargo picked up", null)]).stage, "booked");
is("byWhen is a total order", [m(2, "b", null, "2026-09-01"), m(1, "a", null, "2026-09-01"), m(3, "c", null, "2026-09-01", "23:00")].sort(byWhen).map((x) => x.label), ["c", "a", "b"]);

// The booking's promised dates, only for the sailing and the arrival.
const b = { etd: "2026-09-27", eta: "2026-10-05" };
is("sailing expected on the ETD", expectedFor(m(50, "Vessel sailed", "sailed"), b), "2026-09-27");
is("arrival expected on the ETA", expectedFor(m(60, "Arrived", "arrived"), b), "2026-10-05");
is("no date for the rest", expectedFor(m(80, "Out for delivery", null), b), null);
is("none once recorded", expectedFor(m(60, "Arrived", "arrived", "2026-10-04"), b), null);

is("when, with the time", milestoneWhen("2026-09-27", "14:30:00"), "27 Sep 2026, 14:30");
is("when, the day only, no year", milestoneWhen("2026-09-27", null, false), "27 Sep");
is("India's day and time", istParts("2026-09-27T20:00:00Z"), { on: "2026-09-28", time: "01:30" });

const places = { origin: "Chennai", destination: "Jebel Ali", port_of_loading: "Chennai (INMAA)", port_of_discharge: null };
is("sails from the port of loading", placeFor("departed", places), "Chennai (INMAA)");
is("arrives at the destination without a port", placeFor("arrived", places), "Jebel Ali");
is("no guess for customs", placeFor("export_customs", places), "");

is("a date is needed", entryProblem({ on: "", time: "" }, "2026-09-28"), "Give the date it happened.");
is("a bad time", entryProblem({ on: "2026-09-28", time: "25:00" }, "2026-09-28"), "The time is HH:MM, or leave it empty.");
is("tomorrow is allowed", entryProblem({ on: "2026-09-29", time: "" }, "2026-09-28"), null);
is("the day after is not", entryProblem({ on: "2026-09-30", time: "" }, "2026-09-28")?.startsWith("That date is in the future"), true);
is("across a month end", entryProblem({ on: "2026-10-01", time: "08:00" }, "2026-09-30"), null);

// What the job already says.
const ev: Evidence = {
  moves: [
    { kind: "pickup", actual_at: "2026-09-24T05:30:00Z", pieces: 8, received_by: null },
    { kind: "pickup", actual_at: "2026-09-24T07:00:00Z", pieces: 4, received_by: null },
    { kind: "delivery", actual_at: null, pieces: null, received_by: null },
  ],
  receipts: [
    { receipt_no: "WR-00002", received_at: "2026-09-25T04:00:00Z", location: "Chennai CFS", pieces: 4, gross_weight_kg: 120 },
    { receipt_no: "WR-00001", received_at: "2026-09-24T11:10:00Z", location: "Chennai CFS", pieces: 8, gross_weight_kg: 360 },
  ],
  customs: [{ side: "export", leo_date: "2026-09-26", ooc_date: null }],
  events: [
    { kind: "departed", occurred_at: "2026-09-27T09:00:00Z", location: "Chennai", source: "hapag_lloyd", status: "new", estimated: false },
    { kind: "departed", occurred_at: "2026-09-26T09:00:00Z", location: "Chennai", source: "mail", status: "dismissed", estimated: false },
    { kind: "arrived", occurred_at: "2026-10-05T06:00:00Z", location: "Jebel Ali", source: "hapag_lloyd", status: "new", estimated: true },
  ],
};
is("picked up when the last pickup was", suggestionFor("picked_up", ev), { on: "2026-09-24", time: "12:30", location: "", note: "12 pieces collected.", from: "Pickup & delivery" });
is("the first receipt, with the totals", suggestionFor("received", ev), { on: "2026-09-24", time: "16:40", location: "Chennai CFS", note: "12 pieces, 480 kg received.", from: "Warehouse receipt WR-00001" });
is("the LEO date", suggestionFor("export_customs", ev), { on: "2026-09-26", time: null, location: "", note: "", from: "Customs record (LEO)" });
is("no out-of-charge yet", suggestionFor("import_customs", ev), null);
is("a delivery still open offers nothing", suggestionFor("delivered", ev), null);
is("the carrier's sailing, not the dismissed one", suggestionFor("departed", ev), { on: "2026-09-27", time: "14:30", location: "Chennai", note: "", from: "Hapag-Lloyd" });
is("an estimate is not a record", suggestionFor("arrived", ev), null);
is("nothing for a code with no source", suggestionFor("booked", ev), null);

const delivered: Evidence = {
  ...ev,
  moves: [
    { kind: "delivery", actual_at: "2026-10-09T06:00:00Z", pieces: 8, received_by: "Mr Rao" },
    { kind: "delivery", actual_at: "2026-10-10T06:00:00Z", pieces: 4, received_by: "Stores" },
  ],
};
is("delivered in parts: the last, and who signed", suggestionFor("delivered", delivered), { on: "2026-10-10", time: "11:30", location: "", note: "Received by Mr Rao, Stores.", from: "Pickup & delivery" });

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
if (fail) process.exit(1);
