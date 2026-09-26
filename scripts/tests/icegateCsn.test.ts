import { readFileSync } from "node:fs";
import {
  CSN_SCHEMA,
  buildCsn,
  csnProblems,
  draftFor,
  isoSize,
  partyFrom,
  schemaErrors,
  ymd,
  type CsnSettings,
  type CsnSource,
} from "../../src/lib/icegateCsn";

/**
 * The CSN for ICEGATE (import consol, SCE): the checker against Customs' own
 * samples and schema, and a console built into a file that passes it.
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
const read = (f: string) => JSON.parse(readFileSync(`docs/icegate-csn/samples/${f}`, "utf8").replace(/^﻿/, ""));

console.log("the checker, on Customs' own files");
const sce = read("F_SACHM22_SCE_SOMESENDER_2_190820201705_DEC.json");
is("the official SCE sample passes the official schema", schemaErrors(sce), []);
is("and the SCA (amendment) sample does not claim to be an SCE", read("F_SACHM22_SCA_SOMETESTUSER_6055_20200701_DEC.json").headerField.reportingEvent, "SCA");
const broken = JSON.parse(JSON.stringify(sce));
delete broken.master.mastrCnsgmtDec[0].MCRef.mstrBlNo;
broken.master.mastrCnsgmtDec[0].trnsprtDoc.cnsgnrStreetAddress = "X".repeat(71);
broken.master.decRef.prtofRptng = "MAA1";
broken.master.voyageDtls.totalNmbrOfLines = "1";
is(
  "a broken copy is caught where ICEGATE would catch it",
  schemaErrors(broken).map((e) => `${e.path}: ${e.message}`),
  [
    "master.decRef.prtofRptng: is shorter than 5 characters",
    "master.decRef.prtofRptng: is not in the format ICEGATE expects",
    "master.voyageDtls.totalNmbrOfLines: should be a number",
    "master.mastrCnsgmtDec[0].MCRef.mstrBlNo: is required",
    "master.mastrCnsgmtDec[0].trnsprtDoc.cnsgnrStreetAddress: is 71 characters; the most is 70",
  ]
);
is("an unsigned file is not faulted for the signature it has not had yet", schemaErrors({ ...sce, digSign: undefined }, CSN_SCHEMA, { unsigned: true }), []);
is("but a signed one must carry it", schemaErrors({ ...sce, digSign: undefined }).map((e) => e.path), ["digSign"]);

console.log("\nreading what the CRM holds");
const p = partyFrom("Ningbo Star Imp & Exp Co., Ltd", "Room 1203, No. 88 Jiangdong Road\nNingbo, Zhejiang 315040\nChina");
is("name in capitals", p.name, "NINGBO STAR IMP & EXP CO., LTD");
is("street without the city line", p.street, "ROOM 1203, NO. 88 JIANGDONG ROAD");
is("city", p.city, "NINGBO");
is("province as the subdivision", p.subdivision, "ZHEJIANG");
is("postcode", p.postcode, "315040");
is("country from the last line", p.country, "CN");
const q = partyFrom("Kevin Imports", "12 Anna Salai, Chennai 600002", "IN");
is("a one-line address split at its commas: street", q.street, "12 ANNA SALAI");
is("…and city", q.city, "CHENNAI");
is("…and the postcode", q.postcode, "600002");
is("…with the country it was given", q.country, "IN");
const r4 = partyFrom("A", "No.55, 3B, 3rd Floor, W-Block\n3rd Main Road, Anna Nagar, Chennai 600040\nIndia");
is('"Anna Nagar, Chennai 600040": Chennai is the city, Anna Nagar the street', [r4.street, r4.city, r4.subdivision, r4.postcode], ["NO.55, 3B, 3RD FLOOR, W-BLOCK, 3RD MAIN ROAD, ANNA NAGAR", "CHENNAI", "", "600040"]);
const r5 = partyFrom("A", "1 Port St\nNewark, NJ 07102\nUSA");
is("a US state code is the subdivision", [r5.city, r5.subdivision, r5.country], ["NEWARK", "NJ", "US"]);
const r3 = partyFrom("A", "Plot 7, SIPCOT\nGuindy, Chennai, Tamil Nadu 600032\nIndia");
is("three parts on the last line: the first goes to the street", [r3.street, r3.city, r3.subdivision], ["PLOT 7, SIPCOT, GUINDY", "CHENNAI", "TAMIL NADU"]);
is("a date typed the Indian way", ymd("25/09/2026"), "20260925");
is("a date as the form keeps it", ymd("2026-09-25"), "20260925");
is("a date as a B/L prints it", ymd("25 Sep 2026"), "20260925");
is("nonsense is not a date", ymd("next week"), "");
is("40HC is 45G1", isoSize("40HC"), "45G1");
is("20GP is 22G1", isoSize("20' GP"), "22G1");
is("40 reefer is 45R1", isoSize("40RF"), "45R1");
is("an ISO code already on the box wins", isoSize("40HC", "42G1"), "42G1");

console.log("\na console, all the way to a file");
const settings: CsnSettings = { icegate_id: "ALGCHN01", pan: "ABDCA2229C", authorised_pan: "ABCPK1234L", port_of_reporting: "INMAA1" };
const box = { container_no: "TGHU 8261450", size_type: "40HC", iso_code: "", seal_type: "bolt", seal_no: "SL-889201", package_count: 40, weight_kg: 11800, is_soc: false };
const bill = (hbl: string, shipper: string, consignee: string, iec: string, pkgs: string, kg: string) => ({
  hbl_no: hbl,
  data: {
    shipper_name: shipper,
    shipper_address: "Room 5, No. 9 Tianhe Road\nGuangzhou 510000\nChina",
    consignee_name: consignee,
    consignee_address: "No 4, Industrial Estate, Guindy\nChennai 600032\nIndia",
    consignee_iec: iec,
    consignee_gstin: "",
    notify_name: "SAME AS CONSIGNEE",
    notify_address: "",
    notify_iec: "",
    port_of_loading: "Shanghai",
    place_of_delivery: "Chennai",
    port_of_discharge: "Chennai",
    containers: [{ container_no: "TGHU8261450", seal_no: "SL889201", size_type: "40HC", packages: pkgs, package_type: "CTNS", gross_kg: kg, cbm: "12" }],
    marks_numbers: "N/M",
    packages: pkgs,
    description: "Textile machinery spare parts",
    hs_code: "8448.49.00",
    gross_weight_kg: kg,
    measurement_cbm: "12",
    date_of_issue: "20 Sep 2026",
    on_board_date: "",
  },
});
const src: CsnSource = {
  console: { mbl_number: "SHCHN2609001", mbl_date: "2026-09-19", pol: "Shanghai", pol_code: "CNSHA", pod: "Chennai", pod_code: "INMAA", place_of_delivery: "Chennai", delivery_code: "INMAA" },
  jobs: [
    { id: "ARX-SHP-0101", ref: "ALG09101-26", bill: bill("GZL2609001", "Guangzhou Star Machinery Co", "Sri Balaji Textiles Pvt Ltd", "0412345678", "25", "7200"), cfs_code: "INMAA1CFS1", containers: [] },
    { id: "ARX-SHP-0102", ref: "ALG09102-26", bill: bill("GZL2609002", "Foshan Parts Ltd", "Kovai Looms", "0498765432", "15", "4600"), cfs_code: "INMAA1CFS1", containers: [] },
  ],
  containers: [box],
  mblShipper: { name: "Global Consol Shanghai Ltd", address: "88 Century Avenue, Pudong\nShanghai 200120\nChina" },
  desk: {
    name: "Aashish Logistics Global Pvt Ltd",
    address: "No.55, 3B, 3rd Floor, W-Block, Anna Nagar\nChennai 600040\nIndia",
    pan: "ABDCA2229C",
    postal: { street: "NO.55, 3B, 3RD FLOOR, W-BLOCK, 3RD MAIN ROAD, ANNA NAGAR", city: "CHENNAI", state: "TAMIL NADU", postcode: "600040", country: "IN" },
  },
};
const draft = draftFor(src, settings);
is("the master line is the carrier's master B/L", [draft.mblNo, draft.mblDate], ["SHCHN2609001", "2026-09-19"]);
is("a house per job, from its received B/L", draft.houses.map((h) => h.hblNo), ["GZL2609001", "GZL2609002"]);
is("the importer's IEC is the consignee code", [draft.houses[0].consignee.code, draft.houses[0].consignee.codeType], ["0412345678", "IEC"]);
is("\"same as consignee\" notify is the consignee", draft.houses[0].notify.name, "SRI BALAJI TEXTILES PVT LTD");
is("the master packages add up the houses", [draft.packages, draft.grossKg], ["40", "11800"]);
is("the box, from the console", [draft.containers[0].no, draft.containers[0].size, draft.containers[0].load, draft.containers[0].seal], ["TGHU8261450", "45G1", "FCL", "SL889201"]);
is("the HS code as digits", draft.houses[0].items[0].hs, "84484900");
is("the desk as the master B/L's consignee, in Customs' parts", [draft.consignee.street, draft.consignee.city, draft.consignee.subdivision, draft.consignee.code], ["NO.55, 3B, 3RD FLOOR, W-BLOCK, 3RD MAIN ROAD, ANNA NAGAR", "CHENNAI", "TAMIL NADU", "ABDCA2229C"]);

// What the desk still has to give: the vessel's IMO and the voyage call number.
const asked = csnProblems(draft, settings).filter((x) => x.level === "error");
is("only the vessel's IMO number and the VCN are left to fill", asked.map((x) => `${x.where}: ${x.field}`), ["Master: Vessel IMO number", "Master: Voyage call number (VCN)"]);
draft.vesselImo = "9618587";
draft.vcn = "INMAA120262017";
is("filled in, nothing stands in the way", csnProblems(draft, settings).filter((x) => x.level === "error"), []);

const doc = buildCsn(draft, settings, { jobNo: 12, date: "20260926", time: "T10:05" }) as {
  headerField: Record<string, unknown>;
  master: { authPrsn: Record<string, unknown>; mastrCnsgmtDec: Array<{ MCRef: Record<string, unknown>; houseCargoDec: Array<{ HCRef: Record<string, unknown>; trnsprtDoc: Record<string, unknown>; itemDtls: Array<Record<string, unknown>> }> }> };
};
is("and the file passes CBIC's schema", schemaErrors(doc, CSN_SCHEMA, { unsigned: true }), []);
is("header: SACHM22, SCE1102, the desk's ICEGATE ID, the port", [doc.headerField.messageID, doc.headerField.versionNo, doc.headerField.reportingEvent, doc.headerField.senderID, doc.headerField.receiverID, doc.headerField.sequenceOrControlNumber], ["SACHM22", "SCE1102", "SCE", "ALGCHN01", "INMAA1", 12]);
is("filed as a consolidator (ANC) on the desk's PAN", doc.master.authPrsn, { sbmtrTyp: "ANC", sbmtrCd: "ABDCA2229C", authReprsntvCd: "ABCPK1234L" });
const mc = doc.master.mastrCnsgmtDec[0];
is("master: consolidated, nothing filed before", [mc.MCRef.consolidatedIndctr, mc.MCRef.prevDec, mc.MCRef.consolidatorPan, mc.MCRef.mstrBlDt], ["C", "N", "PAN:ABDCA2229C", "20260919"]);
is("houses: H, numbered from 1", mc.houseCargoDec.map((h) => [h.HCRef.subLineNo, h.HCRef.consolidatedIndctr, h.HCRef.blNo, h.HCRef.blDt]), [[1, "H", "GZL2609001", "20260920"], [2, "H", "GZL2609002", "20260920"]]);
is("not hazardous: ZZZZZ and ZZZ, as the guide says", [mc.houseCargoDec[0].itemDtls[0].unoCd, mc.houseCargoDec[0].itemDtls[0].imdgCd], ["ZZZZZ", "ZZZ"]);
is("the consignee's IEC goes as its code, typed IEC", [mc.houseCargoDec[0].trnsprtDoc.cnsgnesCd, mc.houseCargoDec[0].trnsprtDoc.typOfCd], ["0412345678", "IEC"]);

console.log("\nwhat it catches");
const bad = draftFor(src, { ...settings, pan: "ABC", port_of_reporting: "" });
bad.vesselImo = "9618587";
bad.vcn = "X";
bad.houses[1].consignee.code = "";
bad.houses[1].items[0].hs = "";
bad.houses[0].consignor.street = "A".repeat(75);
const found = csnProblems(bad, { ...settings, pan: "ABC", port_of_reporting: "" }).filter((x) => x.level === "error").map((x) => `${x.where}: ${x.field} ${x.message}`);
is("a PAN that is not one", found.includes("Settings: Desk PAN is not a PAN (five letters, four digits, a letter)"), true);
is("no port of reporting", found.includes("Settings: Port of reporting is not set"), true);
is("an import with no IEC", found.includes("ALG09102-26: Consignee's IEC / PAN is needed on an import (the importer's IEC, or PAN if they have none)"), true);
is("an item with no HS code", found.includes("ALG09102-26: Item 1: HS code is needed"), true);
is("an address line over ICEGATE's 70", found.includes("ALG09101-26: Shipper's street address is 75 characters; the most is 70"), true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
