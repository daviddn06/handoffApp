// USC Department of Public Safety, University Park Campus patrol zone.
// Boundary walks clockwise from Vermont Ave and Exposition Blvd, following
// the published patrol map (dps.usc.edu/patrol). Coordinates are street
// intersections from OpenStreetMap centerlines, accurate to about 5 m.
export const DPS_UPC_PATROL_ZONE: Array<[number, number]> = [
  [34.0181, -118.2912], // Vermont and Exposition
  [34.0181, -118.3008], // Exposition and Normandie
  [34.0327, -118.3008], // Normandie and Adams
  [34.0327, -118.2912], // Adams and Vermont
  [34.0364, -118.2912], // Vermont and 22nd
  [34.0364, -118.2845], // 22nd and Hoover
  [34.0394, -118.2845], // Hoover and Washington
  [34.0394, -118.2728], // Washington and Grand
  [34.0257, -118.2728], // Grand and Jefferson
  [34.0257, -118.2614], // Jefferson and Hill
  [34.0207, -118.2614], // Hill and 37th
  [34.0207, -118.2728], // 37th and Grand
  [34.0182, -118.2728], // Grand and 39th
  [34.0182, -118.2783], // 39th and Figueroa
  [34.0119, -118.2783], // Figueroa and MLK Jr
  [34.0119, -118.2912], // MLK and Vermont
];

/** Patrol zones keyed by campus id. Only USC publishes one today. */
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
export function distanceLabel(miles: number) {
  if (miles < 0.1) return "On campus";
  if (miles < 1) return `${Math.round(miles * 20) * 1} min walk`;
  return `${miles.toFixed(1)} mi`;
}

export type MapBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};
export const inBounds = (b: MapBounds, lat: number, lng: number) =>
  lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west;
