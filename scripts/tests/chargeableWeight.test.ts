import {
  chargeableWeight,
  describeChargeable,
  modeFor,
  volumeFromPieces,
} from "../../src/lib/chargeableWeight";

/**
 * What the cargo is billed on.
 *
 * Every LCL rate this desk quotes is per chargeable unit, so a wrong figure
 * here is a wrong price on a document a customer holds — and wrong in the
 * direction that costs money, because understating volume is the common way to
 * get it wrong.
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

console.log("\nsea LCL bills on whichever is greater, one tonne to the cube");
// 800kg over 4 CBM: light cargo, charged on the space it takes.
is("light cargo pays for its space", chargeableWeight(800, 4, "sea_lcl")?.value, 4);
is("and says so", chargeableWeight(800, 4, "sea_lcl")?.basis, "volume");
// 6 tonnes in 2 CBM: dense cargo, charged on mass.
is("dense cargo pays for its mass", chargeableWeight(6000, 2, "sea_lcl")?.value, 6);
is("and says so", chargeableWeight(6000, 2, "sea_lcl")?.basis, "weight");
// The tie goes to volume, which is what the trade does — and either way the
// number is the same, so only the explanation differs.
is("a tie reads as volume", chargeableWeight(3000, 3, "sea_lcl")?.basis, "volume");

console.log("\nit rounds up, because the carrier does");
// 2.01 CBM is three units on the bill. Quoting 2.01 loses the difference.
is("just over two is three", chargeableWeight(100, 2.01, "sea_lcl")?.value, 3);
is("exactly two is two", chargeableWeight(100, 2, "sea_lcl")?.value, 2);
// Guards the float: 2/1 must not come out as 3 through 2.0000000000000004.
is("a whole number is not pushed up", chargeableWeight(1000, 1, "sea_lcl")?.value, 1);

console.log("\nair converts at 6000 cm3 to the kilo and bills in half kilos");
// 1 CBM = 166.67 volumetric kg. Upward to the half-kilo is 167, not 166.5 —
// the step is the unit billed in, and rounding to the nearer one would round
// down half the time.
is("volumetric wins on light air cargo", chargeableWeight(50, 1, "air")?.value, 167);
is("unit is kilos", chargeableWeight(50, 1, "air")?.unit, "kg");
// 500kg in 1 CBM: actual weight wins.
is("actual weight wins when dense", chargeableWeight(500, 1, "air")?.value, 500);
is("half-kilo step, upward", chargeableWeight(100.1, 0.01, "air")?.value, 100.5);
// The mode is not interchangeable: the same consignment, six times the figure.
is("sea would have said 1", chargeableWeight(50, 1, "sea_lcl")?.value, 1);

console.log("\nroad converts at 333kg to the cube");
is("a tonne of road freight is 3 CBM", chargeableWeight(999, 1, "road")?.value, 3);
is("unit is CBM", chargeableWeight(999, 1, "road")?.unit, "CBM");

console.log("\nnothing is invented");
// Weight but no volume is not a chargeable weight yet. Deriving the volume
// from a piece count would put an unmeasured number on a quotation.
is("no volume", chargeableWeight(800, null, "sea_lcl"), null);
is("no weight", chargeableWeight(null, 4, "sea_lcl"), null);
is("neither", chargeableWeight(null, null, "sea_lcl"), null);
is("both zero", chargeableWeight(0, 0, "sea_lcl"), null);
is("a negative is refused", chargeableWeight(-5, 4, "sea_lcl"), null);
is("text where a number should be", chargeableWeight(NaN, 4, "sea_lcl"), null);

console.log("\nvolume from piece dimensions");
// 120 x 100 x 125 cm, four of them — the demo consignment. 1.5 CBM each.
is("four pallets", volumeFromPieces(120, 100, 125, 4), 6);
is("one piece", volumeFromPieces(100, 100, 100, 1), 1);
// The divisor is 1,000,000. Using 1000 reports a 1.2m crate as 0.0018 CBM.
is("cubic centimetres, not litres", volumeFromPieces(100, 100, 100, 1), 1);
is("a missing dimension gives nothing", volumeFromPieces(120, null, 125, 4), null);
is("zero pieces", volumeFromPieces(120, 100, 125, 0), null);
is("a negative dimension", volumeFromPieces(-120, 100, 125, 4), null);

console.log("\nthe explanation under the figure");
is(
  "says which side won and what the other was",
  describeChargeable(chargeableWeight(800, 4, "sea_lcl")),
  "4 CBM — charged on volume (0.80 by weight)"
);
is("and says plainly when it cannot", describeChargeable(null), "Needs both a gross weight and a volume");

console.log("\nthe mode follows the container where it can");
is("air", modeFor("AIR"), "air");
is("an airway bill", modeFor("awb"), "air");
is("a forty-foot box", modeFor("40GP"), "sea_lcl");
is("nothing recorded falls to sea", modeFor(null), "sea_lcl");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
