import { agentAndRate, categoryOf, hintOf, inPeriod, periodText, presetRange, portOf, REGISTER_COLUMNS, registerRow, registerSheet, registerStatus, registerWorkbook, termOf, type RegisterInput } from "../../src/lib/enquiryRegister";
import { buildWorkbook, reportRowHeight } from "../../src/lib/xlsx";

/**
 * The enquiry register: the desk's own spreadsheet, filled from the CRM.
 *
 * What matters is that each column says what the desk meant by it — the far
 * port, the agent and the rate side by side — and that the file it makes is
 * laid out as a report and still opens.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const base: RegisterInput = {
  enquiry: {
    ref: "ALG09003-26",
    received_at: "2026-09-08T20:10:00Z",
    opened_at: "2026-09-09T04:00:00Z",
    status: "new",
    transport_mode: "sea_lcl",
    trade_direction: "import",
    origin: "Qingdao",
    destination: "Chennai",
    incoterm: "fob",
    cargo_cutoff: null,
    transit_days: null,
    notes: "As per agent side refund & local CFS side refund",
  },
  customer: { name: "Sharmi", company: "Aakarsh Air & Sea" },
  agentQuotes: [],
  routedAgent: null,
  cfsInr: null,
  shipment: null,
  stageText: null,
  nextStep: null,
  consoleNo: null,
  coloader: null,
  hawbNo: null,
};

console.log("\nthe columns");
is("21, as the desk kept them", REGISTER_COLUMNS.length, 21);
const row = registerRow(3, base);
is("one cell per column", row.length, 21);
is("the serial number", row[0], 3);
const day = row[1] as Date;
is("received late on the 8th UTC is the 9th in India", [day.getFullYear(), day.getMonth() + 1, day.getDate()], [2026, 9, 9]);
is("the customer is the company", row[2], "AAKARSH AIR & SEA");
is("the person is the contact", row[11], "SHARMI");
is("no company: the name is the customer, no person", [registerRow(1, { ...base, customer: { name: "AAS Int", company: "" } })[2], registerRow(1, { ...base, customer: { name: "AAS Int", company: "" } })[11]], ["AAS INT", ""]);
is("the notes are the hints", row[20], "As per agent side refund & local CFS side refund");
const mail = ["FW: SEA SHIPMENT FROM XIAMEN TO CHENNAI // ALG-02", "________________________________", "From: OVERSEAS AAS", "Dear Sir, ".repeat(40)].join("\r\n");
is("a mail in the notes: one line", /[\r\n]|___/.test(hintOf(mail)), false);
is("… cut short", [hintOf(mail).length <= 160, hintOf(mail).endsWith("…")], [true, true]);
is("… starting with its subject", hintOf(mail).startsWith("FW: SEA SHIPMENT FROM XIAMEN TO CHENNAI // ALG-02 From: OVERSEAS AAS"), true);

console.log("\nmode, port and term");
is("an import's port is where it comes from", portOf(base), "QINGDAO");
is("an export's is where it goes", portOf({ ...base, enquiry: { ...base.enquiry, trade_direction: "export" } }), "CHENNAI");
is("unknown direction: both ends", portOf({ ...base, enquiry: { ...base.enquiry, trade_direction: null } }), "QINGDAO → CHENNAI");
is("LCL with the incoterm", termOf("sea_lcl", "fob"), "LCL FOB");
is("air: the incoterm alone", termOf("air", "EXW"), "EXW");
is("sea either way is SEA", [registerRow(1, base)[4], registerRow(1, { ...base, enquiry: { ...base.enquiry, transport_mode: "air" } })[4]], ["SEA", "AIR"]);

console.log("\nagents and rates");
const q = (partner_id: string, partner_label: string, amount: number | null, sent_at: string) => ({ partner_id, partner_label, status: amount == null ? "asked" : "quoted", amount, currency: "USD", sent_at });
const two = { ...base, agentQuotes: [q("b", "Uni-System", 355, "2026-09-10T02:00:00Z"), q("a", "ZHL", 50, "2026-09-10T01:00:00Z")] };
is("each agent, in the order asked, with its rate", agentAndRate(two), { agent: "ZHL & UNI-SYSTEM", rate: "USD 50 & USD 355" });
is("one not answered keeps its place", agentAndRate({ ...base, agentQuotes: [q("a", "ZHL", 50, "1"), q("b", "Honest", null, "2")] }).rate, "USD 50 & —");
is("nobody answered: no rate", agentAndRate({ ...base, agentQuotes: [q("a", "GLWW", null, "1")] }), { agent: "GLWW", rate: "" });
is("asked twice counts once, the later answer", agentAndRate({ ...base, agentQuotes: [q("a", "ZHL", 60, "1"), q("a", "ZHL", 55, "2")] }).rate, "USD 55");
is("routed through one: that agent and its rate", agentAndRate({ ...two, routedAgent: { id: "b", name: "Uni-System Logistics" } }), { agent: "UNI-SYSTEM LOGISTICS", rate: "USD 355" });

console.log("\nstatus");
is("new, nothing asked", registerStatus(base), "New");
is("waiting on agents", registerStatus({ ...base, agentQuotes: [q("a", "ZHL", null, "1")] }), "Waiting for agent rates");
is("rates in", registerStatus(two), "Agent rates received");
is("quoted", registerStatus({ ...base, enquiry: { ...base.enquiry, status: "quoted" } }), "Quoted to customer");

const shipment: NonNullable<RegisterInput["shipment"]> = {
  id: "ARX-SHP-0004",
  transport_mode: "sea_lcl",
  booking_number: "alg-01",
  bl_number: "QDWJ26093202",
  forwarders_bl_no: null,
  vessel: "Fei Hong Da 86",
  voyage: "2601W",
  flight_number: null,
  etd: "2026-09-20",
  eta: "2026-10-11",
  cargo_cutoff: "2026-09-17",
  port_of_loading: "Qingdao (CNTAO)",
  port_of_discharge: "Chennai (INMAA)",
  direct: false,
  bl_type: "forwarder",
  console_id: null,
  cancelled: false,
  delivered: false,
  signed_off: false,
};
const booked = { ...base, shipment, stageText: "Booked", nextStep: "BL draft", coloader: "CCI", cfsInr: 2280 };
const br = registerRow(1, booked);
is("a shipment's stage and next step", br[19], "Booked — next: BL draft");
is("booking, BL and vessel", [br[10], br[12], br[13]], ["ALG-01", "QDWJ26093202", "FEI HONG DA 86 2601W"]);
is("the shipment's port wins over the enquiry's", br[5], "QINGDAO (CNTAO)");
is("transit worked out from ETD and ETA", br[17], 21);
is("co-loaded, with whom", br[18], "CO-LOAD CCI");
is("CFS charges as a number", br[9], 2280);
is("no booking number: the job number", registerRow(1, { ...booked, shipment: { ...shipment, booking_number: null } })[10], "ARX-SHP-0004");
is("air: the HAWB and the flight", (() => { const r = registerRow(1, { ...booked, hawbNo: "ALG/HAWB/0012", shipment: { ...shipment, transport_mode: "air", flight_number: "EK 543" } }); return [r[12], r[13]]; })(), ["ALG/HAWB/0012", "EK 543"]);
is("signed off is completed", registerStatus({ ...booked, shipment: { ...shipment, signed_off: true } }), "Completed");

console.log("\nthe period");
is("inside", inPeriod(base, "2026-09-01", "2026-09-30"), true);
is("the register's day, not UTC's", inPeriod(base, "2026-09-09", "2026-09-09"), true);
is("outside", inPeriod(base, "2026-10-01", null), false);
is("in words", periodText("2026-09-01", "2026-09-30"), "1 Sep 2026 – 30 Sep 2026");
is("no period", periodText(null, null), "All enquiries");
is("this month", presetRange("this_month", "2026-09-24"), { from: "2026-09-01", to: "2026-09-24" });
is("last month, to its last day", presetRange("last_month", "2026-03-10"), { from: "2026-02-01", to: "2026-02-28" });
is("last month from January is December", presetRange("last_month", "2027-01-05"), { from: "2026-12-01", to: "2026-12-31" });
is("the financial year from April", presetRange("fy", "2026-09-24"), { from: "2026-04-01", to: "2026-09-24" });
is("in February it began last April", presetRange("fy", "2027-02-10").from, "2026-04-01");
is("made when, by whom", registerSheet([], { company: "A", from: null, to: null, generatedAt: new Date(2026, 8, 24, 15, 5), generatedBy: "Aarathy" }).report?.lines?.[2], "Generated 24 Sep 2026, 15:05 by Aarathy");

console.log("\nthe file");
const sheet = registerSheet([booked, { ...base, enquiry: { ...base.enquiry, ref: "ALG09001-26", received_at: "2026-09-01T05:00:00Z" } }], {
  company: "Aashish Logistics Global",
  from: null,
  to: null,
  generatedAt: new Date("2026-09-24T10:00:00Z"),
  generatedBy: "Aarathy",
});
is("oldest first", sheet.rows.map((r) => r[3]), ["ALG09001-26", "ALG09003-26"]);
is("numbered after sorting", sheet.rows.map((r) => r[0]), [1, 2]);
const xml = new TextDecoder().decode(buildWorkbook([sheet]));
is("the title on row one", xml.includes('<c r="A1" s="4" t="inlineStr"><is><t xml:space="preserve">Enquiry register</t></is></c>'), true);
is("the header under the title, its three lines and a gap", xml.includes('<row r="6" ht="30" customHeight="1"><c r="A6" s="6"'), true);
is("the header and four columns frozen", xml.includes('<pane xSplit="4" ySplit="6" topLeftCell="E7" activePane="bottomRight" state="frozen"/>'), true);
is("a filter on the header", xml.includes('<autoFilter ref="A6:U8"/>'), true);
is("the filter named for Excel", xml.includes(`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Enquiry register'!$A$6:$U$8</definedName>`), true);
is("the header printed on every page", xml.includes(`'Enquiry register'!$6:$6`), true);
is("an ampersand in a name is escaped", xml.includes("AAKARSH AIR &amp; SEA"), true);
is("empty cells still carry the grid", xml.includes('<c r="K7" s='), true);
is("a long note makes a taller row", reportRowHeight(["x".repeat(100)], [{ header: "H", width: 40, kind: "wrap" }]), 43);
is("short text leaves the row alone", reportRowHeight(["short"], [{ header: "H", width: 40, kind: "wrap" }]), null);

console.log("\ninbound, in process, completed");
is("no shipment: inbound", categoryOf(base), "inbound");
is("declined or lost: not proceeding", [categoryOf({ ...base, enquiry: { ...base.enquiry, status: "declined" } }), categoryOf({ ...base, enquiry: { ...base.enquiry, status: "lost" } })], ["not_proceeding", "not_proceeding"]);
is("a shipment under way: in process", categoryOf(booked), "in_process");
is("delivered: completed", categoryOf({ ...booked, shipment: { ...shipment, delivered: true } }), "completed");
is("cancelled: not proceeding", categoryOf({ ...booked, shipment: { ...shipment, cancelled: true } }), "not_proceeding");
const meta = { company: "Aashish Logistics Global Pvt Ltd", from: null, to: null, generatedAt: new Date(2026, 8, 24, 10, 0), generatedBy: "Aarathy" };
const done = { ...booked, enquiry: { ...booked.enquiry, ref: "ALG09002-26" }, shipment: { ...shipment, delivered: true, signed_off: true } };
const wb = registerWorkbook([base, booked, done], meta);
is("summary, then a sheet for each", wb.map((x) => x.name), ["Summary", "Inbound", "In process", "Completed"]);
is("each sheet holds its own", wb.slice(1).map((x) => x.rows.map((r) => r[3])), [["ALG09003-26"], ["ALG09003-26"], ["ALG09002-26"]]);
is("the summary counts them", wb[0].rows.filter((r) => !String(r[0]).startsWith(" ")).map((r) => [r[0], r[1]]), [["Inbound", 1], ["In process", 1], ["Completed", 1], ["Total", 3]]);
is("completed split by closing", wb[0].rows.some((r) => String(r[0]).trim() === "Closed (signed off)" && r[1] === 1), true);
is("a not-proceeding sheet only when there is one", registerWorkbook([base, { ...base, enquiry: { ...base.enquiry, status: "lost" } }], meta).map((x) => x.name), ["Summary", "Inbound", "In process", "Completed", "Not proceeding"]);
is("sheet titles say which", wb[2].report?.title, "Enquiry register — in process");
is("the file opens with every sheet", (new TextDecoder().decode(buildWorkbook(wb)).match(/<sheet name=/g) ?? []).length, 4);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
