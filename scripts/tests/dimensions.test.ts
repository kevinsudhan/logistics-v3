import {
  fmt,
  isEmptyLine,
  kgPerCbm,
  lineGross,
  lineVolumeCbm,
  lineVolumeWeight,
  ownedByLines,
  readSizes,
  sameSize,
  sizeToLine,
  sizesNotInTable,
  describeSize,
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

console.log("\nsizes read out of the mail");
const cartons = { pieces: 12, length_cm: 60, width_cm: 40, height_cm: 50, weight_per_piece_kg: 18, gross_weight_kg: null };
const crates = { pieces: 2, length_cm: 120, width_cm: 80, height_cm: 90, weight_per_piece_kg: 140, gross_weight_kg: null };
is("two sizes read as two", readSizes([cartons, crates]).length, 2);
is("not an array is nothing", readSizes(null), []);
is("zero and negative figures are dropped", readSizes([{ ...cartons, pieces: 0, weight_per_piece_kg: -5 }])[0], { ...cartons, pieces: null, weight_per_piece_kg: null });
is("a weight with no count or size is not a size", readSizes([{ pieces: null, length_cm: null, width_cm: null, height_cm: null, weight_per_piece_kg: 20, gross_weight_kg: null }]), []);
is("pieces are whole", readSizes([{ ...cartons, pieces: 12.4 }])[0].pieces, 12);

console.log("\nwhich sizes are new");
const row = (o: object) => ({ id: "x", position: 1, pieces: 12, length: 60, width: 40, height: 50, weight_per_piece: 18, gross_weight: null, ...o });
is("the size already in the table is not new", sizesNotInTable([cartons, crates], [row({})], "cm_kg"), [crates]);
is("the same carton written 40 x 60 x 50 is the same size", sameSize(cartons, row({ length: 40, width: 60 }), "cm_kg"), true);
is("a corrected height is a different size", sameSize({ ...cartons, height_cm: 55 }, row({}), "cm_kg"), false);
is("a different count is a different size", sameSize({ ...cartons, pieces: 10 }, row({}), "cm_kg"), false);
is("a table kept in inches is compared in centimetres", sameSize(cartons, row({ length: 60 / 2.54, width: 40 / 2.54, height: 50 / 2.54 }), "in_lb"), true);
is("an empty table means every size is new", sizesNotInTable([cartons], [], "cm_kg").length, 1);

console.log("\nwritten in the table's unit");
is("centimetres stay centimetres", sizeToLine(cartons, "cm_kg"), { pieces: 12, length: 60, width: 40, height: 50, weight_per_piece: 18, gross_weight: null });
is("an inch table gets inches and pounds", sizeToLine({ ...cartons, length_cm: 121.92, weight_per_piece_kg: 45.359 }, "in_lb").length, 48);
is("and pounds", sizeToLine({ ...cartons, weight_per_piece_kg: 45.359237 }, "in_lb").weight_per_piece, 100);

console.log("\non screen");
is("a proposed size reads plainly", describeSize(cartons), "12 × 60 × 40 × 50 cm · 18 kg each");
is("a count with no size says so", describeSize({ ...cartons, length_cm: null, weight_per_piece_kg: null }), "12 pieces, size not given");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
