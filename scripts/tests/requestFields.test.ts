/**
 * Catalogue and merge tests.
 *
 * These cover the parts that decide whether a wrong value can reach a customer record:
 * coercion of what the model returns, and the merge rule that decides which pass wins.
 * The extraction call itself is not tested here — it needs the network and a key.
 *
 * Run with: npm run test:fields
 */
import {
  REQUEST_FIELDS,
  FIELD_KEYS,
  coerceField,
  normaliseDetails,
  completeness,
  mergeExtractions,
  resolveSailingDate,
} from "../../src/data/requestFields";
// mergeExtractions lives in the catalogue, not the extractor: it is pure logic, and
// importing the extractor here would drag in the Deno-only npm: specifiers with it.

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`);
  }
}

console.log("\ncatalogue");
check("no duplicate keys", new Set(FIELD_KEYS).size, FIELD_KEYS.length);
check(
  "every enum field declares options",
  REQUEST_FIELDS.filter((f) => f.kind === "enum" && !f.options?.length).length,
  0,
);
check(
  "every field has a hint for the model",
  REQUEST_FIELDS.filter((f) => !f.hint.trim()).length,
  0,
);

console.log("\ncoercion");
check("numeric string becomes a number", coerceField("piece_count", "40"), 40);
check("comma-grouped rupees parse", coerceField("target_price_inr", "1,25,000"), 125000);
check("negative setpoint survives", coerceField("temperature_setpoint_c", -18), -18);
check("non-numeric number field is dropped", coerceField("piece_count", "a few"), null);
check("boolean false is preserved, not treated as absent", coerceField("stackable", false), false);
check("yes/no strings coerce", coerceField("upright_only", "yes"), true);
check("enum matches case-insensitively", coerceField("container_type", "40hc"), "40HC");
check("enum outside the option list is dropped", coerceField("container_type", "45HC"), null);
check("unknown key is dropped", coerceField("not_a_field", "x"), null);
check("empty string is not a value", coerceField("company", ""), null);

console.log("\nnormalise");
check(
  "keeps only fields with a value",
  normaliseDetails({ company: "Meera Textiles", hs_code: null, piece_count: 40, junk: "x" }),
  { company: "Meera Textiles", piece_count: 40 },
);
check(
  "a false boolean is a captured field",
  completeness(normaliseDetails({ stackable: false })).filled,
  1,
);

console.log("\nmerge");
check(
  "regex fills what the model missed",
  mergeExtractions({ company: "Meera Textiles" }, { origin: "Chennai" }),
  { company: "Meera Textiles", origin: "Chennai" },
);
check(
  "regex never blanks a value the model found",
  mergeExtractions({ origin: "Chennai" }, { origin: null }),
  { origin: "Chennai" },
);
check(
  "model wins on free text the regex also guessed",
  mergeExtractions({ cargo_description: "cotton fabric rolls" }, { cargo_description: "textiles" }),
  { cargo_description: "cotton fabric rolls" },
);
check(
  "regex wins on a verbatim container code",
  mergeExtractions({ container_type: "40GP" }, { container_type: "40HC" }),
  { container_type: "40HC" },
);
check(
  "regex wins on a verbatim CBM figure",
  mergeExtractions({ volume_cbm: 12 }, { volume_cbm: 12.5 }),
  { volume_cbm: 12.5 },
);
check(
  "the model keeps money — the regex cannot tell a quote from an asking price",
  mergeExtractions({ target_price_inr: 85000 }, { target_price_inr: 96000 }),
  { target_price_inr: 85000 },
);

console.log(failures === 0 ? "\nall passed\n" : `\n${failures} failed\n`);
if (failures > 0) process.exit(1);

console.log("\nsailing date resolution");
check("ISO passes through", resolveSailingDate("2026-09-14", "2026-08-23"), "2026-09-14");
check("month and day resolve against the call", resolveSailingDate("August 30th", "2026-08-23"), "2026-08-30");
check("bare day uses the call's month", resolveSailingDate("the 30th", "2026-08-23"), "2026-08-30");
check("a day already past rolls to next year", resolveSailingDate("August 1st", "2026-08-23"), "2027-08-01");
check("a window stays a window", resolveSailingDate("first week of September", "2026-08-23"), null);
check("no call date means no guess", resolveSailingDate("August 30th", undefined), null);
check("impossible day is rejected", resolveSailingDate("February 31st", "2026-01-05"), null);
check("empty is null", resolveSailingDate("", "2026-08-23"), null);
