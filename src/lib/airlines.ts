/**
 * Airlines and airports, as an air waybill prints them.
 *
 * ---------------------------------------------------------------------------
 * The three-digit prefix is the airline's IATA accounting code — the "176" in
 * 176-12345675 is Emirates — and heads the MAWB number on every AWB. The
 * carriers on this desk's lanes and the big freighter operators are here; any
 * other can be typed into the form, which is why nothing here is enforced.
 *
 * Airports: the code is read from the place as the job spells it — "Chennai
 * (MAA)" says so itself — and failing that from the city name, for the cities
 * this desk ships to and from. A place neither way knows gets no code, and the
 * form asks for it rather than guessing.
 * ---------------------------------------------------------------------------
 */

export interface Airline {
  name: string;
  /** IATA accounting code, the MAWB prefix. */
  prefix: string;
}

export const AIRLINES: Record<string, Airline> = {
  EK: { name: "EMIRATES", prefix: "176" },
  QR: { name: "QATAR AIRWAYS", prefix: "157" },
  EY: { name: "ETIHAD AIRWAYS", prefix: "607" },
  FZ: { name: "FLYDUBAI", prefix: "141" },
  G9: { name: "AIR ARABIA", prefix: "514" },
  WY: { name: "OMAN AIR", prefix: "910" },
  GF: { name: "GULF AIR", prefix: "072" },
  KU: { name: "KUWAIT AIRWAYS", prefix: "229" },
  SV: { name: "SAUDIA", prefix: "065" },
  RJ: { name: "ROYAL JORDANIAN", prefix: "512" },
  MS: { name: "EGYPTAIR", prefix: "077" },
  ET: { name: "ETHIOPIAN AIRLINES", prefix: "071" },
  KQ: { name: "KENYA AIRWAYS", prefix: "706" },
  AI: { name: "AIR INDIA", prefix: "098" },
  "6E": { name: "INDIGO", prefix: "312" },
  UL: { name: "SRILANKAN AIRLINES", prefix: "603" },
  BG: { name: "BIMAN BANGLADESH", prefix: "997" },
  PK: { name: "PAKISTAN INTERNATIONAL", prefix: "214" },
  SQ: { name: "SINGAPORE AIRLINES", prefix: "618" },
  MH: { name: "MALAYSIA AIRLINES", prefix: "232" },
  TG: { name: "THAI AIRWAYS", prefix: "217" },
  CX: { name: "CATHAY PACIFIC", prefix: "160" },
  CI: { name: "CHINA AIRLINES", prefix: "297" },
  BR: { name: "EVA AIR", prefix: "695" },
  CZ: { name: "CHINA SOUTHERN", prefix: "784" },
  CA: { name: "AIR CHINA", prefix: "999" },
  MU: { name: "CHINA EASTERN", prefix: "781" },
  KE: { name: "KOREAN AIR", prefix: "180" },
  OZ: { name: "ASIANA", prefix: "988" },
  NH: { name: "ALL NIPPON AIRWAYS", prefix: "205" },
  JL: { name: "JAPAN AIRLINES", prefix: "131" },
  LH: { name: "LUFTHANSA CARGO", prefix: "020" },
  LX: { name: "SWISS", prefix: "724" },
  OS: { name: "AUSTRIAN", prefix: "257" },
  AF: { name: "AIR FRANCE", prefix: "057" },
  KL: { name: "KLM", prefix: "074" },
  BA: { name: "BRITISH AIRWAYS", prefix: "125" },
  VS: { name: "VIRGIN ATLANTIC", prefix: "932" },
  TK: { name: "TURKISH AIRLINES", prefix: "235" },
  AY: { name: "FINNAIR", prefix: "105" },
  SK: { name: "SAS", prefix: "117" },
  IB: { name: "IBERIA", prefix: "075" },
  AA: { name: "AMERICAN AIRLINES", prefix: "001" },
  UA: { name: "UNITED AIRLINES", prefix: "016" },
  DL: { name: "DELTA AIR LINES", prefix: "006" },
  AC: { name: "AIR CANADA", prefix: "014" },
  QF: { name: "QANTAS", prefix: "081" },
  CV: { name: "CARGOLUX", prefix: "172" },
  "5X": { name: "UPS AIRLINES", prefix: "406" },
  FX: { name: "FEDEX", prefix: "023" },
};

/** The airline in a flight number: "EK 543" → EK. */
export function airlineOf(flight: string | null | undefined): string | null {
  const m = /^\s*([A-Z0-9]{2})\s*-?\s*\d/i.exec(flight ?? "");
  return m && /[A-Z]/i.test(m[1]) ? m[1].toUpperCase() : null;
}

/** The airline in a carrier name as typed: "Emirates SkyCargo" → EK. */
export function airlineByName(name: string | null | undefined): string | null {
  const n = (name ?? "").toUpperCase();
  if (!n.trim()) return null;
  if (AIRLINES[n.trim()]) return n.trim();
  const hit = Object.entries(AIRLINES).find(([, a]) => n.includes(a.name.split(" ")[0]));
  return hit ? hit[0] : null;
}

/** The MAWB prefix out of a master number already on file: "176-12345675" → 176. */
export function prefixOfMawb(mawb: string | null | undefined): string | null {
  const m = /^\s*(\d{3})\s*[-\s]?\s*\d{4}/.exec(mawb ?? "");
  return m ? m[1] : null;
}

/** The serial after the prefix: "176-12345675" → 12345675. */
export function serialOfMawb(mawb: string | null | undefined): string | null {
  const m = /^\s*\d{3}\s*[-\s]?\s*(\d{7,8})\b/.exec(mawb ?? "");
  return m ? m[1] : null;
}

const CITY_CODES: Array<[RegExp, string, string]> = [
  [/\bchennai|madras\b/i, "MAA", "CHENNAI"],
  [/\bmumbai|bombay\b/i, "BOM", "MUMBAI"],
  [/\bdelhi\b/i, "DEL", "DELHI"],
  [/\bbengaluru|bangalore\b/i, "BLR", "BENGALURU"],
  [/\bhyderabad\b/i, "HYD", "HYDERABAD"],
  [/\bkolkata|calcutta\b/i, "CCU", "KOLKATA"],
  [/\bkochi|cochin\b/i, "COK", "KOCHI"],
  [/\bcoimbatore\b/i, "CJB", "COIMBATORE"],
  [/\bahmedabad\b/i, "AMD", "AHMEDABAD"],
  [/\btrivandrum|thiruvananthapuram\b/i, "TRV", "TRIVANDRUM"],
  [/\bdubai|jebel ali\b/i, "DXB", "DUBAI"],
  [/\bsharjah\b/i, "SHJ", "SHARJAH"],
  [/\babu dhabi\b/i, "AUH", "ABU DHABI"],
  [/\bdoha\b/i, "DOH", "DOHA"],
  [/\bmuscat\b/i, "MCT", "MUSCAT"],
  [/\bbahrain\b/i, "BAH", "BAHRAIN"],
  [/\bkuwait\b/i, "KWI", "KUWAIT"],
  [/\bjeddah\b/i, "JED", "JEDDAH"],
  [/\briyadh\b/i, "RUH", "RIYADH"],
  [/\bdammam\b/i, "DMM", "DAMMAM"],
  [/\bcolombo\b/i, "CMB", "COLOMBO"],
  [/\bsingapore\b/i, "SIN", "SINGAPORE"],
  [/\bkuala lumpur\b/i, "KUL", "KUALA LUMPUR"],
  [/\bbangkok\b/i, "BKK", "BANGKOK"],
  [/\bhong kong\b/i, "HKG", "HONG KONG"],
  [/\bshanghai\b/i, "PVG", "SHANGHAI"],
  [/\bfrankfurt\b/i, "FRA", "FRANKFURT"],
  [/\bamsterdam\b/i, "AMS", "AMSTERDAM"],
  [/\bparis\b/i, "CDG", "PARIS"],
  [/\blondon\b/i, "LHR", "LONDON"],
  [/\bistanbul\b/i, "IST", "ISTANBUL"],
  [/\bnairobi\b/i, "NBO", "NAIROBI"],
  [/\bjohannesburg\b/i, "JNB", "JOHANNESBURG"],
  [/\bnew york\b/i, "JFK", "NEW YORK"],
  [/\bchicago\b/i, "ORD", "CHICAGO"],
  [/\blos angeles\b/i, "LAX", "LOS ANGELES"],
  [/\btoronto\b/i, "YYZ", "TORONTO"],
  [/\bsydney\b/i, "SYD", "SYDNEY"],
];

/** An airport as the form prints it: code and city, from the job's spelling. */
export function airportOf(place: string | null | undefined): { code: string | null; city: string | null } {
  const s = place ?? "";
  const byCity = CITY_CODES.find(([re]) => re.test(s));
  const inParens = /\(([A-Z]{3})\)/.exec(s)?.[1] ?? null;
  const code = inParens ?? byCity?.[1] ?? null;
  const city = byCity?.[2] ?? (s.replace(/\(.*?\)/g, "").split(/[,/]/)[0].trim().toUpperCase() || null);
  return { code, city };
}
