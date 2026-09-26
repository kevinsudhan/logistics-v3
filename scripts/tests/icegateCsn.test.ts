import { readFileSync } from "node:fs";
import {
  CSN_SCHEMA,
  SCA_SCHEMA,
  asFiled,
  amendmentProblems,
  buildAmendment,
  buildCsn,
  csnProblems,
  draftFor,
  isoSize,
  mergeDraft,
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
  agent: { name: "Global Consol Shanghai Ltd", address: "88 Century Avenue, Pudong\nShanghai 200120\nChina" },
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

console.log("\nan export console: the CSN on exit (SCX)");
const exportSrc: CsnSource = {
  console: { mbl_number: "MAAJEA2609007", mbl_date: "2026-09-24", pol: "Chennai", pol_code: "INMAA", pod: "Jebel Ali", pod_code: "AEJEA", place_of_delivery: "Dubai", delivery_code: "AEDXB" },
  jobs: [
    {
      id: "ARX-SHP-0201",
      ref: "ALG09201-26",
      bill: {
        hbl_no: "ALGMAA2609011",
        data: {
          shipper_name: "Sri Balaji Textiles Pvt Ltd",
          shipper_address: "No 4, Industrial Estate, Guindy\nChennai 600032\nIndia",
          consignee_name: "Al Noor Trading LLC",
          consignee_address: "Warehouse 12, Al Quoz Industrial 3\nDubai\nUAE",
          notify_name: "SAME AS CONSIGNEE",
          containers: [{ container_no: "MSKU7788990", seal_no: "ML445566", size_type: "20GP", packages: "30", package_type: "CTNS", gross_kg: "5400", cbm: "18" }],
          marks_numbers: "SBT/DXB/01-30",
          packages: "30",
          description: "Cotton yarn",
          hs_code: "5205",
          gross_weight_kg: "5400",
          measurement_cbm: "18",
          date_of_issue: "24 Sep 2026",
        },
      },
      cfs_code: "",
      containers: [],
      customer: { name: "Sri Balaji Textiles Pvt Ltd", iec: "0412345678", pan: "AAACS1234K", address: "No 4, Industrial Estate, Guindy", city: "Chennai", state: "Tamil Nadu", pincode: "600032", country: "India" },
      sb: { number: "4537880", date: "2026-09-22" },
    },
  ],
  containers: [{ container_no: "MSKU7788990", size_type: "20GP", iso_code: "", seal_type: "bolt", seal_no: "ML445566", package_count: 30, weight_kg: 5400, is_soc: false }],
  agent: { name: "Gulf Freight Partners LLC", address: "Office 504, Al Khaleej Centre\nDubai\nUAE" },
  desk: src.desk,
};
const ex = draftFor(exportSrc, { ...settings, iec: "" }, "SCX");
is("the event is SCX, movement foreign transhipment", [ex.event, ex.movement], ["SCX", "TC"]);
is("the desk ships the master B/L, with its PAN as IEC", [ex.consignor.name, ex.consignor.code, ex.consignor.codeType], ["AASHISH LOGISTICS GLOBAL PVT LTD", "ABDCA2229C", "IEC"]);
is("a different IEC in the settings wins", draftFor(exportSrc, { ...settings, iec: "0400012345" }, "SCX").consignor.code, "0400012345");
is("the destination agent receives it", [ex.consignee.name, ex.consignee.country], ["GULF FREIGHT PARTNERS LLC", "AE"]);
is("cleared at the port of reporting, bound for Dubai via Jebel Ali", [ex.firstPort, ex.nextPort, ex.destPort], ["INMAA1", "AEJEA", "AEDXB"]);
const eh = ex.houses[0];
is("the exporter is the customer on file, with its IEC", [eh.consignor.name, eh.consignor.city, eh.consignor.subdivision, eh.consignor.code, eh.consignor.codeType], ["SRI BALAJI TEXTILES PVT LTD", "CHENNAI", "TAMIL NADU", "0412345678", "IEC"]);
is("the overseas consignee, in the UAE", [eh.consignee.name, eh.consignee.country], ["AL NOOR TRADING LLC", "AE"]);
is("the shipping bill from the job's export customs", [eh.sbNo, eh.sbDate], ["4537880", "2026-09-22"]);
const exAsked = csnProblems(ex, settings).filter((x) => x.level === "error").map((x) => `${x.where}: ${x.field}`);
is("left to fill: the IMO, the VCN, and the shipping bill's PCIN", exAsked, ["Master: Vessel IMO number", "Master: Voyage call number (VCN)", "ALG09201-26: PCIN of the shipping bill"]);
ex.vesselImo = "9321483";
ex.vcn = "INMAA120262044";
ex.houses[0].pcin = "26PCEG0920173415400";
is("filled in, nothing ICEGATE would refuse", csnProblems(ex, settings).filter((x) => x.level === "error"), []);
is("the missing transhipper is only a warning", csnProblems(ex, settings).some((x) => x.field === "Transhipper code and bond" && x.level === "warning"), true);

type Doc = { headerField: Record<string, unknown>; master: { decRef: Record<string, unknown>; mastrCnsgmtDec: Array<Record<string, unknown> & { MCRef: Record<string, unknown>; locCstm: Record<string, unknown>; trnsprtDoc: Record<string, unknown>; trnsprtEqmt: Array<Record<string, unknown>>; houseCargoDec: Array<Record<string, unknown> & { HCRef: Record<string, unknown>; prevRef: Record<string, unknown> }> }> } };
const xd = buildCsn(ex, settings, { jobNo: 21, date: "20260926", time: "T15:10" }) as unknown as Doc;
is("the export file passes CBIC's schema", schemaErrors(xd, CSN_SCHEMA, { unsigned: true }), []);
is("header: SCX1102, event SCX", [xd.headerField.versionNo, xd.headerField.reportingEvent, xd.master.decRef.rptngEvent], ["SCX1102", "SCX", "SCX"]);
const xm = xd.master.mastrCnsgmtDec[0];
is("master: consolidated, fresh, cargo type EX, foreign transhipment", [xm.MCRef.consolidatedIndctr, xm.MCRef.prevDec, xm.locCstm.typOfCrgo, xm.locCstm.crgoMvmt], ["C", "N", "EX", "TC"]);
is("master shipper's code is the desk's IEC", [xm.trnsprtDoc.cnsgnrsCd, xm.trnsprtDoc.cnsgnrCdTyp], ["ABDCA2229C", "IEC"]);
const xh = xm.houseCargoDec[0];
is("house: H, previously declared by shipping bill (B), pointing at its PCIN", [xh.HCRef.consolidatedIndctr, xh.HCRef.prevDec, xh.prevRef.cinTyp, xh.prevRef.mcinPcin], ["H", "B", "PCIN", "26PCEG0920173415400"]);
is("on TC the house carries its transport document and location, but no items or itinerary", ["trnsprtDoc", "locCstm", "itemDtls", "itnry"].map((k) => k in xh), [true, true, false, false]);
is("the exporter's IEC on the house", [(xh.trnsprtDoc as Record<string, unknown>).cnsgnrsCd, (xh.trnsprtDoc as Record<string, unknown>).cnsgnrCdTyp], ["0412345678", "IEC"]);
is("the container agent code goes, empty when not known", xm.trnsprtEqmt[0].cntrAgntCd, "");
ex.movement = "FT";
const ft = (buildCsn(ex, settings, { jobNo: 22, date: "20260926", time: "T15:11" }) as unknown as Doc).master.mastrCnsgmtDec[0].houseCargoDec[0];
is("on FT the house is only its reference, PCIN, equipment and measures", Object.keys(ft).sort(), ["HCRef", "prevRef", "trnsprtDocMsr", "trnsprtEqmt"]);
ex.movement = "TC";
ex.transhipper = { code: "ONE001", bond: "BND2026" };
const withT = buildCsn(ex, settings, { jobNo: 23, date: "20260926", time: "T15:12" }) as unknown as Doc;
is("given, the transhipper goes on the master and the house", [withT.master.mastrCnsgmtDec[0].trnshpr, withT.master.mastrCnsgmtDec[0].houseCargoDec[0].trnshpr], [{ trnshprCd: "ONE001", trnshprBond: "BND2026" }, { trnshprCd: "ONE001", trnshprBond: "BND2026" }]);

console.log("\nsaved drafts");
const savedImport = { ...draft, event: undefined };
is("an import draft saved before exports existed still loads as an import", mergeDraft(savedImport, draftFor(src, settings, "SCE")).vesselImo, "9618587");
is("a draft saved for the other direction is dropped", mergeDraft(savedImport, draftFor(exportSrc, settings, "SCX")).event, "SCX");

console.log("\namendments (SCA)");
is("Customs' own sample amendment passes the official SCA schema", schemaErrors(read("F_SACHM22_SCA_SOMETESTUSER_6055_20200701_DEC.json"), SCA_SCHEMA), []);

// The import CSN as filed (the form above, IMO and VCN given), and the console since.
const filedImport = structuredClone(draft);
const later = structuredClone(draft);
later.containers[0].seal = "SL889999"; // the same box, corrected on the master line and the house
later.houses[0].containers[0].seal = "SL889999";
later.houses[0].consignee.street = "NO 7, SIDCO ESTATE, GUINDY";
const added = structuredClone(later.houses[0]);
added.shipmentId = "ARX-SHP-0103";
added.ref = "ALG09103-26";
added.hblNo = "GZL2609003";
later.houses = [later.houses[0], added]; // the second house taken off, a third added
const csnRef = { no: "1000126", date: "2026-09-27" };
const amend = buildAmendment(filedImport, later, settings, { jobNo: 30, date: "20260928", time: "T10:00" }, csnRef);
type SCA = { headerField: Obj; master: { decRef: Obj; mastrCnsgmtDec: Array<{ MCRef: Obj; supRef: Obj; trnsprtEqmt: Obj[]; houseCargoDec: Array<Obj & { HCRef: Obj }> }> } };
type Obj = Record<string, unknown>;
const sd = amend.doc as unknown as SCA;
is("the amendment passes CBIC's SCA schema", schemaErrors(amend.doc, SCA_SCHEMA, { unsigned: true }), []);
is("header: SCA, on the original's version", [sd.headerField.reportingEvent, sd.headerField.versionNo], ["SCA", "SCE1102"]);
is("it names the CSN it amends", [sd.master.decRef.msgTyp, sd.master.decRef.rptngEvent, sd.master.decRef.csnNmbr, sd.master.decRef.csnDt, sd.master.decRef.amendment], ["A", "SCA", 1000126, "20260927", "U"]);
const amc = sd.master.mastrCnsgmtDec[0];
is("and points back at it from the master line", amc.supRef, { cinTyp: "CSN", csnSbmtdTyp: "ANC", csnSbmtdBy: "ABDCA2229C", csnRptngTyp: "SCE", csnSiteId: "INMAA1", csnNmbr: 1000126, csnDt: "20260927", amendment: "U" });
is("the corrected seal: the container list, updated", amc.trnsprtEqmt.map((b) => [b.eqmtId, b.eqmtSealNmbr, b.amendment]), [["TGHU8261450", "SL889999", "U"]]);
is("houses: the first updated, the second deleted, the new one added", amc.houseCargoDec.map((h) => [h.HCRef.subLineNo, h.HCRef.blNo, h.HCRef.amendment]), [[1, "GZL2609001", "U"], [2, "GZL2609002", "D"], [3, "GZL2609003", "S"]]);
is("the updated house carries only what changed", Object.keys(amc.houseCargoDec[0]).sort(), ["HCRef", "trnsprtDoc", "trnsprtEqmt"]);
is("the added house carries everything, all S", Object.values(amc.houseCargoDec[2]).every((v) => (Array.isArray(v) ? v.every((x) => (x as Obj).amendment === "S") : (v as Obj).amendment === "S")), true);
is("the changes, in words", amend.changes, [
  "Master: container TGHU8261450 changed",
  "House ALG09101-26: parties and description, containers",
  "House ALG09102-26 taken off",
  "House ALG09103-26 added",
]);
is("nothing changed, nothing to file", buildAmendment(filedImport, structuredClone(filedImport), settings, { jobNo: 31, date: "20260928", time: "T10:01" }, csnRef), { doc: null, changes: [] });
is("no filed CSN to compare with is said", amendmentProblems(null, later, settings, csnRef).map((p) => p.field), ["The filed CSN"]);
is("no CSN number recorded is said", amendmentProblems(filedImport, later, settings, { no: "", date: "" }).map((p) => p.field), ["CSN number", "CSN date"]);
is("unchanged is said", amendmentProblems(filedImport, structuredClone(filedImport), settings, csnRef).map((p) => p.message), ["nothing has changed since the CSN was filed"]);
is("a real amendment has nothing in its way", amendmentProblems(filedImport, later, settings, csnRef), []);

// A second amendment, on top of the first: the form as ICEGATE now holds it.
const held = asFiled(asFiled(null, filedImport), later);
is("the form kept with the first amendment: sub-lines as filed, 2 not reused", [held.houses.map((h) => h.subLine), held.lastSubLine], [[1, 3], 3]);
const again = structuredClone(later);
again.houses[1].marks = "ALG/103 1-12";
const fourth = structuredClone(again.houses[1]);
fourth.shipmentId = "ARX-SHP-0104";
fourth.ref = "ALG09104-26";
fourth.hblNo = "GZL2609004";
again.houses.push(fourth);
const a2 = buildAmendment(held, again, settings, { jobNo: 33, date: "20260929", time: "T09:00" }, csnRef);
const s2 = (a2.doc as unknown as SCA).master.mastrCnsgmtDec[0];
is("second amendment: the house added before, updated under 3; the new one S under 4", s2.houseCargoDec.map((h) => [h.HCRef.subLineNo, h.HCRef.blNo, h.HCRef.amendment]), [[3, "GZL2609003", "U"], [4, "GZL2609004", "S"]]);
is("and it passes the SCA schema", schemaErrors(a2.doc, SCA_SCHEMA, { unsigned: true }), []);
is("a fresh CSN numbers its houses in order", asFiled(null, draft).houses.map((h) => h.subLine), [1, 2]);

const filedExport = structuredClone(ex);
const exLater = structuredClone(ex);
exLater.houses[0].pcin = "26PCEG0920173415499";
const xa = buildAmendment(filedExport, exLater, settings, { jobNo: 32, date: "20260928", time: "T10:02" }, csnRef);
const xs = xa.doc as unknown as SCA;
is("an export amendment passes the SCA schema", schemaErrors(xa.doc, SCA_SCHEMA, { unsigned: true }), []);
is("on the export's version, pointing back at an SCX", [xs.headerField.versionNo, xs.master.mastrCnsgmtDec[0].supRef.csnRptngTyp], ["SCX1102", "SCX"]);
is("a corrected PCIN is the house's previous reference, updated", [xa.changes, (xs.master.mastrCnsgmtDec[0].houseCargoDec[0].prevRef as Obj).mcinPcin, (xs.master.mastrCnsgmtDec[0].houseCargoDec[0].prevRef as Obj).amendment], [["House ALG09201-26: shipping bill PCIN"], "26PCEG0920173415499", "U"]);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
