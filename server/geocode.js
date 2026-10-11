// Address lookup for the listing editor. Runs on the server so the browser
// never talks to a third party and the CSP stays tight.
//
// Two free sources. The US Census geocoder resolves street numbers precisely
// (interpolated along the block) but knows nothing about building names.
// Nominatim (OpenStreetMap) fills that gap for named apartments and campus
// buildings, bounded to the campus area. Both are queried only when a lister
// finishes typing, never per keystroke, which keeps us inside their policies.
const CACHE = new Map();
const TTL = 10 * 60 * 1000;
const CENSUS =
  process.env.HANDOFF_CENSUS_URL ||
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const NOMINATIM =
  process.env.HANDOFF_NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";
const UA = "Handoff/1.0 (hello@handofflease.com)";

const SMALL = new Set(["of", "and", "the", "at", "on", "de", "la"]);
const KEEP = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
export function titleCase(text) {
  return text
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      const up = w.toUpperCase();
      if (KEEP.has(up)) return up;
      if (i && SMALL.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function looksLikeStreet(q) {
  return /^\d+\s+\S/.test(q.trim());
}

async function census(query, campus, fetchImpl) {
  if (!looksLikeStreet(query)) return [];
  const hasPlace = /,/.test(query) || /\b[A-Z]{2}\b\s*\d{5}?$/.test(query.trim());
  const address = hasPlace ? query : `${query}, ${campus.city}, ${campus.state}`;
  const url = new URL(CENSUS);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const r = await fetchImpl(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`geocoder ${r.status}`);
  const body = await r.json();
  return (body.result?.addressMatches || []).slice(0, 5).map((m) => {
    const parts = m.matchedAddress.split(",").map((p) => p.trim());
    const city = parts[1] ? titleCase(parts[1]) : campus.city;
    const state = (parts[2] || campus.state).trim();
    return {
      line: titleCase(parts[0]),
      place: `${city}, ${state}`,
      lat: Number(m.coordinates.y),
      lng: Number(m.coordinates.x),
      source: "census",
    };
  });
}

async function nominatim(query, campus, fetchImpl) {
  const url = new URL(NOMINATIM);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set(
    "viewbox",
    `${campus.lng - 0.35},${campus.lat + 0.3},${campus.lng + 0.35},${campus.lat - 0.3}`,
  );
  url.searchParams.set("bounded", "1");
  const r = await fetchImpl(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`geocoder ${r.status}`);
  const body = await r.json();
  const seen = new Set();
  const out = [];
  for (const row of body) {
    const a = row.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    const line = row.name || street || (row.display_name || "").split(",")[0];
    if (!line) continue;
    const locality = a.neighbourhood || a.suburb || a.city || a.town || "";
    const place = [locality, a.city && a.city !== locality ? a.city : "", a.state || ""]
      .filter(Boolean)
      .join(", ");
    const key = `${line}|${place}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ line, place, lat: Number(row.lat), lng: Number(row.lon), source: "osm" });
  }
  const d2 = (r) => (r.lat - campus.lat) ** 2 + ((r.lng - campus.lng) * 0.83) ** 2;
  return out.sort((a, b) => d2(a) - d2(b));
}

export async function geocode(query, campus, fetchImpl = fetch) {
  const key = `${campus.id}|${query.trim().toLowerCase()}`;
  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.results;
  let results = await census(query, campus, fetchImpl);
  if (!results.length) results = await nominatim(query, campus, fetchImpl);
  CACHE.set(key, { results, expires: Date.now() + TTL });
  if (CACHE.size > 2000) CACHE.delete(CACHE.keys().next().value);
  return results;
}
