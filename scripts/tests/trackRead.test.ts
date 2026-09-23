import {
  aisEta,
  aisTime,
  callsignFor,
  isHapagLloyd,
  parseFlight,
  readAeroDataBox,
  readAis,
  readDcsa,
  readAdsb,
  samePlace,
  withinDays,
  type Booking,
} from "../../supabase-v2/functions/track-shipment/read";

/**
 * Reading what the trackers say.
 *
 * The answers below are shaped like the real ones — AeroDataBox's flight
 * status, adsb.lol's aircraft list, a carrier's DCSA events, aisstream's
 * messages. What matters: our flight on our day and nobody else's, container
 * evidence ticks and flight evidence asks, and a transhipment is not an
 * arrival.
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

const air: Booking = {
  transport_mode: "air",
  flight_number: "EK 543",
  carrier: "Emirates",
  etd: "2026-10-02",
  eta: "2026-10-02",
  port_of_loading: "Chennai (MAA)",
  port_of_discharge: "Dubai (DXB)",
  origin: "Chennai",
  destination: "Frankfurt",
  vessel: null,
  container_number: null,
};

console.log("\nflight numbers as people write them");
is("with a space", parseFlight("EK 543"), { airline: "EK", number: "543", icao: false });
is("leading zero dropped", parseFlight("ek0543"), { airline: "EK", number: "543", icao: false });
is("a digit in the airline", parseFlight("6E-1234"), { airline: "6E", number: "1234", icao: false });
is("an ICAO callsign", parseFlight("UAE543"), { airline: "UAE", number: "543", icao: true });
is("not a flight", parseFlight("tbc"), null);
is("the callsign it broadcasts", callsignFor(parseFlight("EK 543")!), "UAE543");
is("an airline we do not know", callsignFor(parseFlight("ZZ 1")!), null);

console.log("\nAeroDataBox: our flight, our day");
const leg = (dep: string, status: string, extra: Record<string, unknown> = {}) => ({
  number: "EK 543",
  status,
  callSign: "UAE543",
  isCargo: false,
  departure: {
    airport: { iata: dep, municipalityName: dep === "MAA" ? "Chennai" : "Dubai" },
    scheduledTime: { utc: "2026-10-02 04:05Z", local: "2026-10-02 09:35+05:30" },
    revisedTime: { utc: "2026-10-02 04:20Z" },
    runwayTime: status === "Expected" ? undefined : { utc: "2026-10-02 04:31Z" },
  },
  arrival: {
    airport: { iata: "DXB", municipalityName: "Dubai" },
    scheduledTime: { utc: "2026-10-02 08:15Z", local: "2026-10-02 12:15+04:00" },
    predictedTime: { utc: "2026-10-02 08:22Z" },
    runwayTime: status === "Arrived" ? { utc: "2026-10-02 08:19Z" } : undefined,
  },
  ...extra,
});
const enroute = readAeroDataBox([leg("MAA", "EnRoute")], air);
is("in the air", enroute.message, "EK 543 is in the air.");
is("take-off from the runway time", enroute.summary.dep_actual, "2026-10-02T04:31:00.000Z");
is("the expected landing", enroute.summary.arr_expected, "2026-10-02T08:22:00.000Z");
is("the arrival day is the destination's", enroute.summary.eta_local, "2026-10-02");
is("offers departed, does not tick it", enroute.events.map((e) => [e.kind, e.auto, e.status]), [["departed", false, "new"]]);
is("keyed to the day", enroute.events[0].external_id, "adb:departed:EK543:2026-10-02");

const landed = readAeroDataBox([leg("MAA", "Arrived")], air);
is("landed offers both", landed.events.map((e) => e.kind), ["departed", "arrived"]);
is("landing time", landed.events[1].occurred_at, "2026-10-02T08:19:00.000Z");

const onward = { ...air, port_of_discharge: "Frankfurt (FRA)", destination: "Frankfurt" };
const connection = readAeroDataBox([leg("MAA", "Arrived")], onward);
is("a connection's landing is transit, not arrival", connection.events.map((e) => [e.kind, e.status]), [["departed", "new"], ["in_transit", "info"]]);
is("and its time is not our ETA", connection.summary.eta_local, null);

const expected = readAeroDataBox([leg("MAA", "Expected")], air);
is("not yet flown: nothing to offer", expected.events.length, 0);

const twoLegs = readAeroDataBox([leg("DXB", "Expected"), leg("MAA", "Departed")], air);
is("the leg that leaves our airport", twoLegs.summary.from, "Chennai MAA");
is("nothing found", readAeroDataBox([], air).state, "not_found");
is("cancelled asks", readAeroDataBox([leg("MAA", "Canceled")], air).events.map((e) => e.kind), ["cancelled"]);

console.log("\nadsb.lol: a sighting");
const sky = {
  ac: [{ hex: "896180", flight: "UAE543  ", lat: 25.2, lon: 55.1, alt_baro: 36000, gs: 486, track: 290, seen_pos: 2, r: "A6-EGA", t: "B77W" }],
  now: Date.parse("2026-10-02T06:00:02Z"),
};
const inAir = readAdsb(sky, "UAE543", false, air, new Date("2026-10-02T06:00:00Z"));
is("found by callsign", [inAir.summary.lat, inAir.summary.lon, inAir.summary.speed_kmh, inAir.summary.altitude_m], [25.2, 55.1, 900, 10973]);
is("when it was heard", inAir.summary.position_at, "2026-10-02T06:00:00.000Z");
is("offered as a sighting", inAir.events.map((e) => [e.kind, e.auto]), [["departed", false]]);
const nextWeek = readAdsb(sky, "UAE543", false, air, new Date("2026-10-09T06:00:00Z"));
is("another day's flight offers nothing", nextWeek.events.length, 0);
is("and says so", nextWeek.message.includes("another day's flight"), true);
const parked = readAdsb({ ac: [{ ...sky.ac[0], alt_baro: "ground" }], now: sky.now }, "UAE543", false, air, new Date("2026-10-02T06:00:00Z"));
is("on the ground is not a departure", [parked.message, parked.events.length], ["UAE543 is on the ground.", 0]);
is("not flying", readAdsb({ ac: [] }, "UAE543", false, air, new Date()).state, "not_found");
is("a guessed callsign says it may be the wrong one", readAdsb({ ac: [] }, "AIC302", true, air, new Date()).message.includes("another callsign"), true);

console.log("\nwindows");
is("the booked day", withinDays(new Date("2026-10-02T23:00:00Z"), "2026-10-02", 0, 0), true);
is("the day after, outside", withinDays(new Date("2026-10-03T01:00:00Z"), "2026-10-02", 0, 0), false);

console.log("\nplaces");
is("by name", samePlace(["Jebel Ali / Dubai, UAE"], "Jebel Ali", "AEJEA"), true);
is("by UN/LOCODE", samePlace(["Jebel Ali (AEJEA)"], null, "AEJEA"), true);
is("Port Klang is not Port Said", samePlace(["Port Said"], "Port Klang", "MYPKG"), false);
is("another port", samePlace(["Jebel Ali"], "Colombo", "LKCMB"), false);

console.log("\na carrier's container events");
const sea: Booking = {
  ...air,
  transport_mode: "sea_fcl",
  flight_number: null,
  carrier: "Hapag-Lloyd",
  port_of_loading: "Chennai",
  port_of_discharge: "Jebel Ali",
  destination: "Dubai",
  vessel: "MSC AURORA",
  container_number: "HLXU1234567",
};
const call = (code: string, name: string, vessel = "MSC AURORA") => ({
  UNLocationCode: code,
  location: { locationName: name, UNLocationCode: code },
  modeOfTransport: "VESSEL",
  exportVoyageNumber: "FA412E",
  vessel: { vesselName: vessel, vesselIMONumber: "9700000" },
});
const ev = (id: string, type: string, code: string, at: string, place: [string, string], cls = "ACT", extra = {}) => ({
  eventID: id,
  eventType: type,
  eventClassifierCode: cls,
  eventDateTime: at,
  ...(type === "EQUIPMENT" ? { equipmentEventTypeCode: code, emptyIndicatorCode: "LADEN" } : { transportEventTypeCode: code }),
  eventLocation: { locationName: place[1], UNLocationCode: place[0] },
  transportCall: call(place[0], place[1]),
  ...extra,
});
const MAA: [string, string] = ["INMAA", "Chennai"];
const CMB: [string, string] = ["LKCMB", "Colombo"];
const JEA: [string, string] = ["AEJEA", "Jebel Ali"];
const events = [
  ev("1", "EQUIPMENT", "GTIN", "2026-09-30T10:00:00+05:30", MAA),
  ev("2", "EQUIPMENT", "LOAD", "2026-10-01T22:00:00+05:30", MAA),
  ev("3", "TRANSPORT", "DEPA", "2026-10-02T06:00:00+05:30", MAA),
  ev("4", "EQUIPMENT", "DISC", "2026-10-04T08:00:00+05:30", CMB),
  ev("5", "TRANSPORT", "DEPA", "2026-10-06T08:00:00+05:30", CMB),
  ev("6", "TRANSPORT", "ARRI", "2026-10-15T09:00:00+04:00", JEA, "EST"),
  ev("7", "TRANSPORT", "ARRI", "2026-10-16T09:00:00+04:00", JEA, "EST"),
];
const hl = readDcsa(events, sea);
is(
  "what each event becomes",
  hl.events.map((e) => [e.kind, e.auto, e.status]),
  [
    ["gate_in", true, "new"],
    ["loaded", false, "info"],
    ["departed", true, "new"],
    ["in_transit", false, "info"],
    ["in_transit", false, "info"],
  ]
);
is("the first departure is the sailing", hl.events[2].detail, "Sailed from Chennai on MSC AURORA FA412E");
is("a discharge elsewhere is a transhipment", hl.events[3].detail, "Discharged at Colombo (transhipment)");
is("estimates tick nothing but give the ETA", hl.summary.carrier_eta, "2026-10-16T05:00:00.000Z");
is("in the port's own day", hl.summary.eta_local, "2026-10-16");
is("the last thing that happened", hl.summary.last_event, "vessel departed at Colombo");

const home = readDcsa([...events, ev("8", "EQUIPMENT", "DISC", "2026-10-16T14:00:00+04:00", JEA), ev("9", "TRANSPORT", "ARRI", "2026-10-16T08:00:00+04:00", JEA)], sea);
const at = home.events.filter((e) => e.kind === "arrived" || e.kind === "discharged");
is("arrival at our port ticks once", at.map((e) => [e.kind, e.auto]), [["arrived", true], ["discharged", false]]);
is("an empty answer", readDcsa([], sea).state, "not_found");
is("not a list", readDcsa({ message: "Unauthorized" }, sea).state, "error");

console.log("\nwhose container");
is("by carrier", isHapagLloyd("Hapag-Lloyd AG", "MSCU1234567"), true);
is("by prefix when the carrier is blank", isHapagLloyd(null, "HLXU 123456 7"), true);
is("another line", isHapagLloyd("MSC", "MSCU1234567"), false);

console.log("\nAIS");
is("aisstream's time", aisTime("2026-09-23 10:15:02.318353 +0000 UTC"), "2026-09-23T10:15:02.000Z");
const now = new Date("2026-12-20T00:00:00Z");
is("an ETA with no year, next January", aisEta({ Month: 1, Day: 5, Hour: 6, Minute: 0 }, now), "2027-01-05T06:00:00.000Z");
is("an ETA just past stays this year", aisEta({ Month: 12, Day: 10, Hour: 24, Minute: 60 }, now), "2026-12-10T00:00:00.000Z");
is("no ETA set", aisEta({ Month: 0, Day: 0 }, now), null);
const ais = [
  { MessageType: "PositionReport", MetaData: { MMSI: 636000001, ShipName: "MSC ANNA   ", time_utc: "2026-10-03 04:00:00.1 +0000 UTC" }, Message: { PositionReport: { Latitude: 7.1, Longitude: 79.5, Sog: 14.2, Cog: 250, TrueHeading: 511, NavigationalStatus: 0 } } },
  { MessageType: "ShipStaticData", MetaData: { MMSI: 636000001 }, Message: { ShipStaticData: { Name: "MSC ANNA", Destination: "AEJEA", ImoNumber: 9700001, Eta: { Month: 10, Day: 15, Hour: 5, Minute: 0 } } } },
  { MessageType: "PositionReport", MetaData: { MMSI: 999 }, Message: { PositionReport: { Latitude: 0, Longitude: 0 } } },
];
const ship = readAis(ais, "636000001", sea, new Date("2026-10-03T05:00:00Z"), 20);
is("where and how fast", [ship.summary.lat, ship.summary.lon, ship.summary.speed_kn, ship.summary.heading], [7.1, 79.5, 14.2, null]);
is("what the crew says", [ship.summary.destination, ship.summary.ais_eta], ["AEJEA", "2026-10-15T05:00:00.000Z"]);
is("a different ship from the booking is flagged", ship.summary.name_mismatch, "This MMSI is MSC ANNA; the booking says MSC AURORA.");
is("a ship ticks nothing", ship.events.length, 0);
is("silence", readAis([], "636000001", sea, new Date(), 20).state, "not_found");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
