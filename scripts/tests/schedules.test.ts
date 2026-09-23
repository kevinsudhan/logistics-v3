import { onLane, parseServices, placeKey, schedulesFromSheet, toDate } from "../../src/lib/schedules";

/**
 * Uploading a sailing schedule.
 *
 * The sheets come from carriers and agents with their own headers and date
 * habits. What matters: the rows that can be read are read, the ones that
 * cannot are named by line, and nothing is guessed.
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

console.log("\ndates as people write them");
is("ISO", toDate("2026-10-02"), "2026-10-02");
is("day first, as India writes it", toDate("02-10-2026"), "2026-10-02");
is("with slashes", toDate("2/10/2026"), "2026-10-02");
is("in words", toDate("2 Oct 2026"), "2026-10-02");
is("an Excel serial", toDate(46297), "2026-10-02");
is("an impossible day is refused", toDate("31-02-2026"), "bad");
is("blank is blank", toDate(null), null);

console.log("\nservices");
is("space separated", parseServices("LCL FCL"), ["LCL", "FCL"]);
is("slashes and case", parseServices("lcl/fcl"), ["LCL", "FCL"]);
is("unknown words dropped", parseServices("FCL BULK"), ["FCL"]);

console.log("\na carrier's sheet");
const sheet = [
  ["MSC schedule — week 40"],
  ["POL", "POD", "Vessel Name", "Voyage", "ETD", "ETA", "CFS Cut Off", "Service", "Booking desk"],
  ["Chennai", "Jebel Ali", "MSC AURORA", "FA412E", "02-10-2026", "20-10-2026", "30-09-2026", "LCL FCL", "Ravi"],
  ["Chennai", "Colombo", "MSC ANNA", "FA413W", 46300, null, null, "FCL", null],
  [null, null, null, null, null, null, null, null, null],
  ["Chennai", null, "MSC LENI", "X", "2026-10-09", null, null, null, null],
  ["Chennai", "Singapore", "MSC LENI", "X", "2026-10-09", "2026-10-01", null, null, null],
  ["Chennai", "Singapore", "MSC LENI", "X", "next week", null, null, null, null],
];
const r = schedulesFromSheet(sheet);
is("the header row is found below a title", r.rows.length, 2);
is("aliases map", [r.rows[0].port_of_loading, r.rows[0].port_of_discharge, r.rows[0].vessel], ["Chennai", "Jebel Ali", "MSC AURORA"]);
is("dates convert", [r.rows[0].etd, r.rows[0].eta, r.rows[0].cfs_cutoff], ["2026-10-02", "2026-10-20", "2026-09-30"]);
is("a serial ETD converts", r.rows[1].etd, "2026-10-05");
is("sea by default", r.rows[0].mode, "sea");
is("unknown headers are named, not silently dropped", r.ignored, ["Booking desk"]);
is(
  "each bad row is reported by its line",
  r.errors.map((e) => e.line),
  [6, 7, 8]
);
is("and why", r.errors[1].message, "ETA is before ETD");

console.log("\na flight");
const air = schedulesFromSheet([
  ["Airline", "Flight", "POL", "POD", "ETD", "ETA"],
  ["Emirates", "EK 543", "MAA", "FRA", "2026-10-02", "2026-10-03"],
]);
is("a flight number makes it air", air.rows[0].mode, "air");

console.log("\nnothing recognisable");
is("says so", schedulesFromSheet([["a", "b"], ["1", "2"]]).errors.length, 1);

console.log("\nfinding the lane");
const sch = { port_of_loading: "Chennai (ex Madras)", port_of_discharge: "Jebel Ali (Dubai)", port_of_receipt: null, final_destination: null };
is("the place word", placeKey("Chennai (MAA), India"), "chennai");
is("the job's spelling finds the carrier's", onLane(sch, "Chennai (MAA)", "Jebel Ali / Dubai, UAE"), true);
is("the other way round is not the lane", onLane(sch, "Jebel Ali", "Chennai"), false);
is("no lane given matches everything", onLane(sch, null, null), true);
is("a final destination counts", onLane({ ...sch, final_destination: "Hamburg" }, "Chennai", "Hamburg"), true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
