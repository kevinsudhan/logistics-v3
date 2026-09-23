import { buildTimeline, upcoming } from "../../src/lib/trackingTimeline";

/**
 * The shipment's timeline: five records and the job's events merged into one
 * line, newest first, with nothing said twice.
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

const steps = [
  { label: "Order confirm", done_at: "2026-09-22T10:00:00Z", due_on: "2026-09-22", stage: "booked", note: "" },
  { label: "Pickup follow-up", done_at: "2026-09-28T05:00:00Z", due_on: "2026-09-28", stage: null, note: "Truck at 10" },
  { label: "Loading follow-up", done_at: null, due_on: "2026-10-02", stage: "sailed", note: "" },
  { label: "HAWB confirmation", done_at: null, due_on: "2026-10-01", stage: null, note: "" },
  { label: "Documents", done_at: null, due_on: null, stage: null, note: "" },
];
const t = buildTimeline({
  steps,
  moves: [{ kind: "pickup", actual_at: "2026-09-28T05:10:00Z", vehicle_number: "TN01AB1234", transporter: "Sai Transports", pieces: 14, received_by: null }],
  receipts: [{ receipt_no: "WR-00001", received_at: "2026-09-30T05:30:00Z", location: "MAA cargo complex", pieces: 14, gross_weight_kg: 520, condition: "damaged" }],
  legs: [
    { move: "road", from_place: "Sriperumbudur", to_place: "MAA", etd: "2026-09-28", eta: "2026-09-28", carrier: "Sai Transports", voyage_flight: null, status: "completed" },
    { move: "air", from_place: "MAA", to_place: "FRA", etd: "2026-10-02", eta: "2026-10-03", carrier: "Emirates", voyage_flight: "EK 543", status: "planned" },
  ],
  events: [
    { at: "2026-09-29T08:00:00Z", kind: "party_notified", summary: "Shipment update sent to Meera (Shipper)" },
    { at: "2026-09-28T05:10:00Z", kind: "stage_changed", summary: "ARX-SHP-0004 moved to cargo received" },
    { at: "2026-09-27T08:00:00Z", kind: "quote_sent", summary: "Quoted ₹12,000" },
  ],
});

console.log("\nthe line");
is("newest first", t[0].title, "Received at the warehouse (WR-00001)");
is("a damaged receipt is a warning", t[0].tone, "warning");
is("the receipt says what was counted", t[0].detail, "MAA cargo complex · 14 pcs · 520 kg · damaged");
is("undone steps are not on it", t.some((e) => e.title === "Loading follow-up"), false);
is("stage changes are not said twice", t.some((e) => e.title.includes("moved to")), false);
is("sales events stay on the case file", t.some((e) => e.title.startsWith("Quoted")), false);
is("who was told is on it", t.some((e) => e.kind === "event" && e.title.includes("Meera")), true);
is("a planned leg is not history yet", t.some((e) => e.title.includes("Air leg")), false);
is("a completed leg is", t.some((e) => e.title === "Road leg completed: Sriperumbudur → MAA"), true);
is("the pickup names the truck", t.find((e) => e.kind === "pickup")?.detail, "14 pcs · Sai Transports · TN01AB1234");
is("a milestone step is marked", t.find((e) => e.title === "Order confirm")?.tone, "milestone");
is("a step's note comes with it", t.find((e) => e.title === "Pickup follow-up")?.detail, "Truck at 10");

console.log("\nwhat comes next");
is(
  "open dated steps, soonest first",
  upcoming(steps).map((u) => u.label),
  ["HAWB confirmation", "Loading follow-up"]
);
is("an undated step is not guessed a date", upcoming(steps).some((u) => u.label === "Documents"), false);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
