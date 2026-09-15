import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  GraduationCap,
  MailPlus,
  Search,
  X,
} from "lucide-react";
import type { Campus } from "../types";
import { api, errorMessage } from "../lib/api";
import {
  liveCampuses,
  loadSchools,
  searchSchools,
  type School,
} from "../lib/schools";
import { Button, ErrorBox } from "./ui";

/** High resolution marks for the campuses we run, favicons are too soft. */
const BRAND_LOGOS: Record<string, string> = { usc: "/logos/usc.svg" };
/* The starting list under the search field, so the panel is never a bare
   field. Live campuses always lead, these fill the rest. */
const STARTER_SCHOOLS = [
  "University of California, Los Angeles",
  "California State University, Long Beach",
  "University of California, Berkeley",
  "New York University",
  "University of Michigan",
];

type Row = {
  key: string;
  name: string;
  domain: string;
  meta: string;
  campus: Campus | null;
  school: School | null;
  brand?: string;
};

export function SchoolLogo({ src, big = false }: { src: string; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={`school-logo ${big ? "big" : ""}`}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className={src.startsWith("/logos/") ? "brand" : ""}
        />
      ) : (
        <GraduationCap size={big ? 20 : 17} strokeWidth={1.75} />
      )}
    </span>
  );
}

/** The mark for a campus, the real brand file when we have one. */
export const campusLogo = (campus?: Campus | null) =>
  campus
    ? BRAND_LOGOS[campus.id] ||
      `/api/logo/${encodeURIComponent(campus.domain)}`
    : "";

const logoFor = (row: { domain: string; brand?: string }) =>
  row.brand || (row.domain ? `/api/logo/${encodeURIComponent(row.domain)}` : "");

/** Blue highlight over the part of the name the student has typed. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

/**
 * The school picker used by the first visit modal and the campus switch.
 * The frame never resizes, results update on every keystroke, and a school
 * we have not opened yet slides across to the waitlist form.
 */
export function SchoolSearch({
  campuses,
  current,
  onChoose,
  onClose,
}: {
  campuses: Campus[];
  current?: string;
  onChoose: (id: string) => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [schools, setSchools] = useState<School[] | null>(null);
  const [active, setActive] = useState(0);
  const [waiting, setWaiting] = useState<Row | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSchools().then(setSchools);
    const t = window.setTimeout(() => input.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  const live = useMemo(() => liveCampuses(campuses), [campuses]);
  const liveByDomain = useMemo(
    () => new Map(live.map((c) => [c.domain, c])),
    [live],
  );
  const campusRow = (campus: Campus): Row => ({
    key: `campus-${campus.id}`,
    name: campus.name,
    domain: campus.domain,
    // The domain, never an abbreviation. Schools are named in full here.
    meta: campus.domain,
    campus,
    school: null,
    brand: BRAND_LOGOS[campus.id],
  });
  const schoolRow = (school: School): Row => {
    const domain = school.d[0] || "";
    const campus = school.d
      .map((d) => liveByDomain.get(d))
      .find(Boolean) as Campus | undefined;
    if (campus) return campusRow(campus);
    return {
      key: `school-${school.n}`,
      name: school.n,
      domain,
      meta: school.s || domain,
      campus: null,
      school,
    };
  };

  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  /* Before anything is typed the panel is not empty. The live campus leads,
     then a short starting list of the schools students look for most. */
  const suggestions = useMemo<Row[]>(() => {
    const leading = live.map(campusRow);
    if (!schools) return leading;
    const seen = new Set(leading.map((r) => r.key));
    const picked: Row[] = [];
    for (const name of STARTER_SCHOOLS) {
      const hit = searchSchools(schools, name, 1)[0];
      if (!hit) continue;
      const row = schoolRow(hit);
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      picked.push(row);
      if (picked.length === 4) break;
    }
    return [...leading, ...picked];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schools, live]);
  const rows = useMemo<Row[]>(() => {
    if (!searching) return [];
    // A live campus that matches always leads, matched on its own fields so a
    // crowded query can never push it off the list.
    const needle = trimmed.toLowerCase();
    const leading = live
      .filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          c.shortName.toLowerCase().startsWith(needle) ||
          c.domain.startsWith(needle),
      )
      .map(campusRow);
    if (!schools) return leading;
    const seen = new Set(leading.map((r) => r.key));
    const rest = searchSchools(schools, trimmed, 40)
      .map(schoolRow)
      .filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
    return [...leading, ...rest].slice(0, 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schools, trimmed, searching, live]);

  const shown = searching ? rows : suggestions;
  useEffect(() => setActive(0), [trimmed]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(".school-row.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [active, shown]);

  function pick(row: Row) {
    if (row.campus) return onChoose(row.campus.id);
    setEmail("");
    setError("");
    setDone("");
    setWaiting(row);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = shown[active];
      if (row) pick(row);
      else if (trimmed) waitlistFor(trimmed);
    } else if (e.key === "Escape") {
      onClose?.();
    }
  }

  const waitlistFor = (name: string) =>
    pick({
      key: `new-${name}`,
      name,
      domain: "",
      meta: "",
      campus: null,
      school: null,
    });

  async function joinWaitlist(e: FormEvent) {
    e.preventDefault();
    if (!waiting) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ message: string }>("/waitlist", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          school: waiting.name,
          domain: waiting.domain,
        }),
      });
      setDone(result.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="school-search"
      data-view={waiting ? "waitlist" : "search"}
      onKeyDown={onKeyDown}
    >
      <div className="t-page" data-page-id="search">
        <label className="school-field">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            aria-label="Search schools"
            placeholder="Search another school"
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="icon-button clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
            >
              <X size={15} />
            </button>
          )}
        </label>
        <div
          className="school-panel"
          ref={list}
          role="listbox"
          aria-label="Schools"
        >
          <div className="school-rows" key={trimmed}>
            {!schools && <div className="school-note">Loading schools…</div>}
            {!searching && (
              <div className="school-group">Start with one of these</div>
            )}
            {schools && searching && rows.length === 0 && (
              <div className="school-empty">
                <p>No school called {trimmed} yet.</p>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => waitlistFor(trimmed)}
                >
                  <MailPlus size={15} />
                  Join the waitlist for it
                </button>
              </div>
            )}
            {shown.map((row, index) => (
              <div key={row.key} className="school-slot">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`school-row ${index === active ? "is-active" : ""}`}
                  style={
                    {
                      "--i": Math.min(index, 8),
                    } as React.CSSProperties
                  }
                  onMouseMove={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onClick={() => pick(row)}
                >
                  <SchoolLogo src={logoFor(row)} />
                  <span className="school-row-text">
                    <strong>
                      <Highlight text={row.name} query={trimmed} />
                    </strong>
                    {row.meta && <small>{row.meta}</small>}
                  </span>
                  {row.campus ? (
                    row.campus.id === current ? (
                      <Check size={17} className="school-check" />
                    ) : (
                      <span className="school-live">
                        <i aria-hidden="true" />
                        Live
                      </span>
                    )
                  ) : (
                    <span className="school-tag">Waitlist</span>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="t-page" data-page-id="waitlist" aria-hidden={!waiting}>
        <button
          type="button"
          className="school-back"
          tabIndex={waiting ? undefined : -1}
          onClick={() => {
            setWaiting(null);
            setDone("");
            setError("");
            input.current?.focus();
          }}
        >
          <ArrowLeft size={15} />
          Back to search
        </button>
        <div className="school-waitlist">
          <div className="school-waitlist-id">
            <SchoolLogo src={waiting ? logoFor(waiting) : ""} big />
            <strong>{waiting?.name || ""}</strong>
            <span className="school-soon">Opening soon</span>
          </div>
          {done ? (
            <div className="school-done">
              <span
                className="school-done-mark t-success-check"
                data-state="in"
                aria-hidden="true"
              >
                <Check size={22} />
              </span>
              <p>{done}</p>
            </div>
          ) : (
            <form onSubmit={joinWaitlist} className="school-waitlist-form">
              <p>Be first to know when Handoff opens here.</p>
              <input
                type="email"
                required
                inputMode="email"
                autoComplete="email"
                aria-label="School email"
                tabIndex={waiting ? undefined : -1}
                placeholder={`you@${waiting?.domain || "school.edu"}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {error && <ErrorBox message={error} />}
              <Button type="submit" busy={busy} tabIndex={waiting ? undefined : -1}>
                <MailPlus size={16} />
                Notify me
              </Button>
              <small>One email when it opens. Nothing else.</small>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
