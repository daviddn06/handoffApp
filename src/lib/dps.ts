// USC Department of Public Safety, University Park Campus patrol zone.
// USC Housing's published map coordinates, checked against the DPS route
// on 2026-09-14. Follow the street angles, including the bend at 39th/Flower.
// https://housing.usc.edu/index.php/interactive-map/ (layers.dps)
// https://dps.usc.edu/patrol/
// Clockwise [latitude, longitude] points, starting at Vermont/Exposition.
// Map.tsx closes the ring. This is a published map trace, not a surveyed boundary.
export const DPS_UPC_PATROL_ZONE: Array<[number, number]> = [
  [34.018245, -118.29154], // Vermont and Exposition
  [34.0181769, -118.300148], // Exposition and Normandie
  [34.0327257, -118.3002498], // Normandie and Adams
  [34.0327585, -118.2915503], // Adams and Vermont
  [34.0360137, -118.2915443], // Vermont and 22nd
  [34.0361297, -118.2839933], // 22nd and Hoover
  [34.039673, -118.284225], // Hoover and Washington
  [34.0326254, -118.2683401], // Washington and Grand
  [34.0202593, -118.2762148], // Grand and Jefferson
  [34.0196599, -118.2748907], // Jefferson and Hill
  [34.0162656, -118.2770767], // Hill and 37th
  [34.016605, -118.2784478], // 37th and Grand
  [34.013665, -118.2803281], // Grand and 39th
  [34.013983, -118.281535], // 39th bends at Flower
  [34.0140467, -118.2827857], // 39th and Figueroa
  [34.0111471, -118.2827192], // Figueroa and MLK Jr
  [34.0108634, -118.2915094], // MLK and Vermont
];

/** Patrol zones keyed by campus id. USC's UPC boundary is currently configured. */
export const PATROL_ZONES: Record<
  string,
  { label: string; points: Array<[number, number]> }
> = {
  usc: { label: "USC DPS patrol zone", points: DPS_UPC_PATROL_ZONE },
};

const EARTH_MILES = 3958.8;
export function milesBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat),
    dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(h));
}
/** "0.6 mi" style distance. */
export function distanceLabel(miles: number) {
  if (miles < 0.1) return "On campus";
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}
/**
 * Rough door to door time from campus. Walking pace of 3 mph up to a mile
 * and a half, then city driving at about 20 mph plus time to park.
 */
export function travelLabel(miles: number) {
  if (miles < 0.1) return "On campus";
  if (miles <= 1.5) return `${Math.max(2, Math.round(miles * 20))} min walk`;
  return `${Math.round(miles * 3 + 4)} min drive`;
}
/** "0.6 mi · 12 min walk" for cards, "12 min walk" alone when space is tight. */
export function tripLabel(miles: number, short = false) {
  if (miles < 0.1) return "On campus";
  return short ? travelLabel(miles) : `${distanceLabel(miles)} · ${travelLabel(miles)}`;
}

export type MapBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};
export const inBounds = (b: MapBounds, lat: number, lng: number) =>
  lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west;
