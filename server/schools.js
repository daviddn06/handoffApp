// The US school list is the single source of truth for who may sign up. The
// client ships the same file, so a student sees the same school name the
// server recorded. A school being known is not the same as Handoff being open
// there: CAMPUSES decides that, and only a live campus grants posting.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAMPUSES } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
/** [{n: name, d: [domains], s: state}] */
export const SCHOOLS = JSON.parse(
  readFileSync(join(here, "../src/data/schools.json"), "utf8"),
);

const byDomain = new Map();
for (const school of SCHOOLS)
  for (const domain of school.d)
    if (!byDomain.has(domain)) byDomain.set(domain, school);

export const emailDomain = (address) =>
  String(address || "")
    .trim()
    .toLowerCase()
    .split("@")[1] || "";

/**
 * Walk up the domain so alumni.usc.edu and g.ucla.edu resolve to their school.
 * Walking beats a suffix scan: usc.edu.evil.example never matches usc.edu.
 */
export function schoolForDomain(domain) {
  const clean = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!clean) return null;
  const labels = clean.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const school = byDomain.get(candidate);
    if (school) return { name: school.n, domain: candidate };
  }
  return null;
}

export const schoolForEmail = (address) =>
  schoolForDomain(emailDomain(address));

/** The live campus a student may post at, or null when theirs is not open. */
export function liveCampusForDomain(domain) {
  const clean = String(domain || "")
    .trim()
    .toLowerCase();
  if (!clean) return null;
  return (
    CAMPUSES.find(
      (campus) =>
        campus.live !== false &&
        (clean === campus.domain || clean.endsWith(`.${campus.domain}`)),
    ) || null
  );
}

export const liveCampusForEmail = (address) =>
  liveCampusForDomain(emailDomain(address));

/** The first campus students can use today, the app wide default. */
export const firstLiveCampus = () =>
  CAMPUSES.find((campus) => campus.live !== false) || CAMPUSES[0];
