import { chargeableChange, compare, receivedTotals } from "../../src/lib/warehouse";

/**
 * Booked against received.
 *
 * The warehouse screen flags a difference to the desk and to accounts; a
 * missed short delivery is a claim nobody raised, and a missed heavier one is
 * a charge nobody billed.
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

console.log("\ntotals across receipts");
is(
  "two deliveries add up",
  receivedTotals([
    { pieces: 12, gross_weight_kg: 230, volume_cbm: 1.5 },
    { pieces: 2, gross_weight_kg: 290, volume_cbm: 1.8 },
  ]),
  { pieces: 14, grossKg: 520, volumeCbm: 3.3 }
);
is(
  "a receipt without a weight makes the weight unknown, not smaller",
  receivedTotals([
    { pieces: 12, gross_weight_kg: 230, volume_cbm: 1.5 },
    { pieces: 2, gross_weight_kg: null, volume_cbm: 1.8 },
  ]).grossKg,
  null
);
is("nothing received is nothing", receivedTotals([]), { pieces: null, grossKg: null, volumeCbm: null });

console.log("\ncomparisons");
is("one carton short is short", compare(14, 13, "pieces"), { verdict: "short", delta: -1 });
is("the right count matches", compare(14, 14, "pieces"), { verdict: "match", delta: 0 });
is("a scale's rounding is not a discrepancy", compare(496, 496.4, "weight").verdict, "match");
is("24 kg heavier is over", compare(496, 520, "weight"), { verdict: "over", delta: 24 });
is("volume within 2% matches", compare(3.168, 3.2, "volume").verdict, "match");
is("volume well over is over", compare(3.168, 3.5, "volume").verdict, "over");
is("unknown on either side is unknown", compare(null, 14, "pieces").verdict, "unknown");

console.log("\nthe chargeable weight moves");
const booked = { pieces: 14, grossKg: 496, volumeCbm: 3.168 };
const air = chargeableChange(booked, { pieces: 14, grossKg: 520, volumeCbm: 3.3 }, "air");
is("air: booked on volume, 528 kg", air.booked?.value, 528);
is("air: received on volume, 550 kg", air.received?.value, 550);
is("air: changed", air.changed, true);
is("the same figures do not change it", chargeableChange(booked, booked, "air").changed, false);
is("FCL has no chargeable weight to change", chargeableChange(booked, booked, "sea_fcl").booked, null);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
