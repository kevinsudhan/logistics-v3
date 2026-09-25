import {
  consigneeText,
  emptyHbl,
  hblFromJob,
  missingForIssue,
  normaliseHbl,
  numberInWords,
  originalsInWords,
  refetch,
  titleOf,
  totalInWords,
  type JobForHbl,
} from "../../src/lib/hbl";
import { hblFileName, renderHblPdf } from "../../src/lib/documents/hblPdf";

/**
 * The house bill of lading (085): filling it from the job, the words it
 * prints, and what it needs before it is issued.
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

const job: JobForHbl = {
  shipment: {
    enquiry_ref: "ALG09004-26",
    transport_mode: "sea_fcl",
    shipper_name: "Kavitha Textiles",
    shipper_address: "12 Mill Road",
    shipper_city: "Tiruppur",
    shipper_state: "Tamil Nadu",
    shipper_pincode: "641601",
    shipper_country: "India",
    consignee_name: "Gulf Linen LLC",
    consignee_address: "Warehouse 4, Al Quoz",
    consignee_city: "Dubai",
    consignee_state: null,
    consignee_pincode: null,
    consignee_country: "United Arab Emirates",
    notify_name: null,
    notify_address: null,
    notify_city: null,
    notify_country: null,
    vessel: "MSC Aurora",
    voyage: "FA412E",
    port_of_loading: "Chennai (INMAA)",
    port_of_discharge: "Jebel Ali (AEJEA)",
    origin: "Chennai",
    destination: "Jebel Ali",
    etd: "2026-10-02",
    sailing_date: null,
    cargo: "Cotton bed linen",
    package_count: 480,
    package_type: "Cartons",
    piece_count: null,
    gross_weight_kg: 8640,
    volume_cbm: "40.32",
    marks_and_numbers: "KT/GL/1-480",
    hs_code: "630231",
    freight_terms: "prepaid",
    un_number: null,
    imo_class: null,
  },
  containers: [
    { container_no: "mscu1234565", seal_no: "ml123", size_type: "40' HC", package_count: 480, package_type: "Cartons", weight_kg: 8640, volume_cbm: 40.32 },
  ],
  agent: { name: "Gulf Freight Partners", address: "Jebel Ali Free Zone", contact: "ops@gfp.ae" },
  mto: { name: "Partner Logistics Pvt Ltd", registration: "mto/dgs/1234/2025" },
  place: "Chennai",
  today: "2026-09-25",
};

console.log("\nfilled from the job");
const d = hblFromJob(job);
is("the booking reference is the job's", d.booking_ref, "ALG09004-26");
is("shipper in capitals, address on lines", [d.shipper_name, d.shipper_address], ["KAVITHA TEXTILES", "12 MILL ROAD\nTIRUPPUR, TAMIL NADU, 641601\nINDIA"]);
is("no notify party of its own: same as consignee", [d.notify_name, d.notify_address], ["SAME AS CONSIGNEE", ""]);
is("the agent who delivers it", d.delivery_agent, "GULF FREIGHT PARTNERS\nJEBEL ALI FREE ZONE\nOPS@GFP.AE");
is("ports, and receipt and delivery at them", [d.port_of_loading, d.port_of_discharge, d.place_of_receipt, d.place_of_delivery], ["CHENNAI (INMAA)", "JEBEL ALI (AEJEA)", "CHENNAI (INMAA)", "JEBEL ALI (AEJEA)"]);
is("FCL is shipper's load and count", [d.service_type, d.shippers_load], ["FCL/FCL", true]);
is("the box and its seal", [d.containers[0].container_no, d.containers[0].seal_no, d.containers[0].packages], ["MSCU1234565", "ML123", "480"]);
is("the particulars", [d.packages, d.package_type, d.gross_weight_kg, d.measurement_cbm, d.hs_code], ["480", "CARTONS", "8640", "40.32", "630231"]);
is("prepaid, payable where we are", [d.freight_terms, d.freight_payable_at], ["prepaid", "CHENNAI"]);
is("issued here, today; on board at the ETD", [d.place_of_issue, d.date_of_issue, d.on_board_date], ["CHENNAI", "2026-09-25", "2026-10-02"]);
is("the MTO it is issued under", [d.mto_name, d.mto_registration], ["PARTNER LOGISTICS PVT LTD", "MTO/DGS/1234/2025"]);
is("collect is payable at destination", hblFromJob({ ...job, shipment: { ...job.shipment, freight_terms: "collect" } }).freight_payable_at, "JEBEL ALI (AEJEA)");
is("groupage is LCL and not the shipper's box", (() => { const x = hblFromJob({ ...job, shipment: { ...job.shipment, transport_mode: "sea_lcl" } }); return [x.service_type, x.shippers_load]; })(), ["LCL/LCL", false]);
is("dangerous goods said in the description", hblFromJob({ ...job, shipment: { ...job.shipment, un_number: "un1263", imo_class: "3" } }).description, "COTTON BED LINEN\nDANGEROUS GOODS UN1263 CLASS 3");

console.log("\na second fetch");
const edited = { ...d, description: "480 CARTONS COTTON BED LINEN, INVOICE KT/0912", remarks: "FREIGHT AS ARRANGED", vessel: "" };
const again = refetch(edited, hblFromJob({ ...job, shipment: { ...job.shipment, vessel: "MSC Luna", gross_weight_kg: 8700 } }));
is("the job's boxes are the job's", [again.vessel, again.gross_weight_kg], ["MSC LUNA", "8700"]);
is("the desk's description and remarks stay", [again.description, again.remarks], ["480 CARTONS COTTON BED LINEN, INVOICE KT/0912", "FREIGHT AS ARRANGED"]);
is("a blank on the job does not clear the document", refetch({ ...d, hs_code: "630231" }, { ...hblFromJob(job), hs_code: "" }).hs_code, "630231");

console.log("\nwords");
is("small", numberInWords(7), "SEVEN");
is("teens", numberInWords(13), "THIRTEEN");
is("tens with a hyphen", numberInWords(42), "FORTY-TWO");
is("hundreds with and", numberInWords(480), "FOUR HUNDRED AND EIGHTY");
is("thousands", numberInWords(1250), "ONE THOUSAND TWO HUNDRED AND FIFTY");
is("thousands and a small remainder", numberInWords(2005), "TWO THOUSAND AND FIVE");
is("FCL counts the boxes", totalInWords(d), "SAY ONE (1) X 40' HC CONTAINER ONLY");
is("two sizes, both counted", totalInWords({ ...d, containers: [...d.containers, { ...d.containers[0], size_type: "20' GP" }, { ...d.containers[0], size_type: "20' GP" }] }), "SAY ONE (1) X 40' HC CONTAINER AND TWO (2) X 20' GP CONTAINERS ONLY");
is("LCL counts the packages", totalInWords({ ...d, service_type: "LCL/LCL" }), "SAY FOUR HUNDRED AND EIGHTY (480) CARTONS ONLY");
is("a singular package", totalInWords({ ...d, service_type: "LCL/LCL", packages: "1", package_type: "PALLET" }), "SAY ONE (1) PALLET ONLY");
is("boxes, not boxs", totalInWords({ ...d, service_type: "LCL/LCL", packages: "3", package_type: "BOX" }), "SAY THREE (3) BOXES ONLY");
is("nothing to count", totalInWords({ ...emptyHbl() }), "");
is("originals", [originalsInWords(3), originalsInWords(1), originalsInWords(0)], ["THREE (3)", "ONE (1)", "NIL"]);
is("a bill of lading", titleOf("original").title, "BILL OF LADING");
is("telex is still a bill of lading", titleOf("telex").title, "BILL OF LADING");
is("express is a sea waybill", titleOf("express"), { title: "SEA WAYBILL", subtitle: "NON-NEGOTIABLE · NO ORIGINALS ISSUED" });
is("a named consignee", consigneeText(d).name, "GULF LINEN LLC");
is("to order", consigneeText({ ...d, consignee_mode: "to_order", consignee_name: "" }).name, "TO ORDER");
is("to order of a bank", consigneeText({ ...d, consignee_mode: "to_order", consignee_name: "EMIRATES NBD BANK" }).name, "TO ORDER OF EMIRATES NBD BANK");
is("not said twice", consigneeText({ ...d, consignee_mode: "to_order", consignee_name: "TO ORDER OF EMIRATES NBD BANK" }).name, "TO ORDER OF EMIRATES NBD BANK");

console.log("\nbefore it is issued");
is("filled from a complete job: ready", missingForIssue(d, "original", 3), []);
is("an empty one names everything", missingForIssue(emptyHbl(), "original", 3).length, 11);
is("to order needs no consignee name", missingForIssue({ ...d, consignee_mode: "to_order", consignee_name: "" }, "telex", 3), []);
is("not under any MTO", missingForIssue({ ...d, mto_registration: "" }, "original", 3), ["the MTO registration it is issued under"]);
is("originals must be one to three", missingForIssue(d, "original", 0), ["how many originals"]);
is("a sea waybill has none, and needs none", missingForIssue(d, "express", 0), []);

console.log("\nthe printed B/L");
{
  const pages = (print: "draft" | "original" | "copy", release: "original" | "telex" | "express", originals: number) =>
    renderHblPdf({ data: d, hblNo: "HBL/26-27/0001", release, originals, print }).getNumberOfPages();
  is("a draft is one page", pages("draft", "original", 3), 1);
  is("three originals are three pages", pages("original", "original", 3), 3);
  is("telex originals too, before they are surrendered", pages("original", "telex", 2), 2);
  is("a sea waybill has no originals: one page", pages("original", "express", 0), 1);
  is("a copy is one page", pages("copy", "original", 3), 1);
  is("filed without slashes", hblFileName({ hblNo: "HBL/26-27/0001", print: "original", release: "original" }), "HBL-26-27-0001-original.pdf");
  is("a sea waybill is filed as one", hblFileName({ hblNo: "HBL/26-27/0001", print: "original", release: "express" }), "HBL-26-27-0001-waybill.pdf");
  is("an unnumbered draft", hblFileName({ hblNo: null, print: "draft", release: "original" }), "HBL-draft-draft.pdf");
}

console.log("\nan older save");
is("missing boxes filled blank", normaliseHbl({ shipper_name: "X" } as never).containers, []);
is("and keeps what it had", normaliseHbl({ shipper_name: "X" } as never).shipper_name, "X");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
