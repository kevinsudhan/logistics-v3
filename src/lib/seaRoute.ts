import { distanceKm, unwrap, type LatLon } from "./geo";

/**
 * The way a ship goes: shortest path along the world's shipping lanes.
 *
 * ---------------------------------------------------------------------------
 * THE NETWORK
 *
 * public/data/sea-lanes.json is the maritime lane network published with
 * searoute-js (MIT), itself from Eurostat's SeaRoute and the Oak Ridge
 * National Laboratory global shipping lane network: about 6,000 junctions on
 * 3,600 lanes, through Suez, Panama, Malacca, Gibraltar and round the Capes.
 * It is fetched once, when a map needs it, rather than shipped in the bundle.
 *
 * THE ROUTE
 *
 * Each end is joined to the nearest point of the network, and Dijkstra finds
 * the shortest way between them by distance. This is how a line is drawn that
 * goes the way ships go — round India, up the Red Sea, through Suez — not a
 * sailing plan: a service calling at five ports sails further than this.
 * ---------------------------------------------------------------------------
 */

interface LaneFeature {
  geometry: { type: "LineString"; coordinates: Array<[number, number]> };
}

export interface SeaGraph {
  /** [lat, lon] per node. */
  nodes: LatLon[];
  /** Neighbours and the distance to each, in km. */
  edges: Array<Array<[number, number]>>;
}

const keyOf = (lon: number, lat: number) => `${lon.toFixed(4)},${lat.toFixed(4)}`;

export function buildSeaGraph(geojson: { features: LaneFeature[] }): SeaGraph {
  const index = new Map<string, number>();
  const nodes: LatLon[] = [];
  const edges: SeaGraph["edges"] = [];
  const node = (lon: number, lat: number) => {
    const k = keyOf(lon, lat);
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      index.set(k, i);
      nodes.push([lat, lon]);
      edges.push([]);
    }
    return i;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    const d = distanceKm(nodes[a], nodes[b]);
    edges[a].push([b, d]);
    edges[b].push([a, d]);
  };
  for (const f of geojson.features) {
    const c = f.geometry?.coordinates ?? [];
    for (let i = 1; i < c.length; i++) link(node(c[i - 1][0], c[i - 1][1]), node(c[i][0], c[i][1]));
  }
  // The lanes stop at the date line on both sides; join them across it.
  const east = nodes.map((n, i) => [n, i] as const).filter(([n]) => n[1] >= 179.99);
  const west = nodes.map((n, i) => [n, i] as const).filter(([n]) => n[1] <= -179.99);
  for (const [e, i] of east) for (const [w, j] of west) if (Math.abs(e[0] - w[0]) < 0.01) link(i, j);
  return { nodes, edges };
}

export function nearestNode(g: SeaGraph, p: LatLon): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    // A cheap filter first: most nodes are nowhere near.
    const n = g.nodes[i];
    if (Math.abs(n[0] - p[0]) > 25) continue;
    const d = distanceKm(n, p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) {
    for (let i = 0; i < g.nodes.length; i++) {
      const d = distanceKm(g.nodes[i], p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

/** A small binary heap of [distance, node]. */
class Heap {
  private a: Array<[number, number]> = [];
  get size() {
    return this.a.length;
  }
  push(x: [number, number]) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * The sea route from a to b as [lat, lon] points, both ends included, or null
 * when the network has no way between them (a lake, a closed sea).
 */
export function seaRoute(g: SeaGraph, a: LatLon, b: LatLon): LatLon[] | null {
  const s = nearestNode(g, a);
  const t = nearestNode(g, b);
  if (s < 0 || t < 0) return null;
  const dist = new Float64Array(g.nodes.length).fill(Infinity);
  const prev = new Int32Array(g.nodes.length).fill(-1);
  dist[s] = 0;
  const heap = new Heap();
  heap.push([0, s]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (u === t) break;
    for (const [v, w] of g.edges[u]) {
      const nd = d + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heap.push([nd, v]);
      }
    }
  }
  if (dist[t] === Infinity) return null;
  const path: LatLon[] = [];
  for (let u = t; u !== -1; u = prev[u]) path.push(g.nodes[u]);
  path.reverse();
  return unwrap([a, ...path, b]);
}

let loading: Promise<SeaGraph> | null = null;

/** The network, fetched and built once per page. */
export function loadSeaGraph(url = "/data/sea-lanes.json"): Promise<SeaGraph> {
  loading ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Could not load the sea lanes (${r.status})`);
      return r.json();
    })
    .then(buildSeaGraph)
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
