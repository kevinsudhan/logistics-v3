import { airlineByName, airlineOf, airportOf, prefixOfMawb, serialOfMawb } from "../../src/lib/airlines";
import {
  awbTotals,
  chargeAmount,
  emptyCharge,
  emptyHawb,
  finalDestination,
  hawbFromJob,
  lineTotal,
  missingForOriginal,
  normaliseHawb,
  refetch,
  type HawbData,
  type JobForHawb,
} from "../../src/lib/hawb";

/**
 * The house air waybill.
 *
 * The job here is the one on the reference screen: 10 pieces, 2,000 kg,
 * 100 × 120 × 130 cm each, which is 15.6 CBM and 2,600 kg chargeable. What
 * matters: the form fills itself from the job and says so where it cannot,
 * a second fetch leaves the desk's own boxes alone, and the charge boxes add
 * up to the same totals the form printed — 12,000.00 prepaid.
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

console.log("\nairlines and airports");
is("the airline in a flight", airlineOf("EK 543"), "EK");
is("a digit in the code", airlineOf("6E-1234"), "6E");
is("not a flight", airlineOf("TBA"), null);
is("the airline in a carrier's name", airlineByName("Emirates SkyCargo"), "EK");
is("the prefix on file", prefixOfMawb("176-12345675"), "176");
is("and the serial", serialOfMawb("176-1234 5675".replace(" ", "")), "12345675");
is("a code the job spells out", airportOf("Chennai (MAA)"), { code: "MAA", city: "CHENNAI" });
is("a city this desk ships to", airportOf("Jebel Ali / Dubai, UAE"), { code: "DXB", city: "DUBAI" });
is("an unknown place gets no code", airportOf("Timbuktu").code, null);

const job: JobForHawb = {
  shipment: {
    shipper_name: "Prapti Logistics",
    shipper_address: "Summit Business Bay, Western Express Highway",
    shipper_city: "Mumbai",
    shipper_state: "Maharashtra",
    shipper_pincode: "400099",
    shipper_country: "India",
    shipper_pan: "abcde1234f",
    consignee_name: "Gulf Metals FZE",
    consignee_address: "Plot S30112, Jebel Ali Free Zone",
    consignee_city: "Dubai",
    consignee_state: null,
    consignee_pincode: null,
    consignee_country: "UAE",
    notify_name: null,
    notify_address: null,
    carrier: "Emirates",
    flight_number: "EK 71012",
    etd: "2026-09-18",
    sailing_date: null,
    port_of_loading: "Chennai (MAA)",
    port_of_discharge: "Jebel Ali / Dubai, UAE",
    origin: "Chennai (MAA)",
    destination: "Dubai",
    mainline_no: null,
    cargo: "Garments",
    piece_count: 10,
    package_count: 10,
    package_type: "cartons",
    gross_weight_kg: "2000.00",
    volume_cbm: "15.600",
    marks_and_numbers: null,
    hs_code: null,
    freight_terms: "prepaid",
    un_number: null,
    imo_class: null,
    enquiry_ref: "ALG09004-26",
  },
  airLegs: [],
  dims: [{ pieces: 10, length: 100, width: 120, height: 130 }],
  unit: "cm_kg",
  company: { name: "Aashish Logistics Global", address: ["Anna Nagar, Chennai 600040"], city: "Chennai" },
  userName: "Prathamesh",
  today: "2026-09-18",
};

console.log("\nfetch details");
const d = hawbFromJob(job);
is("the MAWB prefix from the airline", d.airline_prefix, "176");
is("departure code and city", [d.departure_code, d.departure_airport], ["MAA", "CHENNAI"]);
is("the shipper, upper case, address on lines", [d.shipper_name, d.shipper_address], ["PRAPTI LOGISTICS", "SUMMIT BUSINESS BAY, WESTERN EXPRESS HIGHWAY\nMUMBAI, MAHARASHTRA, 400099\nINDIA"]);
is("routing: to Dubai by Emirates", [d.to1, d.by1, d.destination_airport], ["DXB", "EK", "DUBAI"]);
is("the flight and its date", [d.flight1, d.flight1_date], ["EK71012", "2026-09-18"]);
is("the carrier and who signs for it", [d.carrier_name, d.carrier_signature], ["EMIRATES", "AS AGENTS FOR EMIRATES"]);
is("prepaid all through", [d.chgs_code, d.wt_val, d.other, d.accounting_info], ["PP", "P", "P", "** FREIGHT PREPAID **"]);
is("the rate line: pieces, gross, chargeable", [d.rates[0].pieces, d.rates[0].gross, d.rates[0].chargeable], ["10", "2000", "2600.0"]);
is("the goods with their sizes", d.nature_of_goods, "GARMENTS\nPCS/L X W X H (CM)\n10/100 X 120 X 130\nVOL: 15.600 CBM");
is("defaults the form prints", [d.dv_carriage, d.dv_customs, d.insurance, d.currency], ["NVD", "NCV", "NIL", "INR"]);
is("executed where it departs", [d.executed_on, d.executed_at], ["2026-09-18", "MAA"]);
is("our reference", d.reference_number, "ALG09004-26");

const collect = hawbFromJob({ ...job, shipment: { ...job.shipment, freight_terms: "collect" } });
is("collect all through", [collect.chgs_code, collect.wt_val, collect.accounting_info], ["CC", "C", "** FREIGHT COLLECT **"]);

const viaLegs = hawbFromJob({
  ...job,
  airLegs: [
    { to_place: "Dubai (DXB)", voyage_flight: "EK 543", etd: "2026-09-18", carrier: null },
    { to_place: "Frankfurt (FRA)", voyage_flight: "EK 45", etd: "2026-09-19", carrier: null },
  ],
});
is("two legs, two To/By pairs", [viaLegs.to1, viaLegs.by1, viaLegs.to2, viaLegs.by2], ["DXB", "EK", "FRA", "EK"]);
is("the second flight", [viaLegs.flight2, viaLegs.flight2_date], ["EK45", "2026-09-19"]);
is("the number goes to the last airport", finalDestination(viaLegs), "FRA");

const dg = hawbFromJob({ ...job, shipment: { ...job.shipment, un_number: "UN3481", imo_class: "9", notify_name: "Hofmann GmbH", notify_address: "Frankfurt" } });
is("dangerous goods and notify in handling", dg.handling_info, "DANGEROUS GOODS AS PER ATTACHED SHIPPER'S DECLARATION — UN3481 CLASS 9\nALSO NOTIFY: HOFMANN GMBH\nFRANKFURT");

console.log("\na second fetch");
const edited: HawbData = { ...d, handling_info: "KEEP DRY", shipper_name: "OLD NAME", rates: [{ ...d.rates[0], rate: "4.5", gross: "1" }] };
const again = refetch(edited, hawbFromJob(job));
is("the job's boxes come back from the job", again.shipper_name, "PRAPTI LOGISTICS");
is("the document's own are kept", again.handling_info, "KEEP DRY");
is("the rate stays, the weight is the job's", [again.rates[0].rate, again.rates[0].gross], ["4.5", "2000"]);
const blankJob = refetch({ ...d, consignee_name: "TYPED" }, { ...hawbFromJob(job), consignee_name: "" });
is("an empty job box does not clear the document", blankJob.consignee_name, "TYPED");

console.log("\nthe charge boxes, as on the reference");
const form: HawbData = {
  ...d,
  other_charges: [
    { ...emptyCharge(), name: "ADMINISTRATION FEE", per_unit: "1000", amount: "1500" },
    { ...emptyCharge(), name: "CUSTOMS DOCUMENTS", per_unit: "2500", amount: "4000" },
    { ...emptyCharge(), name: "FREIGHT CHARGE", per_unit: "3000", amount: "4500" },
    { ...emptyCharge(), name: "FREIGHT", per_unit: "1400", amount: "2000" },
  ],
};
const t = awbTotals(form);
is("due carrier, prepaid", t.prepaid.dueCarrier, 12000);
is("total prepaid", t.prepaid.total, 12000);
is("nothing collect", t.collect.total, 0);
is("totals of the rate lines", [t.pieces, t.gross, t.chargeable], [10, 2000, 2600]);

const rated = awbTotals({ ...form, rates: [{ ...form.rates[0], rate: "85" }], valuation_charge: "100", tax: "18" });
is("weight charge is rate × chargeable", rated.weightCharge, 221000);
is("valuation and tax follow WT/VAL", [rated.prepaid.valuation, rated.prepaid.tax], [100, 18]);
is("total prepaid adds every box", rated.prepaid.total, 221000 + 100 + 18 + 12000);

const cc = awbTotals({ ...form, wt_val: "C", rates: [{ ...form.rates[0], rate: "85" }], other_charges: [{ ...emptyCharge("C"), due: "agent", per_unit: "10", unit: "kg" }], conversion_rate: "0.044", charges_at_destination: "50" });
is("collect weight charge", cc.collect.weight, 221000);
is("per kg charge on chargeable weight, due agent", cc.collect.dueAgent, 26000);
is("collect in destination currency", cc.ccInDestCurrency, 10868);
is("total collect charges add destination charges", cc.totalCollectCharges, 10918);

is("a typed total overrides the rate", lineTotal({ ...form.rates[0], rate: "85", total: "100000" }), 100000);
is("a blank rate is no charge", lineTotal(form.rates[0]), 0);
is("per piece", chargeAmount({ ...emptyCharge(), unit: "piece", per_unit: "25" }, 2600, 10), 250);

console.log("\nwhat the original needs");
is("the reference job is complete", missingForOriginal(form), []);
is("an empty form says what it lacks", missingForOriginal(emptyHawb()).slice(0, 3), ["Shipper", "Consignee", "Departure airport code"]);
is("an unnamed charge is named", missingForOriginal({ ...form, other_charges: [emptyCharge()] }), ["Other charge 1: name"]);

console.log("\nan older save");
const old = normaliseHawb({ shipper_name: "X", rates: [{ pieces: "1" } as never] });
is("opens with every box", [old.shipper_name, old.currency, old.rates[0].unit, old.other_charges.length], ["X", "INR", "K", 0]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
