import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 resolves its module worker relative to import.meta.url, which
// breaks under a bundler. Let Vite bundle the worker and hand over its URL.
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(mapWorkerUrl);
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronDown,
  Image as ImageIcon,
  Info,
  LocateFixed,
  Minus,
  Plus,
  X,
} from "lucide-react";
import type { Campus, Listing } from "../types";
import { ROOM_LABELS } from "../types";
import { dateLabel, money, savings } from "../lib/api";
import {
  PATROL_ZONES,
  distanceLabel,
  milesBetween,
  type MapBounds,
} from "../lib/dps";


type Props = {
  campus: Campus;
  listings?: Listing[];
  /** Listing id currently hovered or focused in the list. */
  activeId?: string | null;
  /** Fired when a marker is hovered (id) or left (null). */
  onActive?: (id: string | null) => void;
  /** Fired when a marker or the preview card is chosen. */
  onListing?: (id: string) => void;
  /** Fired after every pan or zoom with the visible bounds. */
  onBounds?: (bounds: MapBounds) => void;
  pin?: { lat: number; lng: number };
  onPin?: (point: { lat: number; lng: number }) => void;
  /** Compact mode hides the legend and shrinks controls (editor, detail). */
  compact?: boolean;
  /** Pixels covered along the bottom edge, the phone sheet, kept clear when framing. */
  bottomInset?: number;
};

// OpenFreeMap serves the Positron style without an API key.
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const ZONE_SOURCE = "patrol-zone";

type Cluster = { items: Listing[]; lat: number; lng: number };
/** Greedy pixel-distance clustering. Listings closer than `radius` px merge. */
function clusterListings(
  m: maplibregl.Map,
  listings: Listing[],
  radius: number,
) {
  const points = listings
    .filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng))
    .map((l) => ({ l, p: m.project([l.lng, l.lat]) }));
  const used = new Set<string>();
  const clusters: Cluster[] = [];
  for (const a of points) {
    if (used.has(a.l.id)) continue;
    used.add(a.l.id);
    const items = [a.l];
    for (const b of points) {
      if (used.has(b.l.id)) continue;
      if (a.p.dist(b.p) <= radius) {
        used.add(b.l.id);
        items.push(b.l);
      }
    }
    clusters.push({
      items,
      lat: items.reduce((s, i) => s + i.lat, 0) / items.length,
      lng: items.reduce((s, i) => s + i.lng, 0) / items.length,
    });
  }
  return clusters;
}

function el(className: string, html: string) {
  const node = document.createElement("div");
  node.className = className;
  node.innerHTML = html;
  return node;
}

export default function Map({
  campus,
  listings = [],
  activeId = null,
  onActive,
  onListing,
  onBounds,
  pin,
  onPin,
  compact = false,
  bottomInset = 0,
}: Props) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    markers = useRef<maplibregl.Marker[]>([]),
    markerIndex = useRef<globalThis.Map<string, HTMLElement>>(
      new globalThis.Map(),
    );
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(14);
  const [legendOpen, setLegendOpen] = useState(false);
  const [zoneVisible, setZoneVisible] = useState(false);
  const [preview, setPreview] = useState<{
    listing: Listing;
    x: number;
    y: number;
  } | null>(null);
  const callbacks = useRef({ onPin, onActive, onListing, onBounds });
  callbacks.current = { onPin, onActive, onListing, onBounds };
  const zone = PATROL_ZONES[campus.id];
  const zoneBounds = useRef<maplibregl.LngLatBounds | null>(null);
  const sized = useRef(false);

  /** Frame the campus: the patrol zone when there is one, else the center. */
  const frame = useCallback(
    (animate = false) => {
      const m = map.current;
      if (!m || pin) return;
      const pad = compact ? 24 : 48;
      if (zoneBounds.current)
        m.fitBounds(zoneBounds.current, {
          padding: { top: pad, left: pad, right: pad, bottom: pad + bottomInset },
          duration: animate ? 600 : 0,
        });
      else if (animate)
        m.flyTo({
          center: [campus.lng, campus.lat],
          zoom: 14,
          offset: [0, -bottomInset / 2],
          duration: 600,
        });
      else {
        m.jumpTo({ center: [campus.lng, campus.lat], zoom: 14 });
        if (bottomInset) m.panBy([0, bottomInset / 2], { duration: 0 });
      }
    },
    [campus.lat, campus.lng, pin, compact, bottomInset],
  );
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const positionPreview = useCallback((listing: Listing) => {
    const m = map.current;
    if (!m) return;
    const point = m.project([listing.lng, listing.lat]);
    setPreview({ listing, x: point.x, y: point.y });
  }, []);

  // Create the map once.
  useEffect(() => {
    if (!element.current) return;
    const m = new maplibregl.Map({
      container: element.current,
      style: STYLE_URL,
      center: [campus.lng, campus.lat],
      zoom: 14,
      minZoom: 10,
      maxZoom: 18,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 150,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.current = m;
    if (import.meta.env.DEV)
      (window as unknown as { __map?: maplibregl.Map }).__map = m;
    const report = () => {
      const c = m.getContainer();
      if (c.clientWidth < 50 || c.clientHeight < 50) return;
      const b = m.getBounds();
      callbacks.current.onBounds?.({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
    };
    m.on("load", () => {
      setReady(true);
      report();
    });
    m.on("error", (e: maplibregl.ErrorEvent) => {
      if (/style|Failed to fetch/i.test(e.error?.message || ""))
        setTileError(true);
    });
    m.on("moveend", report);
    m.on("zoomend", () => setZoomLevel(m.getZoom()));
    m.on("movestart", () => setPreview(null));
    m.on("click", (e: maplibregl.MapMouseEvent) => {
      setPreview(null);
      callbacks.current.onPin?.({
        lat: Number(e.lngLat.lat.toFixed(6)),
        lng: Number(e.lngLat.lng.toFixed(6)),
      });
    });
    const observer = new ResizeObserver(() => {
      m.resize();
      const c = m.getContainer();
      const hasSize = c.clientWidth > 50 && c.clientHeight > 50;
      if (hasSize && !sized.current) {
        sized.current = true;
        frameRef.current(false);
        report();
      } else if (!hasSize) sized.current = false;
    });
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Campus change: draw the patrol zone and frame it.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    setPreview(null);
    // The campus reads as part of the basemap, a soft footprint, a dot, and a
    // label set in the map's own typography, instead of a floating pill.
    for (const id of ["campus-glow", "campus-dot", "campus-label"])
      if (m.getLayer(id)) m.removeLayer(id);
    if (m.getSource("campus")) m.removeSource("campus");
    m.addSource("campus", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: { name: campus.name },
        geometry: { type: "Point", coordinates: [campus.lng, campus.lat] },
      },
    });
    m.addLayer({
      id: "campus-glow",
      type: "circle",
      source: "campus",
      paint: {
        "circle-color": "#3b78d7",
        "circle-opacity": 0.07,
        "circle-blur": 0.6,
        "circle-radius": [
          "interpolate",
          ["exponential", 2],
          ["zoom"],
          11,
          10,
          14,
          80,
          17,
          640,
        ],
      },
    });
    m.addLayer({
      id: "campus-dot",
      type: "circle",
      source: "campus",
      paint: {
        "circle-color": "#3b78d7",
        "circle-radius": 5,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
    m.addLayer({
      id: "campus-label",
      type: "symbol",
      source: "campus",
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 13],
        "text-letter-spacing": 0.02,
        "text-max-width": 9,
        "text-offset": [0, 0.9],
        "text-anchor": "top",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#24519b",
        "text-halo-color": "rgba(255,255,255,0.92)",
        "text-halo-width": 1.6,
      },
    });
    if (m.getLayer(`${ZONE_SOURCE}-fill`)) m.removeLayer(`${ZONE_SOURCE}-fill`);
    if (m.getLayer(`${ZONE_SOURCE}-line`)) m.removeLayer(`${ZONE_SOURCE}-line`);
    if (m.getSource(ZONE_SOURCE)) m.removeSource(ZONE_SOURCE);
    if (zone) {
      const ring = [...zone.points, zone.points[0]].map(([lat, lng]) => [
        lng,
        lat,
      ]);
      m.addSource(ZONE_SOURCE, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [ring] },
        },
      });
      m.addLayer({
        id: `${ZONE_SOURCE}-fill`,
        type: "fill",
        source: ZONE_SOURCE,
        paint: { "fill-color": "#159a6a", "fill-opacity": 0.06 },
      });
      m.addLayer({
        id: `${ZONE_SOURCE}-line`,
        type: "line",
        source: ZONE_SOURCE,
        paint: {
          "line-color": "#159a6a",
          "line-width": 1.6,
          "line-opacity": 0.75,
          "line-dasharray": [3, 2.5],
        },
      });
      const bounds = new maplibregl.LngLatBounds();
      for (const [lat, lng] of zone.points) bounds.extend([lng, lat]);
      zoneBounds.current = bounds;
      const check = () => {
        const b = m.getBounds();
        setZoneVisible(
          b.getWest() < bounds.getEast() &&
            b.getEast() > bounds.getWest() &&
            b.getSouth() < bounds.getNorth() &&
            b.getNorth() > bounds.getSouth(),
        );
      };
      frameRef.current(false);
      check();
      m.on("moveend", check);
      return () => {
        m.off("moveend", check);
      };
    }
    zoneBounds.current = null;
    setZoneVisible(false);
    frameRef.current(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campus.id, ready]);

  // Markers. One marker per listing lives for the whole session of the
  // listings array. Clustering never removes pins, it slides them together
  // under a cluster bubble and slides them back apart, so zooming reads as
  // a fluid merge and split instead of pins popping in and out.
  const clusterNodes = useRef<globalThis.Map<string, { marker: maplibregl.Marker; node: HTMLElement; timer?: number }>>(
    new globalThis.Map(),
  );
  const layoutRef = useRef<() => void>(() => {});
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    for (const marker of markers.current) marker.remove();
    markers.current = [];
    markerIndex.current.clear();
    for (const c of clusterNodes.current.values()) c.marker.remove();
    clusterNodes.current.clear();
    const add = (
      node: HTMLElement,
      lng: number,
      lat: number,
      opts: maplibregl.MarkerOptions = {},
    ) => {
      const marker = new maplibregl.Marker({ element: node, ...opts })
        .setLngLat([lng, lat])
        .addTo(m);
      markers.current.push(marker);
      return marker;
    };
    const pins = new globalThis.Map<string, HTMLElement>();
    for (const item of listings) {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
      const save = savings(item);
      const node = el(
        `price-marker-wrap${item.id === activeId ? " is-active" : ""}${save ? " has-savings" : ""}`,
        `<button type="button" class="price-marker" aria-label="${item.title.replace(/"/g, "&quot;")}, ${money(item.price)} per month">${money(item.price)}</button>`,
      );
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        if (node.classList.contains("is-merged")) return;
        positionPreview(item);
        callbacks.current.onActive?.(item.id);
      });
      node.addEventListener("mouseenter", () => {
        if (!node.classList.contains("is-merged"))
          callbacks.current.onActive?.(item.id);
      });
      node.addEventListener("mouseleave", () =>
        callbacks.current.onActive?.(null),
      );
      add(node, item.lng, item.lat);
      markerIndex.current.set(item.id, node);
      pins.set(item.id, node);
    }

    /** Slide pins into clusters (or apart) for the current zoom. */
    const layout = () => {
      const zoom = m.getZoom();
      const radius = zoom >= 15 ? 0 : zoom >= 14 ? 34 : 56;
      const groups = radius ? clusterListings(m, listings, radius) : [];
      const live = new Set<string>();
      for (const group of groups) {
        if (group.items.length < 2) continue;
        const key = group.items
          .map((i) => i.id)
          .sort()
          .join("|");
        live.add(key);
        const center = m.project([group.lng, group.lat]);
        let entry = clusterNodes.current.get(key);
        if (!entry) {
          const count = group.items.length;
          const size = count < 5 ? "sm" : count < 12 ? "md" : "lg";
          const node = el(
            "cluster-marker-wrap",
            `<button type="button" class="cluster-marker ${size}" aria-label="${count} places here, zoom in">${count}</button>`,
          );
          node.addEventListener("click", (e) => {
            e.stopPropagation();
            setPreview(null);
            const bounds = new maplibregl.LngLatBounds();
            for (const i of group.items) bounds.extend([i.lng, i.lat]);
            m.fitBounds(bounds, {
              padding: 80,
              maxZoom: Math.min(18, m.getZoom() + 3),
              duration: 500,
            });
          });
          const marker = new maplibregl.Marker({ element: node })
            .setLngLat([group.lng, group.lat])
            .addTo(m);
          entry = { marker, node };
          clusterNodes.current.set(key, entry);
          // Next frame so the scale in transition runs from the resting state.
          requestAnimationFrame(() => node.classList.add("is-on"));
        } else {
          if (entry.timer) {
            window.clearTimeout(entry.timer);
            entry.timer = undefined;
          }
          entry.node.classList.add("is-on");
        }
        for (const item of group.items) {
          const node = pins.get(item.id);
          if (!node) continue;
          const p = m.project([item.lng, item.lat]);
          node.style.setProperty("--dx", `${center.x - p.x}px`);
          node.style.setProperty("--dy", `${center.y - p.y}px`);
          node.classList.add("is-merged");
          markerIndex.current.set(item.id, entry.node);
        }
      }
      for (const [id, node] of pins) {
        if (markerIndex.current.get(id) !== node && !live.has(clusterKeyOf(id)))
          markerIndex.current.set(id, node);
        if (!node.classList.contains("is-merged")) continue;
        const merged = groups.some(
          (g) => g.items.length > 1 && g.items.some((i) => i.id === id),
        );
        if (!merged) {
          node.classList.remove("is-merged");
          node.style.setProperty("--dx", "0px");
          node.style.setProperty("--dy", "0px");
          markerIndex.current.set(id, node);
        }
      }
      for (const [key, entry] of clusterNodes.current) {
        if (live.has(key) || entry.timer) continue;
        entry.node.classList.remove("is-on");
        entry.timer = window.setTimeout(() => {
          entry.marker.remove();
          clusterNodes.current.delete(key);
        }, 320);
      }
    };
    const clusterKeyOf = (id: string) => {
      for (const key of clusterNodes.current.keys())
        if (key.split("|").includes(id)) return key;
      return "";
    };
    layoutRef.current = layout;
    layout();
    let frame = 0;
    const onZoom = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };
    m.on("zoom", onZoom);
    m.on("zoomend", layout);

    let pinMarker: maplibregl.Marker | null = null;
    if (pin) {
      const node = el(
        "location-marker-wrap",
        '<span class="location-marker"></span>',
      );
      pinMarker = add(node, pin.lng, pin.lat, { draggable: !!onPin });
      pinMarker.on("dragend", () => {
        const p = pinMarker!.getLngLat();
        callbacks.current.onPin?.({
          lat: Number(p.lat.toFixed(6)),
          lng: Number(p.lng.toFixed(6)),
        });
      });
      if (!onPin) m.jumpTo({ center: [pin.lng, pin.lat], zoom: 15 });
    }
    return () => {
      cancelAnimationFrame(frame);
      m.off("zoom", onZoom);
      m.off("zoomend", layout);
      for (const c of clusterNodes.current.values()) {
        if (c.timer) window.clearTimeout(c.timer);
        c.marker.remove();
      }
      clusterNodes.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campus.id, listings, pin?.lat, pin?.lng, !!onPin, ready]);

  // Keep the active marker in sync without rebuilding.
  useEffect(() => {
    const seen = new Set<HTMLElement>();
    for (const [id, node] of markerIndex.current) {
      const active = id === activeId;
      if (seen.has(node) && !active) continue;
      seen.add(node);
      node.classList.toggle("is-active", active);
    }
  }, [activeId, listings]);

  const recenter = () => {
    setPreview(null);
    frame(true);
  };
  const zoomBy = (delta: number) => {
    setPreview(null);
    if (delta > 0) map.current?.zoomIn({ duration: 250 });
    else map.current?.zoomOut({ duration: 250 });
  };

  const previewSave = preview ? savings(preview.listing) : null;
  const previewCard = preview && (
    <Link
      to={`/listings/${preview.listing.id}`}
      className="map-preview-card"
      onClick={() => callbacks.current.onListing?.(preview.listing.id)}
    >
      <div className="map-preview-photo">
        {preview.listing.photos[0] ? (
          <img src={preview.listing.photos[0]} alt="" />
        ) : (
          <ImageIcon size={20} strokeWidth={1.5} />
        )}
        <span className="map-preview-open">
          View
          <ArrowUpRight size={13} />
        </span>
      </div>
      <div className="map-preview-body">
        <div className="map-preview-price">
          <strong>{money(preview.listing.price)}</strong>
          <span>/mo</span>
          {previewSave && (
            <em className="savings-tag">Save {money(previewSave.amount)}</em>
          )}
        </div>
        <div className="map-preview-title">{preview.listing.title}</div>
        <div className="map-preview-meta">
          <span>
            {ROOM_LABELS[preview.listing.roomType]} ·{" "}
            {preview.listing.bedrooms === 0
              ? "Studio"
              : `${preview.listing.bedrooms} bd`}{" "}
            · {preview.listing.bathrooms} ba
          </span>
          <span>
            {dateLabel(preview.listing.availableFrom)} to{" "}
            {dateLabel(preview.listing.availableTo)} ·{" "}
            <b>{distanceLabel(milesBetween(campus, preview.listing))}</b>
          </span>
        </div>
      </div>
    </Link>
  );

  return (
    <div
      className={`map-container ${onPin ? "selectable-map" : ""} ${compact ? "compact" : ""}`}
    >
      <div
        ref={element}
        className="map-host"
        aria-label={
          onPin
            ? "Choose the listing location on the map"
            : `Map of listings near ${campus.name}`
        }
      />
      <div
        className={`map-veil ${ready ? "is-done" : ""}`}
        aria-hidden={ready}
      >
        <span className="loading-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="t-shimmer" data-text="Drawing the map…">
          Drawing the map…
        </span>
      </div>
      <div className="map-controls" aria-label="Map controls">
        <div className="map-control-group">
          <button
            type="button"
            className="map-control"
            aria-label="Zoom in"
            onClick={() => zoomBy(1)}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="map-control"
            aria-label="Zoom out"
            onClick={() => zoomBy(-1)}
          >
            <Minus size={16} />
          </button>
        </div>
        <button
          type="button"
          className="map-control solo"
          aria-label={`Recenter on ${campus.name}`}
          title={`Recenter on ${campus.name}`}
          onClick={recenter}
        >
          <LocateFixed size={16} />
        </button>
      </div>
      {!compact && (
        <div className={`map-legend ${legendOpen ? "is-open" : ""}`}>
          <button
            type="button"
            className="map-legend-toggle"
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((v) => !v)}
          >
            <Info size={14} />
            <span>Map key</span>
            <ChevronDown size={14} className="legend-chevron" />
          </button>
          <div className="map-legend-body">
            <ul>
              <li>
                <span className="legend-swatch price" aria-hidden="true">
                  $
                </span>
                <span>Monthly rent</span>
              </li>
              <li>
                <span className="legend-swatch price saving" aria-hidden="true">
                  $
                </span>
                <span>Below the original lease</span>
              </li>
              {zoomLevel < 15 && (
                <li>
                  <span className="legend-swatch cluster" aria-hidden="true">
                    3
                  </span>
                  <span>Several places, tap to zoom</span>
                </li>
              )}
              <li>
                <span className="legend-swatch campus" aria-hidden="true" />
                <span>{campus.name}</span>
              </li>
              {zone && (
                <li className={zoneVisible ? "" : "is-dim"}>
                  <span className="legend-swatch zone" aria-hidden="true" />
                  <span>DPS patrol zone</span>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
      {preview && (
        <>
          <div
            className="map-preview"
            role="dialog"
            aria-label={preview.listing.title}
            style={{ left: preview.x, top: preview.y }}
          >
            {previewCard}
          </div>
          <div
            className="map-sheet"
            role="dialog"
            aria-label={preview.listing.title}
          >
            {previewCard}
            <button
              type="button"
              className="map-sheet-close"
              aria-label="Close"
              onClick={() => setPreview(null)}
            >
              <X size={16} />
            </button>
          </div>
        </>
      )}
      {tileError && (
        <div className="map-message">
          The map could not load. Listing details are still available.
        </div>
      )}
      {onPin && (
        <div className="map-hint">Tap to place a pin. Drag it to adjust.</div>
      )}
    </div>
  );
}
