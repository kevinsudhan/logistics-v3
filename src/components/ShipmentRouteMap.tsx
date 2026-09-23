import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { greatCircle, type LatLon } from "../lib/geo";
import { buildRoute, mainHow, type How, type RouteInput } from "../lib/routeModel";
import { loadSeaGraph, seaRoute, type SeaGraph } from "../lib/seaRoute";
import { labelFor, loadPlaceCache, lookUpPlaces, resolverFor, type PlaceCache } from "../services/geocode";

// Leaflet and its stylesheet load with the map, not with the page around it.
const RouteMap = lazy(() => import("./RouteMap"));

/**
 * The route map for one shipment: loads what it needs, works out the route,
 * and draws it (src/lib/routeModel.ts, src/components/RouteMap.tsx).
 *
 * Used on the Tracking tab and on the customer's page. Only the Tracking tab
 * may look a place up (`canLookUp`); the customer's page draws with what is
 * listed or already remembered.
 */

export type Position = { lat: number; lon: number; at: string; source: string };

export default function ShipmentRouteMap({
  input,
  loadPositions,
  canLookUp,
  refreshKey,
  height,
}: {
  input: Pick<RouteInput, "mode" | "stage" | "pol" | "pod" | "finalDestination" | "legs">;
  loadPositions: () => Promise<Position[]>;
  canLookUp: boolean;
  /** Changes when the tracking has been refreshed, so the track is read again. */
  refreshKey?: string | number | null;
  height?: number;
}) {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [cache, setCache] = useState<PlaceCache | null>(null);
  const [graph, setGraph] = useState<SeaGraph | null>(null);
  const [lanesFailed, setLanesFailed] = useState(false);
  const [lookedUp, setLookedUp] = useState(0);
  const how = mainHow(input.mode);

  useEffect(() => {
    void loadPositions()
      .then(setPositions)
      .catch(() => setPositions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    void loadPlaceCache().then(setCache);
  }, []);

  useEffect(() => {
    if (how !== "sea" && !input.legs.some((l) => l.move === "sea")) return;
    void loadSeaGraph()
      .then(setGraph)
      .catch(() => setLanesFailed(true));
  }, [how, input.legs]);

  const needLanes = (how === "sea" || input.legs.some((l) => l.move === "sea")) && !graph && !lanesFailed;

  const model = useMemo(() => {
    if (!positions || !cache || needLanes) return null;
    const route = (a: LatLon, b: LatLon, h: How): LatLon[] =>
      h === "sea" ? (graph ? (seaRoute(graph, a, b) ?? greatCircle(a, b)) : greatCircle(a, b)) : h === "air" ? greatCircle(a, b) : [a, b];
    return buildRoute({ ...input, positions, resolve: resolverFor(input.mode, cache), labelOf: labelFor(input.mode, cache), route });
    // lookedUp: a place found by lookup is in the cache; rebuild with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, cache, graph, needLanes, input.mode, input.stage, input.pol, input.pod, input.finalDestination, input.legs, lookedUp]);

  // Places the list does not know: look them up once, then draw again.
  useEffect(() => {
    if (!canLookUp || !model?.unplaced.length || !cache) return;
    void lookUpPlaces(model.unplaced, cache).then((n) => n && setLookedUp((x) => x + n));
  }, [canLookUp, model, cache]);

  if (!model) {
    return (
      <div className="grid place-items-center rounded-lg border border-border bg-surface-2" style={{ height: height ?? 420 }}>
        <p className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <Loader2 size={14} className="animate-spin" /> Drawing the route…
        </p>
      </div>
    );
  }

  if (model.stops.length < 2 && !model.pings.length) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border px-4 py-5 text-[12.5px] text-text-secondary">
        <MapPin size={14} className="mt-0.5 shrink-0 text-text-muted" />
        <span>
          The map needs where the cargo leaves from and goes to.
          {model.unplaced.length
            ? ` ${model.unplaced.map((n) => `"${n}"`).join(" and ")} could not be placed${canLookUp ? " yet" : ""}.`
            : " Set the port or airport of loading and discharge on Shipment details."}
        </span>
      </div>
    );
  }

  return (
    <>
      <Suspense
        fallback={
          <div className="grid place-items-center rounded-lg border border-border bg-surface-2" style={{ height: height ?? 420 }}>
            <Loader2 size={14} className="animate-spin text-text-muted" />
          </div>
        }
      >
        <RouteMap model={model} air={how === "air"} height={height} />
      </Suspense>
      {(model.unplaced.length > 0 || lanesFailed) && (
        <p className="mt-1.5 text-[11px] text-text-muted">
          {model.unplaced.length > 0 && `Not on the map: ${model.unplaced.join(", ")}. `}
          {lanesFailed && "The shipping lanes could not be loaded, so the sea route is drawn direct."}
        </p>
      )}
    </>
  );
}
