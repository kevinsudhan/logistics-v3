import { readFileSync } from "node:fs";
import { asFiled, type CsnDraft } from "../../src/lib/icegateCsn";
import { readCsnReply, whereInForm } from "../../src/lib/icegateReply";

/**
 * ICEGATE's reply to a CSN file: Customs' own ACK and SFL samples read, the
 * CRM's own and Customs' declarations refused, and errors placed in the form.
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
const text = (f: string) => readFileSync(`docs/icegate-csn/samples/${f}`, "utf8");
const reply = (f: string) => readCsnReply(text(f), f);
const throws = (label: string, fn: () => unknown, want: RegExp) => {
  try {
    fn();
    is(label, "no error", want.source);
  } catch (e) {
    is(label, want.test((e as Error).message), true);
  }
};

console.log("a positive ACK (Customs' SCE sample)");
const ok = reply("F_SACHM22_SCE_SOMESENDER_2_190820201705_ACK.json");
is("an ACK, accepted, nothing wrong", [ok.kind, ok.accepted, ok.errors], ["ACK", true, []]);
is("the file it answers: event, sender, job, test or live", [ok.event, ok.sender, ok.jobNo, ok.indicator], ["SCE", "SOMESENDER", 2, "T"]);
is("the CSN number and date", [ok.csnNo, ok.csnDate], ["1000007", "2020-08-19"]);
is("the master line's CIN", ok.masterCin, { type: "PCIN", no: "20PC100819172764500" });

console.log("\na positive ACK to an amendment (Customs' SCA sample)");
const amend = reply("F_SACHM22_SCA_SOMETESTUSER_6055_20200701_ACK.json");
is("accepted, an SCA, job 6055", [amend.accepted, amend.event, amend.jobNo], [true, "SCA", 6055]);
is("the house added got its PCIN, by sub-line (placeholders for the others)", amend.houseCins, [{ subLine: 3, type: "PCIN", no: "20PC100722100039300" }]);
is("a CIN type with no number is not a CIN", amend.masterCin, null);

console.log("\na negative ACK (Customs' SCD sample, the other shape)");
const bad = reply("F_SACHM22_SCD_SOMEUSER_1_190820201640_ACK.json");
is("rejected", [bad.kind, bad.accepted, bad.jobNo], ["ACK", false, 1]);
is(
  "each error, on its object, successes left out",
  bad.errors.map((e) => [e.code, e.object, e.message]),
  [
    ["014", "Vessel", "Invalid Mode of Transport"],
    ["015", "Vessel", "Invalid Transport Means"],
    ["016", "Vessel", "Invalid Transport Means Identity"],
    ["020", "Voyage", "Invalid Voyage Call Number-VCN"],
  ]
);
is("no CSN number on a rejection", bad.csnNo, "");

console.log("\nstructure failures (Customs' SFL samples)");
const sfl = reply("F_SACHM22_SCE_ICEGATEID_103_20200122_SFL.json");
is("an SFL, failed, its job", [sfl.kind, sfl.accepted, sfl.jobNo, sfl.status], ["SFL", false, 103, "Schema validation failure"]);
is("the failure in words, on the header", [sfl.errors[0].object, sfl.errors[0].field, sfl.errors[0].message.split(":")[0]], ["File header", "reportingEvent", "reportingEvent is empty or too short"]);
const item = reply("F_SACHM22_SCE_ICEGATEID_12_20191024_SFL.json").errors[0];
is("a failure inside a house: its place in the file, the item", [item.house, item.entry, item.seq, item.object], [true, 1, { kind: "item", n: 2 }, "Cargo item"]);
for (const f of ["7_20191028", "8_20191030", "9_20191021", "10_20191022", "11_20191023"]) {
  const r = reply(`F_SACHM22_SCE_ICEGATEID_${f}_SFL.json`);
  is(`SFL ${f}: read, one failure`, [r.kind, r.errors.length > 0], ["SFL", true]);
}

console.log("\nnot a reply");
throws("the CRM's kind of file, a declaration, is refused", () => reply("F_SACHM22_SCE_SOMESENDER_2_190820201705_DEC.json"), /CSN file itself/);
throws("an amendment declaration too, though it names a CSN", () => reply("F_SACHM22_SCA_SOMETESTUSER_6055_20200701_DEC.json"), /CSN file itself/);
throws("an export declaration too", () => reply("F_SACHM22_SCX_TESTUSER_2_10092020_DEC.json"), /CSN file itself/);
throws("not JSON", () => readCsnReply("<html>", "x.json"), /not JSON/);
throws("JSON without a header", () => readCsnReply("{}", "x.json"), /no header/);

console.log("\nerrors placed in the form");
// A rejection of a house and its container, codes without descriptions (the guide's list gives them).
const filed = asFiled(null, {
  version: 1,
  indicator: "P",
  containers: [{ no: "TGHU8261450" }],
  houses: [
    { shipmentId: "ARX-SHP-0101", ref: "ALG09101-26", hblNo: "GZL2609001", containers: [{ no: "TGHU8261450" }] },
    { shipmentId: "ARX-SHP-0102", ref: "ALG09102-26", hblNo: "GZL2609002", containers: [{ no: "TGHU8261450" }] },
  ],
} as unknown as CsnDraft);
const neg = readCsnReply(
  JSON.stringify({
    headerField: { senderID: "ALGCHN01", receiverID: "INMAA1", versionNo: "SCE1102", indicator: "P", messageID: "SACHM22", sequenceOrControlNumber: "14", date: "20260928", time: "T11:02", reportingEvent: "SCE" },
    master: {
      decRef: { msgTyp: "F", prtofRptng: "INMAA1", jobNo: "14", jobDt: "20260928", rptngEvent: "SCE", decRefErrorCode: [{ pathName: "/master/decRef", errorCode: "000", errorMessage: "Successful" }] },
      mastrCnsgnmtDec: [
        {
          MCRef: { lineNo: "1", MCRefErrorCode: [{ pathName: "/master/mastrCnsgmtDec/MCRef", errorCode: "000", errorMessage: "Successfull" }] },
          trnsprteqmt: [{ eqmtSeqNo: "1", trnsprtEqpmtErrorCode: [{ pathName: "/master/mastrCnsgmtDec/trnsprtEqmt", errorCode: "084" }] }],
          hcargoDec: [
            {},
            {
              HCRef: { subLineNo: "2", HCRefErrorCode: [{ pathName: "/master/mastrCnsgmtDec/houseCargoDec/HCRef", errorCode: "123", errorMessage: "" }] },
              trnsprteqmt: [{ eqmtSeqNo: "1", trnsprtEqpmtErrorCode: [{ pathName: "/master/mastrCnsgmtDec/houseCargoDec/trnsprtEqmt", errorCode: "105" }] }],
              trnsprtDocErrorCode: [{ pathName: "/master/mastrCnsgmtDec/houseCargoDec/trnsprtDoc", errorCode: "137", errorMessage: "Consignee PostCode is Null" }],
            },
          ],
        },
      ],
    },
  }),
  "F_SACHM22_SCE_ALGCHN01_14_20260928_ACK.json"
);
is("rejected, job 14, three problems on the house and one on the master's box", [neg.accepted, neg.jobNo, neg.errors.length], [false, 14, 4]);
is(
  "each where the desk would look, the guide's text where the reply gave none",
  neg.errors.map((e) => `${whereInForm(e, filed, "SCE")}: ${e.message} (${e.code})`),
  [
    "Master line · container TGHU8261450: Invalid Seal Number (084)",
    "House GZL2609002 (ALG09102-26) · House B/L: HC-HBL Details Already Exists (123)",
    "House GZL2609002 (ALG09102-26) · container TGHU8261450: HC Transport Equipment Not Declared in MC Equipment Details (105)",
    "House GZL2609002 (ALG09102-26) · Parties and description: Consignee PostCode is Null (137)",
  ]
);
is("without the form kept, by sub-line", whereInForm(neg.errors[1], null, "SCE"), "House sub-line 2 · House B/L");
is("an SFL house entry, named from the form on a fresh CSN", whereInForm(item, filed, "SCE"), "House GZL2609001 (ALG09101-26) · cargo item 2");
is("but not on an amendment, whose houses are only those changed", whereInForm(item, filed, "SCA"), "House entry 1 in the file · cargo item 2");
is("the job number from the file name when the reply has none", readCsnReply(JSON.stringify({ headerField: {}, errorDetails: { status: "x", errorMessage: [] } }), "F_SACHM22_SCE_ALGCHN01_31_20260928_SFL.json").jobNo, 31);

console.log("\nICEGATE's replies since ICES 1.5 (a real one's layout, numbers changed)");
const ok00 = [{ errorCode: "00", errorMessage: "Successful" }];
const house = (sub: number, pcin: string) => ({
  HCRef: { subLineNo: String(sub), blNo: `HBL00${sub}`, blDt: "20260916", Amend_det: "null" },
  prevRef: { Amend_det: "null" },
  locCstm: { Amend_det: "null" },
  trnshpr: {},
  itemDtls: [{ crgoItemSeqNmbr: "1", Amend_det: "null" }],
  trnsprtEqmt: [{ eqmtSeqNo: "1", Amend_det: "null" }],
  itnry: [{ prtOfCallSeqNmbr: "1", Amend_det: "null" }, { prtOfCallSeqNmbr: "2", Amend_det: "null" }],
  hcResponse: { cinTyp: "PCIN", mcinPcin: pcin },
});
const ices = {
  headerField: {
    senderID: "ALGCHN01", receiverID: "INKAT1", versionNo: "ICES1_5", indicator: "P", messageID: "SACHM22", sequenceOrControlNumber: "306",
    date: "20261013", time: "T10:31", reportingEvent: "SCE", uniqueId: "13915024211013102026SACHM22", accpStatus: "Accepted",
  },
  master: {
    decRef: { jobNo: "306", csnDt: "20261013", csnNmbr: "1508881", errorCode: ok00, Amend_det: "null" },
    authPrsn: { errorCode: ok00, Amend_det: "null" },
    vesselDtls: { errorCode: ok00, Amend_det: "null" },
    voyageDtls: { errorCode: ok00, Amend_det: "null" },
    mastrCnsgmtDec: [
      {
        MCRef: { lineNo: "1", mstrBlNo: "MBL0001", mstrBlDt: "20260916", Amend_det: "null" },
        houseCargoDec: [house(1, "26PCSE00101339774340"), house(2, "26PCSE00101339774341")],
        mcResponse: { cinTyp: "null", mcinPcin: "null" },
      },
    ],
  },
};
const r15 = readCsnReply(JSON.stringify(ices, null, 2), "F_SACHM22_SCE_ALGCHN01_306_20261013_ACK.json");
is("an accepted reply: the CSN number from csnNmbr, its date from csnDt", [r15.kind, r15.accepted, r15.csnNo, r15.csnDate, r15.jobNo], ["ACK", true, "1508881", "2026-10-13", 306]);
is("each house's PCIN by its sub-line", r15.houseCins, [{ subLine: 1, type: "PCIN", no: "26PCSE00101339774340" }, { subLine: 2, type: "PCIN", no: "26PCSE00101339774341" }]);
is('"null" for the master line is no CIN, not a CIN called NULL', r15.masterCin, null);
is('"00 Successful" against every object is no error', r15.errors, []);
const rejected = structuredClone(ices);
rejected.headerField.accpStatus = "Rejected";
rejected.master.decRef.csnNmbr = "null";
const r16 = readCsnReply(JSON.stringify(rejected), "x.json");
is("a rejection says so, with no CSN", [r16.accepted, r16.csnNo, r16.errors.length > 0], [false, "", true]);
const coded = structuredClone(rejected);
(coded.master.vesselDtls as { errorCode: Array<{ errorCode: string; errorMessage: string }> }).errorCode = [{ errorCode: "39", errorMessage: "Invalid Vessel Code" }];
is("and its codes, where it gives them", readCsnReply(JSON.stringify(coded), "x.json").errors.map((e) => [e.code, e.object]), [["39", "Vessel"]]);
const amendDec = { headerField: { reportingEvent: "SCA", versionNo: "SCE1102" }, master: { decRef: { msgTyp: "A", csnNmbr: 1508881, csnDt: "20261013" } } };
throws("an amendment declaration, which names a CSN too, is still not a reply", () => readCsnReply(JSON.stringify(amendDec), "x.json"), /CSN file itself/);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
if (fail) process.exit(1);
