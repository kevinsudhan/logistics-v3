import { trackingMailHtml, trackingMailSubject, type TrackingMailInput } from "../../src/lib/trackingLinkMail";

/**
 * The mail that gives a customer their tracking link.
 *
 * What matters: the link is there twice (button and plain text) and exactly
 * as issued, the reference is in the subject, nothing the booking does not
 * hold is printed as a blank, and nothing a customer typed can break the HTML.
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

const base: TrackingMailInput = {
  ref: "ALG09004-26",
  shipmentId: "ARX-SHP-0004",
  url: "https://logisticsdemosif.netlify.app/t/abc123",
  customerName: "Meera",
  mode: "air",
  stage: "departed",
  origin: "Chennai",
  destination: "Frankfurt",
  carrier: "Emirates",
  flightNumber: "EK 543",
  vessel: null,
  voyage: null,
  etd: "2026-10-02",
  etdTime: "09:35",
  eta: "2026-10-03",
  etaTime: null,
  houseBill: null,
};

console.log("\nthe subject");
is("reference in brackets, then the route", trackingMailSubject(base), "[ALG09004-26] Track your shipment — Chennai to Frankfurt");
is("no route, no dash", trackingMailSubject({ ref: "ALG1", origin: null, destination: null }), "[ALG1] Track your shipment");

console.log("\nthe body");
const html = trackingMailHtml(base);
is("the link twice: button and plain text", html.split(base.url).length - 1, 3);
is("the button says what it does", html.includes(">Track this shipment</a>"), true);
is("a flight, not a vessel", [html.includes("EK 543"), html.includes("Vessel")], [true, false]);
is("date and time together", html.includes("2 Oct 2026, 09:35"), true);
is("a field the booking lacks is not a line", html.includes("HAWB"), false);
is("greets by name", html.startsWith("<p>Dear Meera,</p>"), true);
is("the status reads as a word", html.includes(">Departed<"), true);

const sea = trackingMailHtml({ ...base, mode: "sea_fcl", vessel: "MSC AURORA", voyage: "FA412E", houseBill: "ALG/BL/1" });
is("a vessel and its voyage", sea.includes("MSC AURORA / FA412E"), true);
is("house B/L by its sea name", sea.includes("House B/L"), true);

console.log("\nnothing typed can break it");
const nasty = trackingMailHtml({ ...base, customerName: `<script>x</script>`, url: `https://x/t/a"onmouseover="y` });
is("names are escaped", nasty.includes("<script>"), false);
is("the link cannot close its attribute", nasty.includes(`"onmouseover="`), false);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
