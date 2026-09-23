import { supabase } from "../lib/supabase";
import { findPlace, type LatLon } from "../lib/geo";

/**
 * Where a place is, for the route map.
 *
 * ---------------------------------------------------------------------------
 * The ports and airports in src/lib/geo.ts answer most of it without asking
 * anybody. The rest — an inland town, a port nobody listed — is looked up on
 * OpenStreetMap's Nominatim, once, from a signed-in person's page, and kept in
 * geo_places (076) for every page after, the customer's included.
 *
 * Nominatim is a free service with a firm usage policy: at most one request a
 * second, results cached, no bulk lookups. Hence one name at a time, a pause
 * between them, and never from the customer's page.
 * ---------------------------------------------------------------------------
 */

const norm = (s: string) => s.trim().toLowerCase();

export type PlaceCache = Map<string, { at: LatLon; label: string }>;

export async function loadPlaceCache(): Promise<PlaceCache> {
  const { data, error } = await supabase.from("geo_places").select("query, label, lat, lon").limit(2000);
  if (error) return new Map();
  return new Map((data ?? []).map((r) => [r.query as string, { at: [r.lat as number, r.lon as number] as LatLon, label: r.label as string }]));
}

/** The listed place first, then one looked up before. */
export function resolverFor(mode: string | null, cache: PlaceCache): (name: string) => LatLon | null {
  return (name) => {
    const p = findPlace(name, mode);
    if (p) return [p.lat, p.lon];
    return cache.get(norm(name))?.at ?? null;
  };
}

/** The name on the map: the listed place's own, one looked up before, or the text without its codes. */
export function labelFor(mode: string | null, cache: PlaceCache): (name: string) => string {
  return (name) => findPlace(name, mode)?.label ?? cache.get(norm(name))?.label.split(",")[0] ?? name.replace(/\(.*?\)/g, "").split(/[,/]/)[0].trim();
}

const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Look the names up and remember what is found. Returns how many were found.
 * A name Nominatim does not know stays unknown; it is not retried this page.
 */
const tried = new Set<string>();
export async function lookUpPlaces(names: string[], cache: PlaceCache): Promise<number> {
  let found = 0;
  for (const name of names) {
    const key = norm(name);
    if (cache.has(key) || tried.has(key)) continue;
    tried.add(key);
    // "Jebel Ali / Dubai, UAE (AEJEA)" is looked up as the words, not the code.
    const q = name.replace(/\(.*?\)/g, " ").split("/")[0].replace(/\s+/g, " ").trim();
    if (!q) continue;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, {
        headers: { Accept: "application/json", "Accept-Language": "en" },
      });
      if (r.ok) {
        const [hit] = (await r.json()) as Array<{ lat: string; lon: string; display_name: string }>;
        if (hit) {
          const at: LatLon = [Number(hit.lat), Number(hit.lon)];
          const label = hit.display_name.split(",").slice(0, 2).join(",").trim();
          cache.set(key, { at, label });
          await supabase.rpc("remember_place", { p_query: name, p_label: label, p_lat: at[0], p_lon: at[1] });
          found++;
        }
      }
    } catch {
      // Offline or refused: the map shows what it has.
    }
    await pause(1100);
  }
  return found;
}
