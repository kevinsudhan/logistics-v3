import { releaseMailHtml, releaseMailSubject, releaseSteps, releaseSummary, type OurRelease, type ReleaseMailInput } from "../../src/lib/hblRelease";

/**
 * Releasing our own house B/L (089): the steps by release mode, where it
 * stands, and the release message to our agent.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const issued: OurRelease = {
  status: "issued",
  release_mode: "original",
  originals: 3,
  issued_at: "2026-09-25T06:00:00Z",
  charges_received_on: null,
  originals_released_on: null,
  originals_released_to: "",
  originals_returned: 0,
  originals_returned_on: null,
  release_sent_on: null,
  release_sent_to: "",
  released_on: null,
};

console.log("\noriginal B/Ls");
is("charges, the originals out, released", releaseSteps(issued).steps.map((s) => s.key), ["charges_received_on", "originals_released_on", "released_on"]);
is("the originals, counted", releaseSteps(issued).steps[1].label, "THREE (3) originals handed over");
is("next: the charges", releaseSteps(issued).next?.key, "charges_received_on");
const out = { ...issued, charges_received_on: "2026-09-26", originals_released_on: "2026-09-26", originals_released_to: "RAVI, KAVITHA TEXTILES" };
is("who took them", releaseSteps(out).steps[1].detail, "to RAVI, KAVITHA TEXTILES");
is("waiting at destination", releaseSummary(out), "Originals with RAVI, KAVITHA TEXTILES; waiting for one to be surrendered at destination.");
is("done when released", releaseSteps({ ...out, released_on: "2026-10-09" }).complete, true);
is("says so", releaseSummary({ ...out, released_on: "2026-10-09" }), "Released at destination.");

console.log("\ntelex release");
const telex = { ...issued, release_mode: "telex" as const };
is("the full set back, then the telex", releaseSteps(telex).steps.map((s) => s.key), ["charges_received_on", "originals_released_on", "originals_returned_on", "release_sent_on", "released_on"]);
is("handing over is optional", releaseSteps(telex).steps[1].optional, true);
is("two of three is not the full set", releaseSteps({ ...telex, originals_returned: 2 }).steps[2].done, false);
is("counted", releaseSteps({ ...telex, originals_returned: 2 }).steps[2].detail, "2 of 3 back");
is("and said", releaseSummary({ ...telex, charges_received_on: "2026-09-26", originals_returned: 2 }), "2 of 3 originals back; waiting for the rest before the telex release.");
is("three of three is", releaseSteps({ ...telex, originals_returned: 3 }).steps[2].done, true);
is("next skips the optional step", releaseSteps({ ...telex, charges_received_on: "2026-09-26" }).next?.key, "originals_returned_on");

console.log("\nexpress release");
const express = { ...issued, release_mode: "express" as const, originals: 0 };
is("no originals anywhere", releaseSteps(express).steps.map((s) => s.key), ["charges_received_on", "release_sent_on", "released_on"]);

console.log("\nbefore it is issued");
is("nothing is next on a draft", releaseSteps({ ...issued, status: "draft" }).next, null);
is("and it says why", releaseSummary({ ...issued, status: "draft" }), "Issue the B/L to start its release.");

console.log("\nthe release message");
const mail: ReleaseMailInput = {
  ref: "ALG09011-26",
  mode: "telex",
  hblNo: "HBL/26-27/0007",
  mblNo: "MEDUCH123456",
  agentName: "GFP Logistics",
  shipper: "KAVITHA TEXTILES",
  consignee: "GULF LINEN LLC",
  vessel: "MSC ALINA",
  voyage: "FE612W",
  portOfLoading: "CHENNAI",
  portOfDischarge: "JEBEL ALI",
  containers: ["MSCU1234567"],
  packages: "120 CARTONS",
  grossKg: "2400",
  originals: 3,
  place: "Chennai",
  freightTerms: "collect",
};
is("the subject carries the reference and both bills", releaseMailSubject(mail), "[ALG09011-26] TELEX RELEASE — HBL HBL/26-27/0007 / MBL MEDUCH123456");
is("an express subject says waybill", releaseMailSubject({ ...mail, mode: "express", mblNo: null }), "[ALG09011-26] RELEASE — SEA WAYBILL — HBL HBL/26-27/0007");
const html = releaseMailHtml(mail);
is("the authority: the full set with us", html.includes("The full set of THREE (3) originals has been surrendered to us at Chennai."), true);
is("without an original", html.includes("without surrender of an original B/L"), true);
is("freight collect is said", html.includes("Freight is collect"), true);
is("a waybill has no originals to speak of", releaseMailHtml({ ...mail, mode: "express" }).includes("No original bills of lading were issued"), true);
is("escaped", releaseMailHtml({ ...mail, consignee: "A & B <LLC>" }).includes("A &amp; B &lt;LLC&gt;"), true);
is("a blank row is left out", releaseMailHtml({ ...mail, mblNo: null }).includes("Master B/L"), false);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
