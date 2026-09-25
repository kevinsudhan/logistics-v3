import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Maximize2, Minimize2 } from "lucide-react";
import { bearing, type LatLon } from "../lib/geo";
import type { RouteModel } from "../lib/routeModel";
import { formatDate } from "../lib/dates";

/**
 * The route map: where the cargo has been, where it is, where it is going.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ON IT
 *
 * The actual route as a solid line with arrows showing the direction, every
 * report the ship or aircraft made as a ring on it, the expected route still
 * to go as a dashed line, and the origin and destination each named in a
 * card. A legend says which is which; the map zooms and goes full screen.
 *
 * WHY LEAFLET AND OPENSTREETMAP
 *
 * Free, no key, and small (about 40 KB). The tiles are OpenStreetMap's own,
 * which ask for attribution — kept in the corner — and fair use, which a
 * freight desk's tracking tab is. A heavier style or satellite imagery would
 * mean a paid tile service and a key in the browser.
 * ---------------------------------------------------------------------------
 */

const LINE = "#1e3a5f";
const ORIGIN = "#1e3a5f";
const DEST = "#16a34a";

const ship = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.4 18.5 21 13l-9-4-9 4 1.8 5.5"/><path d="M12 9V3"/><path d="M8 5h8"/></svg>`;
const plane = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`;

function arrowIcon(deg: number) {
  return L.divIcon({
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<svg viewBox="0 0 14 14" width="14" height="14" style="transform:rotate(${deg}deg)"><path d="M7 1 L12 11 L7 8.5 L2 11 Z" fill="${LINE}"/></svg>`,
  });
}

export default function RouteMap({ model, air, height = 420 }: { model: RouteModel; air: boolean; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [full, setFull] = useState(false);

  // The map itself, once.
  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: false, worldCopyJump: true, scrollWheelZoom: false, minZoom: 2 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(m);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    // The wheel zooms only once the map has been clicked: a page scrolled
    // past the map should scroll, not zoom the map under the pointer.
    m.on("click", () => m.scrollWheelZoom.enable());
    m.on("mouseout", () => m.scrollWheelZoom.disable());
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // What is drawn on it, each time the route changes.
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: LatLon[] = [];

    if (model.expected.length > 1) {
      L.polyline(model.expected, { color: LINE, weight: 3, opacity: 0.85, dashArray: "6 9" }).addTo(g);
      bounds.push(...model.expected);
    }
    if (model.actual.length > 1) {
      L.polyline(model.actual, { color: LINE, weight: 3.5, opacity: 0.95 }).addTo(g);
      bounds.push(...model.actual);
      // An arrow every so often along the way, pointing the way it went.
      const step = Math.max(1, Math.floor(model.actual.length / 6));
      for (let n = step; n < model.actual.length; n += step) {
        const a = model.actual[n - 1];
        const b = model.actual[n];
        L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { icon: arrowIcon(bearing(a, b)), interactive: false, keyboard: false }).addTo(g);
      }
    }

    for (const p of model.pings) {
      L.circleMarker(p.at, { radius: 5, color: LINE, weight: 2.5, fillColor: "#ffffff", fillOpacity: 1 })
        .bindTooltip(`${formatDate(p.when, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${p.source === "aisstream" ? "AIS" : p.source === "adsb" ? "ADS-B" : "AeroDataBox"}`)
        .addTo(g);
      bounds.push(p.at);
    }

    for (const s of model.stops) {
      const color = s.role === "destination" || s.role === "final" ? DEST : ORIGIN;
      if (s.role === "via") {
        L.circleMarker(s.at, { radius: 5, color, weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip(s.label).addTo(g);
      } else {
        L.circleMarker(s.at, { radius: 8, color, weight: 3, fillColor: s.role === "origin" ? color : "#ffffff", fillOpacity: 1 })
          .bindTooltip(
            `<span style="display:flex;align-items:center;gap:8px;color:#334155"><span style="color:${LINE};display:flex">${air ? plane : ship}</span><span style="border-left:1px solid #cbd5e1;padding-left:8px;font-size:13px">${escapeHtml(s.label)}</span></span>`,
            { permanent: true, direction: "top", offset: [0, -10], className: "route-card", opacity: 1 }
          )
          .addTo(g);
      }
      bounds.push(s.at);
    }

    if (model.current && !model.stops.some((s) => s.at[0] === model.current!.at[0] && s.at[1] === model.current!.at[1])) {
      L.circleMarker(model.current.at, { radius: 9, color: "#ffffff", weight: 3, fillColor: LINE, fillOpacity: 1 })
        .bindTooltip(model.current.when ? `Last reported ${formatDate(model.current.when, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Here now")
        .addTo(g);
    }

    // Room above for the place cards, and a closer fit than Leaflet's default.
    if (bounds.length) m.fitBounds(L.latLngBounds(bounds), { paddingTopLeft: [24, 64], paddingBottomRight: [24, 24], maxZoom: 7 });
    else m.setView([20, 60], 3);
  }, [model, air]);

  // Full screen: the whole map card, legend and all.
  useEffect(() => {
    const onChange = () => {
      setFull(document.fullscreenElement === wrap.current);
      setTimeout(() => map.current?.invalidateSize(), 50);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return (
    <div ref={wrap} className="relative overflow-hidden rounded-lg border border-border bg-surface-1">
      <style>{`.route-card{background:#fff;border:0;border-radius:8px;box-shadow:0 2px 10px rgba(15,23,42,.18);padding:6px 10px}.route-card:before{border-top-color:#fff}`}</style>
      <div ref={box} style={{ height: full ? "100vh" : height }} className="w-full" />

      <button
        type="button"
        onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void wrap.current?.requestFullscreen())}
        className="absolute right-3 top-3 z-[500] grid h-9 w-9 place-items-center rounded-md border border-border bg-white text-slate-700 shadow-sm hover:bg-slate-50"
        aria-label={full ? "Leave full screen" : "Full screen"}
        title={full ? "Leave full screen" : "Full screen"}
      >
        {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>

      <div className="absolute bottom-2 left-2 z-[500] rounded-md border border-border bg-white/95 px-2 py-1 text-[10.5px] leading-tight text-slate-700 shadow-sm sm:bottom-3 sm:left-3 sm:px-3 sm:py-2 sm:text-[11.5px]">
        <p className="flex items-center gap-2.5 py-0.5">
          <svg width="30" height="6">
            <line x1="0" y1="3" x2="30" y2="3" stroke={LINE} strokeWidth="3" />
          </svg>
          Actual route
        </p>
        <p className="flex items-center gap-2.5 py-0.5">
          <svg width="30" height="6">
            <line x1="0" y1="3" x2="30" y2="3" stroke={LINE} strokeWidth="3" strokeDasharray="5 5" />
          </svg>
          Expected route
        </p>
        <p className="flex items-center gap-2.5 py-0.5">
          <svg width="30" height="12">
            <circle cx="15" cy="6" r="4.5" fill="#fff" stroke={LINE} strokeWidth="2.5" />
          </svg>
          {air ? "ADS-B positions" : "AIS pings"}
        </p>
      </div>
    </div>
  );
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
