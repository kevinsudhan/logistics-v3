import {
  appliesTo,
  clocksFor,
  clockText,
  shortDay,
  sideOf,
  summarise,
  termsText,
  type BoxDates,
  type FreeTimeTerms,
} from "../../src/lib/freeTime";

/**
 * Free time, demurrage and detention (083): the days, the states, the words.
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

const TODAY = "2026-10-20";

const separate: FreeTimeTerms = {
  free_time_basis: "separate",
  demurrage_free_days: 5,
  detention_free_days: 7,
  combined_free_days: null,
  demurrage_rate: 50,
  detention_rate: 30,
  combined_rate: null,
  dnd_currency: "USD",
};
const combined: FreeTimeTerms = { ...separate, free_time_basis: "combined", combined_free_days: 12, combined_rate: 40 };

const none: BoxDates = {
  discharged_on: null,
  gate_out_on: null,
  empty_returned_on: null,
  empty_picked_on: null,
  gate_in_on: null,
  loaded_on: null,
  is_soc: false,
};
const box = (dates: Partial<BoxDates>): BoxDates => ({ ...none, ...dates });
const pick = (c: ReturnType<typeof clocksFor>[number]) => ({
  kind: c.kind,
  state: c.state,
  used: c.used,
  left: c.left,
  over: c.over,
  lastFreeDay: c.lastFreeDay,
  accrued: c.accrued,
});

console.log("\nwhich end, and which jobs");
is("export counts at origin", sideOf("export"), "export");
is("import counts at destination", sideOf("import"), "import");
is("cross trade counts at destination", sideOf("cross_trade"), "import");
is("not stated: destination", sideOf(null), "import");
is("FCL has a box on the clock", appliesTo("sea_fcl"), true);
is("LCL does not", appliesTo("sea_lcl"), false);
is("air does not", appliesTo("air"), false);

console.log("\nan import, separate free time");
{
  const [dem, det] = clocksFor("import", separate, none, TODAY);
  is("two clocks, demurrage first", [dem.kind, det.kind], ["demurrage", "detention"]);
  is("nothing happened yet", [dem.state, det.state], ["waiting", "waiting"]);
  is("says what starts it", clockText(dem, TODAY), "Starts at discharge");
}
{
  // 18, 19, 20: day 3 of 5, the 22nd is the last free day.
  const [dem] = clocksFor("import", separate, box({ discharged_on: "2026-10-18" }), TODAY);
  is("discharged two days ago: ending", pick(dem), { kind: "demurrage", state: "ending", used: 3, left: 2, over: 0, lastFreeDay: "2026-10-22", accrued: 0 });
  is("in words", clockText(dem, TODAY), "Day 3 of 5 free · free until 22 Oct");
}
{
  const [dem] = clocksFor("import", separate, box({ discharged_on: "2026-10-12" }), TODAY);
  is("nine days in on five free: over", [dem.state, dem.over], ["over", 4]);
}
{
  const [dem] = clocksFor("import", { ...separate, demurrage_free_days: 14 }, box({ discharged_on: "2026-10-18" }), TODAY);
  is("plenty left: running", [dem.state, dem.left, dem.lastFreeDay], ["running", 11, "2026-10-31"]);
}
{
  const [dem] = clocksFor("import", separate, box({ discharged_on: "2026-10-10" }), TODAY);
  is("eleven days in, five free: six over at 50", pick(dem), { kind: "demurrage", state: "over", used: 11, left: -6, over: 6, lastFreeDay: "2026-10-14", accrued: 300 });
  is("in words", clockText(dem, TODAY), "6 days over free time · about USD 300");
}
{
  const [dem, det] = clocksFor("import", separate, box({ discharged_on: "2026-10-10", gate_out_on: "2026-10-14" }), TODAY);
  is("out on day five: demurrage stopped inside free time", [dem.state, dem.used, dem.over], ["closed", 5, 0]);
  is("in words", clockText(dem, TODAY), "Stopped on day 5, within free time");
  is("detention from gate-out: today is the last free day", [det.state, det.used, det.left], ["ending", 7, 0]);
  is("in words", clockText(det, TODAY), "Day 7 of 7 free · last free day today");
}
{
  const [dem] = clocksFor("import", separate, box({ discharged_on: "2026-10-10", gate_out_on: "2026-10-16" }), TODAY);
  is("out on day seven: two charged", [dem.state, dem.over, dem.accrued], ["closed_over", 2, 100]);
  is("in words", clockText(dem, TODAY), "Stopped on day 7, 2 days charged · about USD 100");
}
{
  const [, det] = clocksFor("import", separate, box({ discharged_on: "2026-10-01", gate_out_on: "2026-10-03", empty_returned_on: "2026-10-12" }), TODAY);
  is("empty back on day ten of detention: three charged at 30", [det.state, det.used, det.over, det.accrued], ["closed_over", 10, 3, 90]);
}
{
  const clocks = clocksFor("import", separate, box({ discharged_on: "2026-10-18", is_soc: true }), TODAY);
  is("a shipper-owned box pays demurrage only", clocks.map((c) => c.kind), ["demurrage"]);
}

console.log("\ncombined free time");
{
  const [c] = clocksFor("import", combined, box({ discharged_on: "2026-10-05" }), TODAY);
  is("one clock from discharge to empty return", [c.kind, c.from.key, c.to.key], ["combined", "discharged_on", "empty_returned_on"]);
  is("sixteen days, twelve free, four over at 40", [c.state, c.used, c.over, c.accrued], ["over", 16, 4, 160]);
}
{
  const [c] = clocksFor("import", { ...combined, demurrage_free_days: null, demurrage_rate: null }, box({ discharged_on: "2026-10-18", is_soc: true }), TODAY);
  is("shipper-owned on combined terms: the port's clock, on the combined days", [c.kind, c.freeDays, c.rate], ["demurrage", 12, 40]);
}
{
  const [c] = clocksFor("export", combined, box({ empty_picked_on: "2026-10-15" }), TODAY);
  is("an export's combined clock runs from empty pickup to loading", [c.from.key, c.to.key, c.used], ["empty_picked_on", "loaded_on", 6]);
}

console.log("\nan export, separate free time");
{
  const [det, dem] = clocksFor("export", separate, box({ empty_picked_on: "2026-10-15" }), TODAY);
  is("detention first, then demurrage", [det.kind, dem.kind], ["detention", "demurrage"]);
  is("day six of seven: last free day tomorrow", [det.state, det.used, det.left], ["ending", 6, 1]);
  is("in words", clockText(det, TODAY), "Day 6 of 7 free · last free day tomorrow");
  is("demurrage waits for gate-in", clockText(dem, TODAY), "Starts at gate-in");
}

console.log("\nthe awkward ones");
{
  const [dem] = clocksFor("import", { ...separate, demurrage_free_days: null }, box({ discharged_on: "2026-10-15" }), TODAY);
  is("running with no free days recorded", [dem.state, dem.used], ["no_terms", 6]);
  is("in words", clockText(dem, TODAY), "Day 6 — free days not recorded");
}
{
  const [dem] = clocksFor("import", separate, box({ discharged_on: "2026-10-15", gate_out_on: "2026-10-12" }), TODAY);
  is("stopped before it started is flagged, not counted", [dem.state, dem.used, dem.problem], ["closed", 0, "Gate-out is dated before discharge"]);
}
{
  const [dem] = clocksFor("import", separate, box({ discharged_on: "2026-10-25" }), TODAY);
  is("a discharge typed in advance says when free time will end", [dem.state, dem.lastFreeDay], ["waiting", "2026-10-29"]);
  is("in words", clockText(dem, TODAY), "Starts 25 Oct; free until 29 Oct");
}
{
  const [dem] = clocksFor("import", { ...separate, demurrage_free_days: 0 }, box({ discharged_on: TODAY }), TODAY);
  is("no free days: charged from day one", [dem.state, dem.over, dem.lastFreeDay], ["over", 1, "2026-10-19"]);
}
{
  const [dem] = clocksFor("import", { ...separate, demurrage_rate: null }, box({ discharged_on: "2026-10-10" }), TODAY);
  is("no rate: days over, no money", [dem.over, dem.accrued, clockText(dem, TODAY)], [6, null, "6 days over free time"]);
}

console.log("\nacross a job");
{
  const over = clocksFor("import", separate, box({ discharged_on: "2026-10-10" }), TODAY);
  const ending = clocksFor("import", separate, box({ discharged_on: "2026-10-18" }), TODAY);
  const s = summarise([ending, over], TODAY);
  is("the worst box speaks for the job", [s.state, s.over, s.boxes, s.text], ["over", 6, 2, "Free time over by 6 days"]);
  is("what is charged so far", [s.accrued, s.currency], [300, "USD"]);
}
{
  const a = clocksFor("import", separate, box({ discharged_on: "2026-10-18" }), TODAY);
  const b = clocksFor("import", separate, box({ discharged_on: "2026-10-16" }), TODAY);
  const s = summarise([a, b], TODAY);
  is("the sooner of two ending", [s.state, s.left, s.text], ["ending", 0, "Free time ends today"]);
}
{
  const s = summarise([clocksFor("import", { ...separate, demurrage_free_days: 14 }, box({ discharged_on: "2026-10-18" }), TODAY)], TODAY);
  is("running", [s.state, s.text], ["running", "Free until 31 Oct"]);
}
{
  const s = summarise(
    [clocksFor("import", separate, box({ discharged_on: "2026-10-01", gate_out_on: "2026-10-03", empty_returned_on: "2026-10-12" }), TODAY)],
    TODAY
  );
  is("every clock stopped: nothing to warn about", [s.state, s.text], ["none", ""]);
  is("but the charges it ran up are kept", s.accrued, 90);
}
is("no boxes", summarise([], TODAY).state, "none");

console.log("\nwords");
is("separate terms", termsText(separate), "5 days demurrage, 7 days detention");
is("combined terms", termsText(combined), "12 days, demurrage and detention combined");
is("one day", termsText({ ...separate, demurrage_free_days: 1, detention_free_days: null }), "1 day demurrage");
is("none recorded", termsText({ ...separate, demurrage_free_days: null, detention_free_days: null }), undefined);
is("this year's date", shortDay("2026-10-16", TODAY), "16 Oct");
is("next year's says so", shortDay("2027-01-02", TODAY), "2 Jan 2027");
is("September is Sep", shortDay("2026-09-25", TODAY), "25 Sep");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
