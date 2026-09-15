import type { Campus } from "../types";

export type School = { n: string; d: string[]; s: string };

let cache: School[] | null = null;
/** The US school list, loaded once when a picker or signup needs it. */
export async function loadSchools(): Promise<School[]> {
  if (cache) return cache;
  const mod = await import("../data/schools.json");
  cache = mod.default as School[];
  return cache;
}

const norm = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Rank schools for a query. Prefix and word matches first, then substrings. */
export function searchSchools(schools: School[], query: string, limit = 12) {
  const q = norm(query);
  if (!q) return schools.slice(0, limit);
  const scored: Array<[number, School]> = [];
  for (const school of schools) {
    const name = norm(school.n);
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (name.split(" ").some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 1;
    else if (school.d.some((d) => d.startsWith(q))) score = 1;
    if (score) scored.push([score, school]);
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].n.localeCompare(b[1].n))
    .slice(0, limit)
    .map(([, s]) => s);
}

export const emailDomain = (email: string) =>
  email.trim().toLowerCase().split("@")[1] || "";

/** Campuses students can pick today. Everything else is waitlist material. */
export const liveCampuses = (campuses: Campus[]) =>
  campuses.filter((c) => c.live !== false);

/**
 * Live campus for an email, matching the campus domain or a subdomain of it.
 * A campus that is not live yet never matches, so the student is offered the
 * waitlist instead of an empty campus.
 */
export function campusForEmail(email: string, campuses: Campus[]) {
  const domain = emailDomain(email);
  if (!domain) return null;
  return (
    liveCampuses(campuses).find(
      (c) => domain === c.domain || domain.endsWith(`.${c.domain}`),
    ) || null
  );
}

/** Any known US school for an email domain, supported or not. */
export function schoolForEmail(email: string, schools: School[]) {
  const domain = emailDomain(email);
  if (!domain) return null;
  return (
    schools.find((s) =>
      s.d.some((d) => domain === d || domain.endsWith(`.${d}`)),
    ) || null
  );
}
