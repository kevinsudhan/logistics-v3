import { preAlertHtml, preAlertSubject, type PreAlertInput } from "../../src/lib/preAlertMail";

/**
 * The pre-alert mail: the bills first, the subject an agent can file by,
 * nothing printed that the job does not hold, and what the agent must act on
 * said plainly.
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

const air: PreAlertInput = {
  ref: "ALG09004-26",
  shipmentId: "ARX-SHP-0004",
  agentName: "Gulf Freight LLC",
  mode: "air",
  masterBill: "176-12345675",
  houseBill: "MAA/DXB/HAWB0000001",
  carrier: "Emirates",
  flightNumber: "EK543",
  vessel: null,
  voyage: null,
  etd: "2026-09-25",
  etdTime: "09:35",
  eta: "2026-09-25",
  etaTime: null,
  portOfLoading: "Chennai (MAA)",
  portOfDischarge: "Dubai (DXB)",
  finalDestination: "Dubai (DXB)",
  shipper: "Nilgiri Power Systems\nSriperumbudur, India",
  consignee: "Gulf Metals FZE\nJebel Ali Free Zone, Dubai",
  notify: null,
  containers: [],
  pieces: 10,
  packageType: "cartons",
  grossKg: 2000,
  chargeableKg: 2600,
  volumeCbm: 15.6,
  commodity: "Textile machinery spare parts",
  hsCode: "8448.49",
  marks: null,
  incoterm: "FOB",
  freightTerms: "prepaid",
  unNumber: null,
  imoClass: null,
  deliveryTo: null,
  shippingBill: "1234567 dated 24 Sep 2026",
  attachmentNames: ["HAWB-MAA-DXB-HAWB0000001.pdf", "Invoice.pdf"],
};

console.log("\nthe subject");
is("reference, bills, flight, day and route", preAlertSubject(air), "[ALG09004-26] PRE-ALERT — HAWB MAA/DXB/HAWB0000001 / MAWB 176-12345675 — EK543 25 Sept MAA-DXB");
const sea = { ...air, mode: "sea_fcl", masterBill: "HLCUMAA260912345", houseBill: "HBL/26-27/0004", vessel: "MSC AURORA", voyage: "FA412E", flightNumber: null, portOfLoading: "Chennai (INMAA)", portOfDischarge: "Jebel Ali (AEJEA)" };
is("sea: house and master B/L, vessel and voyage", preAlertSubject(sea), "[ALG09004-26] PRE-ALERT — HBL HBL/26-27/0004 / MBL HLCUMAA260912345 — MSC AURORA FA412E 25 Sept INMAA-AEJEA");
is("without bills yet", preAlertSubject({ ...air, masterBill: null, houseBill: null }), "[ALG09004-26] PRE-ALERT — EK543 25 Sept MAA-DXB");

console.log("\nthe body");
const html = preAlertHtml(air);
is("greets the agent", html.startsWith("<p>Dear Gulf Freight LLC,</p>"), true);
is("bills come first", html.indexOf("MAWB") < html.indexOf("Airline"), true);
is("chargeable weight on a flight", html.includes("2,600 kg"), true);
is("date and time together", html.includes("25 Sep 2026, 09:35") || html.includes("25 Sept 2026, 09:35"), true);
is("a field the job lacks is not a line", [html.includes("Notify"), html.includes("Marks")], [false, false]);
is("final destination only when beyond the port", html.includes("Final destination"), false);
is("addresses keep their lines", html.includes("Nilgiri Power Systems<br>Sriperumbudur"), true);
is("the attachments are listed", html.includes("<li>Invoice.pdf</li>"), true);
is("nothing to act on, no Please note", html.includes("Please note"), false);

const seaHtml = preAlertHtml(sea);
is("no chargeable weight at sea", seaHtml.includes("Chargeable"), false);
is("vessel and voyage", seaHtml.includes("MSC AURORA / FA412E"), true);

console.log("\nwhat the agent must act on");
const dg = preAlertHtml({ ...air, unNumber: "un3481", imoClass: "9", deliveryTo: "Hofmann GmbH, Frankfurt", freightTerms: "collect" });
is("dangerous goods said plainly", dg.includes("Dangerous goods: UN3481, class 9"), true);
is("door delivery", dg.includes("Door delivery required to: Hofmann GmbH, Frankfurt"), true);
is("freight collect", dg.includes("please release against payment"), true);

console.log("\nnothing typed can break it");
is("names are escaped", preAlertHtml({ ...air, agentName: "<b>x</b>" }).includes("<b>x</b>"), false);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
