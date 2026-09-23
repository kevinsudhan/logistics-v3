import { airlineByName, airlineOf, airportOf, AIRLINES, prefixOfMawb, serialOfMawb } from "./airlines";
import { chargeableWeight } from "./chargeableWeight";
import { UNIT_LABEL, type DimensionLine, type DimensionUnit } from "./dimensions";

/**
 * The house air waybill: every box on the form, filling it from the job, and
 * the charge boxes' arithmetic.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE
 *
 * One flat record of the boxes as the IATA form lays them out, kept as the
 * `data` of house_airwaybills (075). Figures are held as the text typed —
 * "2600.0", "" — because a form that turns a half-typed number into 0 while
 * somebody is typing is a form that fights them; the arithmetic reads them.
 *
 * FILLING FROM THE JOB
 *
 * `hawbFromJob` is "Fetch details": the parties, routing, flights, pieces,
 * weights and goods from the shipment, its legs and its sizes. What the desk
 * decides for the document — the charges shown, the handling note once
 * written, the signatures — is not the job's, and a second fetch leaves it
 * alone (`refetch`).
 *
 * THE CHARGE BOXES
 *
 * The weight charge is the rate lines' totals; it, the valuation charge and
 * the tax go to the prepaid or collect column by the WT/VAL box. Each other
 * charge says whether it is due the agent or the carrier and whether it is
 * prepaid or collect. The totals are sums, never typed, so the printed boxes
 * always add up.
 * ---------------------------------------------------------------------------
 */

export type PC = "P" | "C";

export interface RateLine {
  pieces: string;
  gross: string;
  /** K for kilograms, L for pounds, as the form writes it. */
  unit: "K" | "L";
  /** M minimum, N normal, Q quantity, C specific commodity, R reduced, S surcharged. */
  rate_class: string;
  commodity_item: string;
  chargeable: string;
  rate: string;
  /** Typed only to override rate × chargeable weight ("AS AGREED" is a blank total). */
  total: string;
}

export interface OtherCharge {
  name: string;
  unit: "shipment" | "kg" | "piece";
  per_unit: string;
  /** Typed only to override per unit × quantity. */
  amount: string;
  due: "agent" | "carrier";
  pp: PC;
}

export interface HawbData {
  // The MAWB this is issued under, as it heads the form: 176 | MAA | 12345675.
  airline_prefix: string;
  departure_code: string;
  mawb_serial: string;

  shipper_name: string;
  shipper_address: string;
  shipper_account: string;
  consignee_name: string;
  consignee_address: string;
  consignee_account: string;

  carrier_name: string;
  issued_by: string;

  agent_name: string;
  agent_address: string;
  agent_iata_code: string;
  agent_account: string;
  accounting_info: string;
  reference_number: string;

  departure_airport: string;
  to1: string;
  by1: string;
  to2: string;
  by2: string;
  to3: string;
  by3: string;
  currency: string;
  chgs_code: string;
  wt_val: PC;
  other: PC;
  dv_carriage: string;
  dv_customs: string;

  destination_airport: string;
  flight1: string;
  flight1_date: string;
  flight2: string;
  flight2_date: string;
  insurance: string;

  handling_info: string;
  pan_number: string;
  sci: string;

  rates: RateLine[];
  nature_of_goods: string;
  marks_numbers: string;

  valuation_charge: string;
  tax: string;
  other_charges: OtherCharge[];
  conversion_rate: string;
  charges_at_destination: string;

  shipper_signature: string;
  carrier_signature: string;
  executed_on: string;
  executed_at: string;
}

export const emptyRate = (): RateLine => ({
  pieces: "",
  gross: "",
  unit: "K",
  rate_class: "",
  commodity_item: "",
  chargeable: "",
  rate: "",
  total: "",
});

export const emptyCharge = (pp: PC = "P"): OtherCharge => ({
  name: "",
  unit: "shipment",
  per_unit: "",
  amount: "",
  due: "carrier",
  pp,
});

export function emptyHawb(): HawbData {
  return {
    airline_prefix: "",
    departure_code: "",
    mawb_serial: "",
    shipper_name: "",
    shipper_address: "",
    shipper_account: "",
    consignee_name: "",
    consignee_address: "",
    consignee_account: "",
    carrier_name: "",
    issued_by: "",
    agent_name: "",
    agent_address: "",
    agent_iata_code: "",
    agent_account: "",
    accounting_info: "",
    reference_number: "",
    departure_airport: "",
    to1: "",
    by1: "",
    to2: "",
    by2: "",
    to3: "",
    by3: "",
    currency: "INR",
    chgs_code: "PP",
    wt_val: "P",
    other: "P",
    dv_carriage: "NVD",
    dv_customs: "NCV",
    destination_airport: "",
    flight1: "",
    flight1_date: "",
    flight2: "",
    flight2_date: "",
    insurance: "NIL",
    handling_info: "",
    pan_number: "",
    sci: "",
    rates: [emptyRate()],
    nature_of_goods: "",
    marks_numbers: "",
    valuation_charge: "",
    tax: "",
    other_charges: [],
    conversion_rate: "",
    charges_at_destination: "",
    shipper_signature: "",
    carrier_signature: "",
    executed_on: "",
    executed_at: "",
  };
}

/** A saved record with any box it lacks filled blank, so an older save still opens. */
export function normaliseHawb(raw: Partial<HawbData> | null | undefined): HawbData {
  const base = emptyHawb();
  const d = { ...base, ...(raw ?? {}) } as HawbData;
  d.rates = (raw?.rates?.length ? raw.rates : base.rates).map((r) => ({ ...emptyRate(), ...r }));
  d.other_charges = (raw?.other_charges ?? []).map((c) => ({ ...emptyCharge(), ...c }));
  return d;
}

// ---------------------------------------------------------------------------
// Filling from the job
// ---------------------------------------------------------------------------

export interface JobForHawb {
  shipment: {
    shipper_name: string | null;
    shipper_address: string | null;
    shipper_city: string | null;
    shipper_state: string | null;
    shipper_pincode: string | null;
    shipper_country: string | null;
    shipper_pan: string | null;
    consignee_name: string | null;
    consignee_address: string | null;
    consignee_city: string | null;
    consignee_state: string | null;
    consignee_pincode: string | null;
    consignee_country: string | null;
    notify_name: string | null;
    notify_address: string | null;
    carrier: string | null;
    flight_number: string | null;
    etd: string | null;
    sailing_date: string | null;
    port_of_loading: string | null;
    port_of_discharge: string | null;
    origin: string | null;
    destination: string | null;
    mainline_no: string | null;
    cargo: string | null;
    piece_count: number | null;
    package_count: number | null;
    package_type: string | null;
    gross_weight_kg: number | string | null;
    volume_cbm: number | string | null;
    marks_and_numbers: string | null;
    hs_code: string | null;
    freight_terms: "prepaid" | "collect" | null;
    un_number: string | null;
    imo_class: string | null;
    enquiry_ref: string;
  };
  /** The air legs, in order, from the shipment's routing. */
  airLegs: Array<{ to_place: string | null; voyage_flight: string | null; etd: string | null; carrier: string | null }>;
  dims: Array<Pick<DimensionLine, "pieces" | "length" | "width" | "height">>;
  unit: DimensionUnit;
  company: { name: string; address: string[]; city: string };
  /** Who is filling it in, for the shipper's-agent signature. */
  userName: string | null;
  today: string;
}

const lines = (...parts: Array<string | null | undefined>) => parts.map((p) => (p ?? "").trim()).filter(Boolean).join("\n");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const trimNum = (n: number) => String(Math.round(n * 1000) / 1000);

/** The goods box: what it is, then each size line, then the volume. */
export function natureOfGoods(
  cargo: string | null,
  dims: JobForHawb["dims"],
  unit: DimensionUnit,
  volumeCbm: number | null,
  hsCode: string | null
): string {
  const sized = dims.filter((d) => d.pieces && d.length && d.width && d.height);
  const u = UNIT_LABEL[unit].length;
  return lines(
    (cargo ?? "").toUpperCase(),
    hsCode ? `HS CODE: ${hsCode}` : null,
    sized.length ? `PCS/L X W X H (${u.toUpperCase()})` : null,
    ...sized.map((d) => `${d.pieces}/${trimNum(d.length!)} X ${trimNum(d.width!)} X ${trimNum(d.height!)}`),
    volumeCbm ? `VOL: ${volumeCbm.toFixed(3)} CBM` : null
  );
}

export function hawbFromJob(j: JobForHawb): HawbData {
  const s = j.shipment;
  const d = emptyHawb();
  const from = airportOf(s.port_of_loading ?? s.origin);
  const to = airportOf(s.port_of_discharge ?? s.destination);

  const firstFlight = s.flight_number ?? j.airLegs[0]?.voyage_flight ?? null;
  const code = airlineOf(firstFlight) ?? airlineByName(s.carrier);
  const airline = code ? AIRLINES[code] : undefined;

  d.airline_prefix = prefixOfMawb(s.mainline_no) ?? airline?.prefix ?? "";
  d.mawb_serial = serialOfMawb(s.mainline_no) ?? "";
  d.departure_code = from.code ?? "";
  d.departure_airport = from.city ?? "";

  d.shipper_name = (s.shipper_name ?? "").toUpperCase();
  d.shipper_address = lines(s.shipper_address, [s.shipper_city, s.shipper_state, s.shipper_pincode].filter(Boolean).join(", "), s.shipper_country).toUpperCase();
  d.consignee_name = (s.consignee_name ?? "").toUpperCase();
  d.consignee_address = lines(s.consignee_address, [s.consignee_city, s.consignee_state, s.consignee_pincode].filter(Boolean).join(", "), s.consignee_country).toUpperCase();
  d.pan_number = (s.shipper_pan ?? "").toUpperCase();

  d.carrier_name = (airline?.name ?? s.carrier ?? "").toUpperCase();
  d.issued_by = lines(j.company.name, ...j.company.address).toUpperCase();
  d.agent_name = j.company.name.toUpperCase();
  d.agent_address = j.company.city.toUpperCase();

  // The routing: each air leg is a To / By pair, the last one the destination.
  const legs = j.airLegs.length
    ? j.airLegs.map((l) => ({ to: airportOf(l.to_place).code ?? "", by: airlineOf(l.voyage_flight) ?? airlineByName(l.carrier) ?? "" }))
    : [{ to: to.code ?? "", by: code ?? "" }];
  [d.to1, d.by1] = [legs[0]?.to ?? "", legs[0]?.by ?? ""];
  [d.to2, d.by2] = [legs[1]?.to ?? "", legs[1]?.by ?? ""];
  [d.to3, d.by3] = [legs[2]?.to ?? "", legs[2]?.by ?? ""];
  d.destination_airport = to.city ?? "";

  const flight2 = j.airLegs[1];
  d.flight1 = (firstFlight ?? "").replace(/\s+/g, "").toUpperCase();
  d.flight1_date = s.etd ?? s.sailing_date ?? j.airLegs[0]?.etd ?? "";
  d.flight2 = (flight2?.voyage_flight ?? "").replace(/\s+/g, "").toUpperCase();
  d.flight2_date = flight2?.etd ?? "";

  const collect = s.freight_terms === "collect";
  d.chgs_code = collect ? "CC" : "PP";
  d.wt_val = collect ? "C" : "P";
  d.other = collect ? "C" : "P";
  d.accounting_info = collect ? "** FREIGHT COLLECT **" : "** FREIGHT PREPAID **";
  d.reference_number = s.enquiry_ref;

  const gross = num(s.gross_weight_kg);
  const volume = num(s.volume_cbm);
  const pieces = s.piece_count ?? s.package_count;
  const cw = gross !== null && volume !== null ? chargeableWeight(gross, volume, "air") : null;
  d.rates = [
    {
      ...emptyRate(),
      pieces: pieces ? String(pieces) : "",
      gross: gross !== null ? trimNum(gross) : "",
      chargeable: cw ? cw.value.toFixed(1) : gross !== null ? trimNum(gross) : "",
    },
  ];
  d.nature_of_goods = natureOfGoods(s.cargo, j.dims, j.unit, volume, s.hs_code);
  d.marks_numbers = (s.marks_and_numbers ?? "").toUpperCase();

  const handling: string[] = [];
  if (s.un_number) handling.push(`DANGEROUS GOODS AS PER ATTACHED SHIPPER'S DECLARATION — ${s.un_number.toUpperCase()}${s.imo_class ? ` CLASS ${s.imo_class}` : ""}`);
  if (s.notify_name) handling.push(lines(`ALSO NOTIFY: ${s.notify_name}`, s.notify_address).toUpperCase());
  d.handling_info = handling.join("\n");

  d.shipper_signature = (j.userName ?? "").toUpperCase();
  d.carrier_signature = d.carrier_name ? `AS AGENTS FOR ${d.carrier_name}` : "";
  d.executed_on = j.today;
  d.executed_at = d.departure_code;
  return d;
}

/** The boxes "Fetch details" refreshes; the rest are the document's own. */
export const JOB_KEYS: Array<keyof HawbData> = [
  "airline_prefix",
  "mawb_serial",
  "departure_code",
  "departure_airport",
  "shipper_name",
  "shipper_address",
  "consignee_name",
  "consignee_address",
  "pan_number",
  "carrier_name",
  "to1",
  "by1",
  "to2",
  "by2",
  "to3",
  "by3",
  "destination_airport",
  "flight1",
  "flight1_date",
  "flight2",
  "flight2_date",
  "nature_of_goods",
  "marks_numbers",
  "reference_number",
];

/**
 * Fetch details over a saved HAWB: the job's boxes from the job, the rest as
 * the desk left them. A job box the job has nothing for keeps what was typed —
 * an empty job field is not an instruction to clear the document.
 */
export function refetch(current: HawbData, fresh: HawbData): HawbData {
  const out: HawbData = { ...current, rates: current.rates.map((r) => ({ ...r })) };
  for (const k of JOB_KEYS) {
    const v = fresh[k];
    if (typeof v === "string" && v.trim()) (out[k] as string) = v;
  }
  // Pieces, weights and chargeable weight on the first rate line are the job's;
  // its rate, class and total are the document's.
  const f = fresh.rates[0];
  const r = out.rates[0] ?? emptyRate();
  out.rates[0] = { ...r, pieces: f.pieces || r.pieces, gross: f.gross || r.gross, chargeable: f.chargeable || r.chargeable };
  return out;
}

// ---------------------------------------------------------------------------
// The charge boxes
// ---------------------------------------------------------------------------

export interface Column {
  weight: number;
  valuation: number;
  tax: number;
  dueAgent: number;
  dueCarrier: number;
  total: number;
}

export interface AwbTotals {
  pieces: number;
  gross: number;
  chargeable: number;
  weightCharge: number;
  prepaid: Column;
  collect: Column;
  /** Collect charges converted to the destination's currency, when a rate is given. */
  ccInDestCurrency: number | null;
  totalCollectCharges: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function lineTotal(r: RateLine): number {
  const typed = num(r.total);
  if (typed !== null) return typed;
  const cw = num(r.chargeable);
  const rate = num(r.rate);
  return cw !== null && rate !== null ? round2(cw * rate) : 0;
}

export function chargeAmount(c: OtherCharge, chargeableKg: number, pieces: number): number {
  const typed = num(c.amount);
  if (typed !== null) return typed;
  const per = num(c.per_unit);
  if (per === null) return 0;
  const qty = c.unit === "kg" ? chargeableKg : c.unit === "piece" ? pieces : 1;
  return round2(per * qty);
}

export function awbTotals(d: HawbData): AwbTotals {
  const pieces = d.rates.reduce((a, r) => a + (num(r.pieces) ?? 0), 0);
  const gross = d.rates.reduce((a, r) => a + (num(r.gross) ?? 0), 0);
  const chargeable = d.rates.reduce((a, r) => a + (num(r.chargeable) ?? 0), 0);
  const weightCharge = round2(d.rates.reduce((a, r) => a + lineTotal(r), 0));
  const valuation = num(d.valuation_charge) ?? 0;
  const tax = num(d.tax) ?? 0;

  const col = (): Column => ({ weight: 0, valuation: 0, tax: 0, dueAgent: 0, dueCarrier: 0, total: 0 });
  const prepaid = col();
  const collect = col();
  const wv = d.wt_val === "C" ? collect : prepaid;
  wv.weight = weightCharge;
  wv.valuation = valuation;
  wv.tax = tax;

  for (const c of d.other_charges) {
    const amt = chargeAmount(c, chargeable, pieces);
    const side = c.pp === "C" ? collect : prepaid;
    if (c.due === "agent") side.dueAgent = round2(side.dueAgent + amt);
    else side.dueCarrier = round2(side.dueCarrier + amt);
  }
  for (const s of [prepaid, collect]) s.total = round2(s.weight + s.valuation + s.tax + s.dueAgent + s.dueCarrier);

  const rate = num(d.conversion_rate);
  const ccInDestCurrency = rate !== null && collect.total ? round2(collect.total * rate) : null;
  const atDest = num(d.charges_at_destination);
  const totalCollectCharges = ccInDestCurrency !== null || atDest !== null ? round2((ccInDestCurrency ?? 0) + (atDest ?? 0)) : null;

  return { pieces, gross, chargeable, weightCharge, prepaid, collect, ccInDestCurrency, totalCollectCharges };
}

/** 12000 → "12000.00"; a zero box prints empty, as the form does. */
export const money = (n: number | null | undefined) => (n ? n.toFixed(2) : "");

// ---------------------------------------------------------------------------
// What the original cannot go without
// ---------------------------------------------------------------------------

/** The boxes marked * on the form, and the rest an issued original needs. */
export function missingForOriginal(d: HawbData): string[] {
  const out: string[] = [];
  const need = (ok: boolean, label: string) => !ok && out.push(label);
  need(Boolean(d.shipper_name.trim()), "Shipper");
  need(Boolean(d.consignee_name.trim()), "Consignee");
  need(/^[A-Z]{3}$/.test(d.departure_code), "Departure airport code");
  need(/^[A-Z]{3}$/.test(finalDestination(d)), "Destination airport code (To)");
  need(Boolean(d.by1.trim()), "First carrier (By)");
  need(Boolean(d.destination_airport.trim()), "Destination airport");
  need(Boolean(d.dv_carriage.trim()), "Declared value for carriage");
  need(Boolean(d.dv_customs.trim()), "Declared value for customs");
  need(Boolean(d.insurance.trim()), "Insurance amount");
  need(Boolean(d.flight1.trim()), "Flight");
  need(d.rates.some((r) => num(r.pieces) && num(r.gross)), "Pieces and gross weight");
  need(Boolean(d.nature_of_goods.trim()), "Nature and quantity of goods");
  for (const [i, c] of d.other_charges.entries()) {
    need(Boolean(c.name.trim()), `Other charge ${i + 1}: name`);
  }
  return out;
}

/** The last airport on the routing: where the HAWB number says it goes. */
export function finalDestination(d: HawbData): string {
  return [d.to3, d.to2, d.to1].map((x) => x.trim().toUpperCase()).find(Boolean) ?? "";
}

/** How the history names a box. */
export const FIELD_LABEL: Record<string, string> = {
  airline_prefix: "Airline prefix",
  departure_code: "Departure code",
  mawb_serial: "MAWB serial",
  shipper_name: "Shipper",
  shipper_address: "Shipper's address",
  shipper_account: "Shipper's account number",
  consignee_name: "Consignee",
  consignee_address: "Consignee's address",
  consignee_account: "Consignee's account number",
  carrier_name: "Carrier",
  issued_by: "Issued by",
  agent_name: "Issuing carrier's agent",
  agent_address: "Agent's city",
  agent_iata_code: "Agent's IATA code",
  agent_account: "Agent's account number",
  accounting_info: "Accounting information",
  reference_number: "Reference number",
  departure_airport: "Airport of departure",
  to1: "To",
  by1: "By first carrier",
  to2: "To (2)",
  by2: "By (2)",
  to3: "To (3)",
  by3: "By (3)",
  currency: "Currency",
  chgs_code: "Charges code",
  wt_val: "WT/VAL",
  other: "Other",
  dv_carriage: "Declared value for carriage",
  dv_customs: "Declared value for customs",
  destination_airport: "Destination airport",
  flight1: "Flight",
  flight1_date: "Flight date",
  flight2: "Second flight",
  flight2_date: "Second flight date",
  insurance: "Insurance amount",
  handling_info: "Handling information",
  pan_number: "PAN number",
  sci: "SCI",
  rates: "Rate lines",
  nature_of_goods: "Nature and quantity of goods",
  marks_numbers: "Marks & numbers",
  valuation_charge: "Valuation charge",
  tax: "Tax",
  other_charges: "Other charges",
  conversion_rate: "Currency conversion rate",
  charges_at_destination: "Charges at destination",
  shipper_signature: "Signature of shipper or agent",
  carrier_signature: "Signature of issuing carrier or agent",
  executed_on: "Executed on",
  executed_at: "Executed at",
  hawb_date: "HAWB date",
  awb_kind: "Airway bill",
};
