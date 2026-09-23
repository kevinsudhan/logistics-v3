import {
  fmt,
  isEmptyLine,
  kgPerCbm,
  lineGross,
  lineVolumeCbm,
  lineVolumeWeight,
  ownedByLines,
} from "../../src/lib/dimensions";

/**
 * The per-line figures in the dimension table.
 *
 * The totals under the table are worked out in the database from the same
 * lines (063). These have to use the same formulas, or a row and the total
 * beneath it disagree on screen — and whichever one somebody believes, the
 * other is on the quotation.
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
const r3 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);

const line = { pieces: 10, length: 100, width: 120, height: 130, weight_per_piece: 50, gross_weight: null };

console.log("\nvolume, from centimetres");
is("10 × 100×120×130 cm is 15.6 CBM", r3(lineVolumeCbm(line, "cm_kg")), 15.6);
is("a missing height is no volume, not a smaller one", lineVolumeCbm({ ...line, height: null }, "cm_kg"), null);
is("no pieces is no volume", lineVolumeCbm({ ...line, pieces: null }, "cm_kg"), null);

console.log("\nvolume, from inches — the same numbers read as inches");
// 10 × 1,560,000 in³ × 16.387064 cm³/in³ — what the database computed (255.638).
is("10 × 100×120×130 in is 255.638 CBM", r3(lineVolumeCbm(line, "in_lb")), 255.638);

console.log("\ngross weight of a line");
is("pieces × per piece", lineGross(line), 500);
is("the line's own total wins over pieces × per piece", lineGross({ ...line, gross_weight: 480 }), 480);
is("per piece with no pieces is unknown", lineGross({ ...line, pieces: null }), null);
is("nothing given is unknown, not zero", lineGross({ ...line, weight_per_piece: null }), null);
is("zero is an answer", lineGross({ ...line, weight_per_piece: null, gross_weight: 0 }), 0);

console.log("\nvolume weight, by mode");
is("sea LCL: one tonne to the cube", r3(lineVolumeWeight(line, "cm_kg", "sea_lcl")), 15600);
is("air: 6000 cm³ to the kilo", r3(lineVolumeWeight(line, "cm_kg", "air")), 2600);
is("road: 333 kg to the cube", r3(lineVolumeWeight(line, "cm_kg", "road")), 5194.8);
is("FCL has none — it is bought by the box", lineVolumeWeight(line, "cm_kg", "sea_fcl"), null);
is("no mode, no ratio", lineVolumeWeight(line, "cm_kg", null), null);
is("in pounds when the line is in pounds", r3(lineVolumeWeight({ ...line, length: 10, width: 10, height: 10, pieces: 1 }, "in_lb", "air")), r3((1000 * 16.387064) / 6000 / 0.45359237));
is("ratio for air", r3(kgPerCbm("air")), 166.667);

console.log("\nempty rows");
is("a row with nothing in it is empty", isEmptyLine({ pieces: null, length: null, width: null, height: null, weight_per_piece: null, gross_weight: null }), true);
is("a row with only a count is not", isEmptyLine({ pieces: 2, length: null, width: null, height: null, weight_per_piece: null, gross_weight: null }), false);

console.log("\nnumbers on screen");
is("grouped the Indian way", fmt(1234567.891), "12,34,567.89");
is("no trailing zeros", fmt(2.5), "2.5");
is("blank for nothing", fmt(null), "");

console.log("\nwhat a mail reading may still fill");
const blank = { pieces: null, length: null, width: null, height: null, weight_per_piece: null, gross_weight: null };
is("no lines: everything", ownedByLines([]), []);
is("only empty rows: everything", ownedByLines([blank]), []);
is(
  "sized and weighed lines own every figure",
  ownedByLines([line]),
  ["piece_length_cm", "piece_width_cm", "piece_height_cm", "weight_per_piece_kg", "piece_count", "volume_cbm", "gross_weight_kg"]
);
is(
  "sized but unweighed lines leave a stated gross weight fillable",
  ownedByLines([{ ...line, weight_per_piece: null }]).includes("gross_weight_kg"),
  false
);
is(
  "a count alone leaves the stated volume fillable",
  ownedByLines([{ ...blank, pieces: 6 }]).includes("volume_cbm"),
  false
);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
