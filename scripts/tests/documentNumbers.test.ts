import { documentDataFromBooking, documentDataFromEnquiry, documentFilename, documentNo } from "../../src/lib/documents/data";

/**
 * What a printed document is numbered and filed under.
 *
 * The job's ALG reference, not the ARX- house prefix and not the booking's row
 * id (ARX-SHP-0004), which nobody outside the database has heard of.
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

const enquiry = {
  ref: "ALG09004-26",
  origin: "Chennai",
  destination: "Jebel Ali",
  cargo: null,
  cargo_type: null,
  incoterm: null,
  ready_date: null,
  piece_count: null,
  piece_length_cm: null,
  piece_width_cm: null,
  piece_height_cm: null,
  gross_weight_kg: null,
  volume_cbm: null,
  stackable: null,
  upright_only: null,
  consignee_name: null,
  consignee_country: null,
};

const booking = {
  id: "ARX-SHP-0004",
  enquiry_ref: "ALG09004-26",
  origin: "Chennai",
  destination: "Jebel Ali",
  cargo: null,
  piece_count: null,
  volume_cbm: null,
  gross_weight_kg: null,
  agreed_inr: null,
  sailing_date: null,
  carrier: null,
  booking_number: null,
  container_number: null,
  bl_number: null,
  vessel: null,
  etd: null,
  eta: null,
};

const QUO = { id: "quotation", numberPrefix: "QUO" };
const BKG = { id: "booking-confirmation", numberPrefix: "BKG" };
const BL = { id: "bl-final", numberPrefix: "BL" };

console.log("\nfrom an enquiry");
const fromEnquiry = documentDataFromEnquiry(enquiry);
is("numbered by the enquiry ref", documentNo(QUO, fromEnquiry), "QUO-ALG09004-26");
is("the file carries the same number", documentFilename(QUO, fromEnquiry), "QUO-ALG09004-26-quotation.pdf");
is("a ref from before 044 loses its house prefix", documentNo(QUO, documentDataFromEnquiry({ ...enquiry, ref: "ARX-C0001-E02" })), "QUO-C0001-E02");

console.log("\nfrom a booking");
const fromBooking = documentDataFromBooking(booking);
is("no B/L yet: the job reference, not the row id", documentNo(BKG, fromBooking), "BKG-ALG09004-26");
is("the reference is the job's", fromBooking.reference, "ALG09004-26");
is("the footer names the job", fromBooking.sourceNote, "From the booking on job ALG09004-26.");
const withBl = documentDataFromBooking({ ...booking, bl_number: "MSCU7845120" });
is("a B/L number numbers it once there is one", documentNo(BL, withBl), "BL-MSCU7845120");
is("and the reference stays the job's", withBl.reference, "ALG09004-26");
is("the file", documentFilename(BL, withBl), "BL-MSCU7845120-bl-final.pdf");

console.log("\nthe master bill beside the house bill (082)");
const consol = documentDataFromBooking({ ...booking, bl_number: "HBL/26-27/0001", mainline_no: "MSKU7654321" });
is("a house bill under a master carries both", [consol.blNumber, consol.masterBlNumber], ["HBL/26-27/0001", "MSKU7654321"]);
is("still numbered by the house bill", documentNo(BL, consol), "BL-HBL/26-27/0001");
is("and filed without the slashes", documentFilename(BL, consol), "BL-HBL-26-27-0001-bl-final.pdf");
is("a direct job's one bill is not printed twice", documentDataFromBooking({ ...booking, bl_number: "MSKU7654321", mainline_no: "MSKU7654321" }).masterBlNumber, undefined);
is("no master recorded: none", fromBooking.masterBlNumber, undefined);

console.log("\nnothing printed says ARX-");
for (const [label, data, spec] of [
  ["enquiry", fromEnquiry, QUO],
  ["booking", fromBooking, BKG],
  ["booking with B/L", withBl, BL],
] as const) {
  const printed = [documentNo(spec, data), documentFilename(spec, data), data.reference, data.sourceNote].join(" ");
  is(label, printed.includes("ARX-"), false);
}

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
