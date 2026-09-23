/**
 * Where places are, and the lines between them, for the route map.
 *
 * ---------------------------------------------------------------------------
 * PLACES
 *
 * The ports and airports this desk ships through, with coordinates. A place
 * is found from the job's own spelling — its code in brackets ("Chennai
 * (MAA)", "Jebel Ali (AEJEA)") first, then its name — and a port or an
 * airport is preferred by the mode, because "Mumbai" is Nhava Sheva to a
 * ship and Chhatrapati Shivaji to a plane. A place not listed here is looked
 * up once and remembered (src/services/geocode.ts); nothing is placed on the
 * map by guessing.
 *
 * LINES
 *
 * A flight is drawn as the great circle it flies. A voyage is drawn along the
 * shipping lanes (src/lib/seaRoute.ts) — a straight line from Barcelona to
 * Mumbai would cross the Sahara.
 * ---------------------------------------------------------------------------
 */

export type LatLon = [number, number];

export interface Place {
  label: string;
  kind: "port" | "airport" | "city";
  lat: number;
  lon: number;
  /** IATA for airports, UN/LOCODE for ports. */
  codes: string[];
  names: RegExp;
}

const P = (label: string, kind: Place["kind"], lat: number, lon: number, codes: string[], names: RegExp): Place => ({
  label,
  kind,
  lat,
  lon,
  codes,
  names,
});

export const PLACES: Place[] = [
  // India — airports
  P("Chennai", "airport", 12.9941, 80.1709, ["MAA"], /\bchennai\b|\bmadras\b/i),
  P("Mumbai", "airport", 19.0896, 72.8656, ["BOM"], /\bmumbai\b|\bbombay\b/i),
  P("Delhi", "airport", 28.5562, 77.1, ["DEL"], /\bdelhi\b/i),
  P("Bengaluru", "airport", 13.1986, 77.7066, ["BLR"], /\bbengaluru\b|\bbangalore\b/i),
  P("Hyderabad", "airport", 17.2403, 78.4294, ["HYD"], /\bhyderabad\b/i),
  P("Kolkata", "airport", 22.6547, 88.4467, ["CCU"], /\bkolkata\b|\bcalcutta\b/i),
  P("Kochi", "airport", 10.152, 76.4019, ["COK"], /\bkochi\b|\bcochin\b/i),
  P("Coimbatore", "airport", 11.03, 77.0434, ["CJB"], /\bcoimbatore\b/i),
  P("Ahmedabad", "airport", 23.0772, 72.6347, ["AMD"], /\bahmedabad\b/i),
  P("Trivandrum", "airport", 8.4821, 76.9201, ["TRV"], /\btrivandrum\b|\bthiruvananthapuram\b/i),
  // India — ports
  P("Chennai", "port", 13.095, 80.295, ["INMAA"], /\bchennai\b|\bmadras\b/i),
  P("Kattupalli", "port", 13.29, 80.35, ["INKAT"], /\bkattupalli\b/i),
  P("Ennore", "port", 13.26, 80.33, ["INENR"], /\bennore\b|\bkamarajar\b/i),
  P("Nhava Sheva", "port", 18.95, 72.95, ["INNSA"], /\bnhava\s*sheva\b|\bjnpt\b|\bjawaharlal\b|\bmumbai\b|\bbombay\b/i),
  P("Mundra", "port", 22.739, 69.708, ["INMUN"], /\bmundra\b/i),
  P("Kandla", "port", 23.0333, 70.2167, ["INIXY"], /\bkandla\b|\bdeendayal\b/i),
  P("Pipavav", "port", 20.9, 71.5, ["INPAV"], /\bpipavav\b/i),
  P("Hazira", "port", 21.08, 72.63, ["INHZA"], /\bhazira\b/i),
  P("Cochin", "port", 9.9667, 76.2667, ["INCOK"], /\bkochi\b|\bcochin\b/i),
  P("Tuticorin", "port", 8.7642, 78.1848, ["INTUT"], /\btuticorin\b|\bthoothukudi\b/i),
  P("Visakhapatnam", "port", 17.69, 83.29, ["INVTZ"], /\bvisakhapatnam\b|\bvizag\b/i),
  P("Kolkata", "port", 22.03, 88.07, ["INCCU", "INHAL"], /\bkolkata\b|\bcalcutta\b|\bhaldia\b/i),
  P("Krishnapatnam", "port", 14.25, 80.13, ["INKRI"], /\bkrishnapatnam\b/i),
  // Gulf and Middle East
  P("Dubai", "airport", 25.2532, 55.3657, ["DXB"], /\bdubai\b/i),
  P("Sharjah", "airport", 25.3286, 55.5172, ["SHJ"], /\bsharjah\b/i),
  P("Abu Dhabi", "airport", 24.433, 54.6511, ["AUH"], /\babu\s*dhabi\b/i),
  P("Doha", "airport", 25.2731, 51.6081, ["DOH"], /\bdoha\b|\bqatar\b/i),
  P("Muscat", "airport", 23.5933, 58.2844, ["MCT"], /\bmuscat\b/i),
  P("Bahrain", "airport", 26.2708, 50.6336, ["BAH"], /\bbahrain\b/i),
  P("Kuwait", "airport", 29.2266, 47.9689, ["KWI"], /\bkuwait\b/i),
  P("Jeddah", "airport", 21.6796, 39.1565, ["JED"], /\bjeddah\b/i),
  P("Riyadh", "airport", 24.9576, 46.6988, ["RUH"], /\briyadh\b/i),
  P("Dammam", "airport", 26.4712, 49.7979, ["DMM"], /\bdammam\b/i),
  P("Jebel Ali", "port", 25.0112, 55.0617, ["AEJEA"], /\bjebel\s*ali\b|\bdubai\b/i),
  P("Khalifa Port", "port", 24.81, 54.65, ["AEKHL", "AEAUH"], /\bkhalifa\b|\babu\s*dhabi\b/i),
  P("Sharjah", "port", 25.36, 55.37, ["AESHJ"], /\bsharjah\b|\bkhalid\b/i),
  P("Hamad Port", "port", 25.01, 51.6, ["QAHMD"], /\bhamad\b|\bdoha\b|\bqatar\b/i),
  P("Sohar", "port", 24.5, 56.63, ["OMSOH"], /\bsohar\b/i),
  P("Salalah", "port", 16.95, 54.0, ["OMSLL"], /\bsalalah\b/i),
  P("Dammam", "port", 26.5, 50.2, ["SADMM"], /\bdammam\b/i),
  P("Jeddah", "port", 21.47, 39.16, ["SAJED"], /\bjeddah\b/i),
  P("Shuwaikh", "port", 29.35, 47.93, ["KWSWK"], /\bshuwaikh\b|\bkuwait\b/i),
  P("Bahrain", "port", 26.12, 50.63, ["BHKBS"], /\bbahrain\b|\bkhalifa bin salman\b/i),
  P("Karachi", "port", 24.84, 66.98, ["PKKHI"], /\bkarachi\b/i),
  P("Port Said", "port", 31.26, 32.31, ["EGPSD"], /\bport\s*said\b/i),
  P("Djibouti", "port", 11.6, 43.13, ["DJJIB"], /\bdjibouti\b/i),
  // South and East Asia
  P("Colombo", "airport", 7.1808, 79.8841, ["CMB"], /\bcolombo\b/i),
  P("Colombo", "port", 6.95, 79.84, ["LKCMB"], /\bcolombo\b/i),
  P("Chittagong", "port", 22.3, 91.8, ["BDCGP"], /\bchittagong\b|\bchattogram\b/i),
  P("Singapore", "airport", 1.3644, 103.9915, ["SIN"], /\bsingapore\b/i),
  P("Singapore", "port", 1.26, 103.84, ["SGSIN"], /\bsingapore\b/i),
  P("Kuala Lumpur", "airport", 2.7456, 101.7099, ["KUL"], /\bkuala\s*lumpur\b/i),
  P("Port Klang", "port", 2.99, 101.39, ["MYPKG"], /\bport\s*klang\b|\bkuala\s*lumpur\b/i),
  P("Bangkok", "airport", 13.69, 100.7501, ["BKK"], /\bbangkok\b/i),
  P("Laem Chabang", "port", 13.08, 100.88, ["THLCH"], /\blaem\s*chabang\b|\bbangkok\b/i),
  P("Hong Kong", "airport", 22.308, 113.9185, ["HKG"], /\bhong\s*kong\b/i),
  P("Hong Kong", "port", 22.33, 114.12, ["HKHKG"], /\bhong\s*kong\b/i),
  P("Shanghai", "airport", 31.1443, 121.8083, ["PVG"], /\bshanghai\b/i),
  P("Shanghai", "port", 30.63, 122.07, ["CNSHA"], /\bshanghai\b|\byangshan\b/i),
  P("Busan", "port", 35.1, 129.04, ["KRPUS"], /\bbusan\b/i),
  // Europe
  P("Frankfurt", "airport", 50.0379, 8.5622, ["FRA"], /\bfrankfurt\b/i),
  P("Amsterdam", "airport", 52.3105, 4.7683, ["AMS"], /\bamsterdam\b/i),
  P("Paris", "airport", 49.0097, 2.5479, ["CDG"], /\bparis\b/i),
  P("London", "airport", 51.47, -0.4543, ["LHR"], /\blondon\b|\bheathrow\b/i),
  P("Istanbul", "airport", 41.2753, 28.7519, ["IST"], /\bistanbul\b/i),
  P("Barcelona", "airport", 41.2974, 2.0833, ["BCN"], /\bbarcelona\b/i),
  P("Madrid", "airport", 40.4983, -3.5676, ["MAD"], /\bmadrid\b/i),
  P("Milan", "airport", 45.6306, 8.7281, ["MXP"], /\bmilan\b|\bmalpensa\b/i),
  P("Hamburg", "port", 53.54, 9.97, ["DEHAM"], /\bhamburg\b/i),
  P("Rotterdam", "port", 51.95, 4.14, ["NLRTM"], /\brotterdam\b/i),
  P("Antwerp", "port", 51.28, 4.33, ["BEANR"], /\bantwerp\b/i),
  P("Felixstowe", "port", 51.95, 1.33, ["GBFXT"], /\bfelixstowe\b/i),
  P("London Gateway", "port", 51.5, 0.47, ["GBLGP"], /\blondon\s*gateway\b|\blondon\b/i),
  P("Le Havre", "port", 49.48, 0.11, ["FRLEH"], /\ble\s*havre\b/i),
  P("Barcelona", "port", 41.35, 2.16, ["ESBCN"], /\bbarcelona\b/i),
  P("Valencia", "port", 39.45, -0.32, ["ESVLC"], /\bvalencia\b/i),
  P("Genoa", "port", 44.4, 8.92, ["ITGOA"], /\bgenoa\b|\bgenova\b/i),
  P("Piraeus", "port", 37.94, 23.62, ["GRPIR"], /\bpiraeus\b|\bathens\b/i),
  // Africa, the Americas, Oceania
  P("Nairobi", "airport", -1.3192, 36.9278, ["NBO"], /\bnairobi\b/i),
  P("Johannesburg", "airport", -26.1392, 28.246, ["JNB"], /\bjohannesburg\b/i),
  P("Mombasa", "port", -4.06, 39.66, ["KEMBA"], /\bmombasa\b/i),
  P("Durban", "port", -29.87, 31.03, ["ZADUR"], /\bdurban\b/i),
  P("New York", "airport", 40.6413, -73.7781, ["JFK"], /\bnew\s*york\b/i),
  P("New York", "port", 40.67, -74.15, ["USNYC"], /\bnew\s*york\b|\bnewark\b/i),
  P("Chicago", "airport", 41.9742, -87.9073, ["ORD"], /\bchicago\b/i),
  P("Los Angeles", "airport", 33.9416, -118.4085, ["LAX"], /\blos\s*angeles\b/i),
  P("Los Angeles", "port", 33.74, -118.26, ["USLAX", "USLGB"], /\blos\s*angeles\b|\blong\s*beach\b/i),
  P("Toronto", "airport", 43.6777, -79.6248, ["YYZ"], /\btoronto\b/i),
  P("Sydney", "airport", -33.9399, 151.1753, ["SYD"], /\bsydney\b/i),
  P("Sydney", "port", -33.97, 151.21, ["AUSYD"], /\bsydney\b|\bbotany\b/i),
];

/** The mode's kind of place first: a port to a ship, an airport to a plane. */
function prefer(mode: string | null | undefined): Place["kind"] | null {
  if (mode === "air") return "airport";
  if (mode === "sea_fcl" || mode === "sea_lcl") return "port";
  return null;
}

/**
 * A place from the job's spelling. The code in the text wins (it is the
 * unambiguous part), then the name, preferring the mode's kind of place.
 */
export function findPlace(text: string | null | undefined, mode?: string | null): Place | null {
  const s = (text ?? "").trim();
  if (!s) return null;
  const want = prefer(mode);
  const codes = [...s.toUpperCase().matchAll(/\b([A-Z]{3}|[A-Z]{5})\b/g)].map((m) => m[1]);
  for (const c of codes) {
    const hit = PLACES.find((p) => p.codes.includes(c) && (!want || p.kind === want)) ?? PLACES.find((p) => p.codes.includes(c));
    if (hit) return hit;
  }
  // The earliest-mentioned name wins: "Jebel Ali / Dubai" is Jebel Ali.
  const named = PLACES.map((p) => ({ p, at: s.search(p.names) })).filter((x) => x.at >= 0);
  if (!named.length) return null;
  const pool = want && named.some((x) => x.p.kind === want) ? named.filter((x) => x.p.kind === want) : named;
  return pool.sort((a, b) => a.at - b.at)[0].p;
}

const RAD = Math.PI / 180;

export function distanceKm(a: LatLon, b: LatLon): number {
  const [la1, lo1] = [a[0] * RAD, a[1] * RAD];
  const [la2, lo2] = [b[0] * RAD, b[1] * RAD];
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The great circle from a to b, as points about every 150 km. */
export function greatCircle(a: LatLon, b: LatLon): LatLon[] {
  const d = distanceKm(a, b) / 6371;
  if (d < 1e-6) return [a, b];
  const n = Math.max(2, Math.ceil((d * 6371) / 150));
  const [la1, lo1, la2, lo2] = [a[0] * RAD, a[1] * RAD, b[0] * RAD, b[1] * RAD];
  const out: LatLon[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    out.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD, Math.atan2(y, x) / RAD]);
  }
  return unwrap(out);
}

/**
 * Longitudes made continuous, so a line across the date line is drawn the
 * short way (179 → 181) instead of back across the whole map (179 → -179).
 */
export function unwrap(points: LatLon[]): LatLon[] {
  const out: LatLon[] = [];
  for (const [lat, lon] of points) {
    if (!out.length) {
      out.push([lat, lon]);
      continue;
    }
    const prev = out[out.length - 1][1];
    let l = lon;
    while (l - prev > 180) l -= 360;
    while (l - prev < -180) l += 360;
    out.push([lat, l]);
  }
  return out;
}

/** Degrees clockwise from north, from a to b — for pointing an arrow. */
export function bearing(a: LatLon, b: LatLon): number {
  const [la1, la2] = [a[0] * RAD, b[0] * RAD];
  const dl = (b[1] - a[1]) * RAD;
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
