import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Campus, Listing } from "../types";
import { money } from "../lib/api";
type Props = {
  campus: Campus;
  listings?: Listing[];
  onListing?: (id: string) => void;
  pin?: { lat: number; lng: number };
  onPin?: (point: { lat: number; lng: number }) => void;
};
export default function Map({
  campus,
  listings = [],
  onListing,
  pin,
  onPin,
}: Props) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    markers = useRef<L.LayerGroup | null>(null);
  const [tileError, setTileError] = useState(false);
  const pinCallback = useRef(onPin);
  pinCallback.current = onPin;
  useEffect(() => {
    if (!element.current) return;
    const m = L.map(element.current, {
      zoomControl: false,
      scrollWheelZoom: false,
    }).setView([campus.lat, campus.lng], 14);
    map.current = m;
    L.control.zoom({ position: "bottomright" }).addTo(m);
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      },
    ).addTo(m);
    tiles.on("tileerror", () => setTileError(true));
    tiles.on("tileload", () => setTileError(false));
    markers.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) =>
      pinCallback.current?.({
        lat: Number(e.latlng.lat.toFixed(6)),
        lng: Number(e.latlng.lng.toFixed(6)),
      }),
    );
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    map.current.setView([campus.lat, campus.lng], 14);
  }, [campus.id, campus.lat, campus.lng]);
  useEffect(() => {
    const layer = markers.current,
      m = map.current;
    if (!layer || !m) return;
    layer.clearLayers();
    const campusIcon = L.divIcon({
      className: "campus-marker",
      html: '<span aria-hidden="true">⌂</span>',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    L.marker([campus.lat, campus.lng], {
      icon: campusIcon,
      title: campus.name,
      keyboard: true,
    })
      .bindTooltip(campus.name, { direction: "top" })
      .addTo(layer);
    for (const item of listings) {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
      const icon = L.divIcon({
        className: "price-marker",
        html: `<span>${money(item.price)}</span>`,
        iconSize: [74, 34],
        iconAnchor: [37, 17],
      });
      L.marker([item.lat, item.lng], {
        icon,
        title: `${item.title}, ${money(item.price)} per month`,
        keyboard: true,
      })
        .on("click", () => onListing?.(item.id))
        .addTo(layer);
    }
    if (pin) {
      const icon = L.divIcon({
        className: "location-marker",
        html: "<span></span>",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marker = L.marker([pin.lat, pin.lng], {
        icon,
        title: "Listing location",
        draggable: !!onPin,
      }).addTo(layer);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        pinCallback.current?.({
          lat: Number(p.lat.toFixed(6)),
          lng: Number(p.lng.toFixed(6)),
        });
      });
      if (!onPin) m.setView([pin.lat, pin.lng], 15);
    }
  }, [campus, listings, pin?.lat, pin?.lng, onListing, !!onPin]);
  return (
    <div className={`map-container ${onPin ? "selectable-map" : ""}`}>
      <div
        ref={element}
        className="leaflet-host"
        aria-label={
          onPin
            ? "Choose the listing location on the map"
            : `Map of listings near ${campus.name}`
        }
      />
      {tileError && (
        <div className="map-message">
          Map tiles couldn’t load. Listing details are still available.
        </div>
      )}
      {onPin && (
        <div className="map-hint">Click to place a pin. Drag it to adjust.</div>
      )}
    </div>
  );
}
