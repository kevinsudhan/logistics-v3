import {
  movementOrderHtml,
  movementOrderSubject,
  shipmentUpdateHtml,
  shipmentUpdateSubject,
  when,
} from "../../src/lib/shipmentUpdateMail";

/**
 * The update a party is sent from the shipment's Party tab.
 *
 * It goes to people outside the company, so the two things that matter are
 * that it never prints a line the booking does not hold, and that the
 * reference survives in the subject so the reply finds the job.
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

const base = {
  ref: "ALG09004-26",
  shipmentId: "ARX-SHP-0004",
  partyName: "Hofmann Energietechnik",
  mode: "air",
  stage: "Departed",
  origin: "Chennai",
  destination: "Frankfurt",
  carrier: "Emirates SkyCargo",
  flightNumber: "EK 543",
  vessel: null,
  voyage: null,
  etd: "2026-10-02",
  etdTime: "14:30:00",
  eta: "2026-10-03",
  etaTime: null,
  portOfLoading: "Chennai (MAA)",
  portOfDischarge: "Frankfurt (FRA)",
  houseBill: "ALG/HAWB/0012",
  pieces: 14,
  grossKg: 496,
  volumeCbm: 3.168,
  latest: { label: "HAWB confirmation", at: "2026-10-01T09:00:00Z" },
  next: "Loading follow-up",
};

console.log("\nsubject");
is("the reference in brackets, then the route", shipmentUpdateSubject(base), "[ALG09004-26] Shipment update — Chennai to Frankfurt");
is("no route, no dash", shipmentUpdateSubject({ ...base, origin: null, destination: null }), "[ALG09004-26] Shipment update");

console.log("\ndates");
is("a date reads as a date", when("2026-10-02"), "2 Oct 2026");
is("with a time", when("2026-10-02", "14:30:00"), "2 Oct 2026, 14:30");
is("nothing is nothing", when(null), null);

console.log("\nbody");
const html = shipmentUpdateHtml(base);
is("addressed by name", html.includes("Dear Hofmann Energietechnik,"), true);
is("air says flight, not vessel", html.includes(">Flight<") && !html.includes(">Vessel<"), true);
is("the latest step and when", html.includes("HAWB confirmation — 1 Oct 2026"), true);
is("the house bill named for the mode", html.includes(">HAWB<"), true);
is("cargo summarised", html.includes("14 pcs · 496 kg · 3.168 CBM"), true);

const sea = shipmentUpdateHtml({ ...base, mode: "sea_lcl", flightNumber: null, vessel: "MSC AURORA", voyage: "FA412E", houseBill: null, latest: null, next: null });
is("sea says vessel and voyage", sea.includes("MSC AURORA / FA412E"), true);
is("a field not held is not a line", !sea.includes("House B/L") && !sea.includes(">Latest<"), true);

const bare = shipmentUpdateHtml({ ...base, partyName: null, carrier: null });
is("no name, a proper greeting", bare.includes("Dear Sir or Madam,"), true);
is("no carrier line when there is no carrier", !bare.includes("Airline"), true);
is("markup in a name cannot break the mail", shipmentUpdateHtml({ ...base, partyName: "<b>x</b>" }).includes("&lt;b&gt;x&lt;/b&gt;"), true);

console.log("\npickup and delivery requests");
const order = {
  kind: "pickup" as const, ref: "ALG09004-26", shipmentId: "ARX-SHP-0004", partyName: "Sai Transports",
  address: "Plot 14, SIPCOT, Sriperumbudur", date: "2026-10-01", time: "10:00:00", contactName: "Meera", contactPhone: "+91 90000 11111",
  cargo: "Battery packs", pieces: 14, grossKg: 496, volumeCbm: 3.168, hazardous: true, unNumber: "UN3481", notes: null,
};
is("subject names the request and the day", movementOrderSubject(order), "[ALG09004-26] Pickup request — 1 Oct 2026");
const oh = movementOrderHtml(order);
is("collect from the address", oh.includes("Collect from") && oh.includes("Sriperumbudur"), true);
is("dangerous goods said plainly", oh.includes("Yes — UN 3481"), true);
is("no instructions line when there are none", !oh.includes("Instructions"), true);
const dh = movementOrderHtml({ ...order, kind: "delivery", hazardous: false, address: "Hanauer Landstrasse 291" });
is("a delivery says deliver to", dh.includes("Deliver to") && !dh.includes("Dangerous goods"), true);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
