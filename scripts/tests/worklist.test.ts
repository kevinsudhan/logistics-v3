import {
  applyFilters,
  carriersOf,
  customsState,
  exportTable,
  matches,
  NO_EXTRAS,
  NO_FILTERS,
  sortRows,
  type Extras,
  type WorkRow,
} from "../../src/lib/worklist";

/**
 * The in-process worklist: find a job from whatever is in hand, narrow the
 * list, order it, write it out.
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

const row = (p: Partial<WorkRow>): WorkRow => ({
  id: "ARX-SHP-0001",
  enquiry_ref: "ALG09001-26",
  stage: "booked",
  transport_mode: "air",
  customer: { company: "Nilgiri Power Systems", name: "Meera" },
  origin: "Chennai (MAA)",
  destination: "Frankfurt",
  port_of_loading: "Chennai (MAA)",
  port_of_discharge: "Frankfurt (FRA)",
  carrier: "Emirates",
  flight_number: "EK 543",
  vessel: null,
  voyage: null,
  bl_number: "MAA/FRA/HAWB0000001",
  mainline_no: "176-12345675",
  container_number: null,
  booking_number: null,
  consignee_name: "Hofmann GmbH",
  shipper_name: "Nilgiri Power Systems",
  cargo: "Battery packs",
  etd: "2026-10-02",
  eta: "2026-10-03",
  created_at: "2026-09-20T10:00:00Z",
  assigned_to: null,
  ...p,
});

const air = row({});
const sea = row({
  id: "ARX-SHP-0002",
  enquiry_ref: "ALG09002-26",
  stage: "sailed",
  transport_mode: "sea_fcl",
  customer: { company: "Gulf Metals FZE", name: null },
  carrier: "Hapag-Lloyd",
  flight_number: null,
  vessel: "MSC AURORA",
  voyage: "FA412E",
  bl_number: "HBL/26-27/0004",
  container_number: "HLXU1234567",
  consignee_name: "Gulf Metals FZE",
  etd: "2026-09-28",
  eta: "2026-10-12",
  created_at: "2026-09-22T10:00:00Z",
});
const road = row({ id: "ARX-SHP-0003", transport_mode: "road", carrier: "emirates ", etd: null, eta: null, customer: { company: "", name: "Arjun" }, created_at: "2026-09-21T10:00:00Z", bl_number: null });

console.log("\nsearch from whatever is in hand");
is("the job number", matches(air, "shp-0001"), true);
is("the HAWB, typed with slashes", matches(air, "maa/fra/hawb"), true);
is("the container, typed with spaces", matches(sea, "HLXU 123456 7"), true);
is("the master bill without its dash", matches(air, "17612345675"), true);
is("the vessel", matches(sea, "aurora"), true);
is("the consignee", matches(air, "hofmann"), true);
is("every word must appear", matches(air, "emirates hapag"), false);
is("words in any order", matches(sea, "gulf fcl metals".replace("fcl", "hapag")), true);
is("nothing typed matches everything", matches(sea, "  "), true);

console.log("\nnarrowing");
const extras: Record<string, Extras> = {
  "ARX-SHP-0001": { ...NO_EXTRAS, soonest: "2026-09-30", overdue: 1, customs: "pending", updates: 2 },
  "ARX-SHP-0002": { ...NO_EXTRAS, soonest: "2026-10-05", customs: "on_hold" },
  "ARX-SHP-0003": { ...NO_EXTRAS, dueToday: 1 },
};
const x = (id: string) => extras[id] ?? NO_EXTRAS;
const all = [air, sea, road];
const ids = (rs: WorkRow[]) => rs.map((r) => r.id.slice(-1));
is("by mode", ids(applyFilters(all, { ...NO_FILTERS, mode: "sea_fcl" }, x)), ["2"]);
is("by carrier, spelling aside", ids(applyFilters(all, { ...NO_FILTERS, carrier: "Emirates" }, x)), ["1", "3"]);
is("customs on hold", ids(applyFilters(all, { ...NO_FILTERS, customs: "on_hold" }, x)), ["2"]);
is("no customs record", ids(applyFilters(all, { ...NO_FILTERS, customs: "none" }, x)), ["3"]);
is("overdue", ids(applyFilters(all, { ...NO_FILTERS, focus: "overdue" }, x)), ["1"]);
is("due today", ids(applyFilters(all, { ...NO_FILTERS, focus: "today" }, x)), ["3"]);
is("updates waiting", ids(applyFilters(all, { ...NO_FILTERS, focus: "updates" }, x)), ["1"]);
is("by stage and search together", ids(applyFilters(all, { ...NO_FILTERS, stage: "booked", query: "arjun" }, x)), ["3"]);

console.log("\nordering");
is("most urgent first, undated last", ids(sortRows(all, "urgency", x)), ["1", "2", "3"]);
is("by departure, undated last", ids(sortRows(all, "etd", x)), ["2", "1", "3"]);
is("by arrival", ids(sortRows(all, "eta", x)), ["1", "2", "3"]);
is("newest first", ids(sortRows(all, "newest", x)), ["2", "3", "1"]);
is("by customer", ids(sortRows(all, "customer", x)), ["3", "2", "1"]);

console.log("\ncustoms on a job");
is("nothing started", customsState([]), "none");
is("a hold wins", customsState([{ status: "cleared" }, { status: "on_hold" }]), "on_hold");
is("all cleared", customsState([{ status: "cleared" }]), "cleared");
is("anything open is in progress", customsState([{ status: "cleared" }, { status: "filed" }]), "pending");

console.log("\nthe carrier filter");
is("one of each, first spelling kept", carriersOf(all), ["Emirates", "Hapag-Lloyd"]);

console.log("\nthe spreadsheet");
const t = exportTable([sea, air], x, (r) => r.stage);
is("a header per column", t.columns.length, t.rows[0].length);
is("in screen order", t.rows.map((r) => r[0]), ["ARX-SHP-0002", "ARX-SHP-0001"]);
is("a vessel with its voyage", t.rows[0][7], "MSC AURORA / FA412E");
is("a flight for air", t.rows[1][7], "EK 543");
is("dates are dates", t.rows[0][10] instanceof Date, true);
is("customs in words", [t.rows[0][16], t.rows[1][16]], ["On hold", "In progress"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
