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

/** A curated first page so an empty query still reads like a real list. */
const FEATURED = [
  "University of California, Los Angeles",
  "Loyola Marymount University",
  "California State University, Long Beach",
  "California State University, Los Angeles",
  "Pepperdine University",
  "Chapman University",
  "University of California, Berkeley",
  "University of California, San Diego",
  "Stanford University",
  "Santa Clara University",
  "New York University",
  "Boston University",
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
    meta: campus.shortName,
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
  const rows = useMemo<Row[]>(() => {
    if (!searching) {
      const featured = (schools || [])
        .filter((s) => FEATURED.includes(s.n))
        .sort((a, b) => FEATURED.indexOf(a.n) - FEATURED.indexOf(b.n));
      return [...live.map(campusRow), ...featured.map(schoolRow)];
    }
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

  const liveCount = searching ? 0 : live.length;
  useEffect(() => setActive(0), [trimmed]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(".school-row.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [active, rows]);

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
      if (!rows.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
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
            placeholder="Search any school"
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
            {schools && rows.length === 0 && (
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
            {rows.map((row, index) => (
              <div key={row.key} className="school-slot">
                {!searching && index === 0 && (
                  <div className="school-group">Live now</div>
                )}
                {!searching && index === liveCount && (
                  <div className="school-group">More schools</div>
                )}
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
        <div className="school-waitlist-head">
          <button
            type="button"
            className="icon-button"
            aria-label="Back to search"
            tabIndex={waiting ? undefined : -1}
            onClick={() => {
              setWaiting(null);
              setDone("");
              setError("");
              input.current?.focus();
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <SchoolLogo src={waiting ? logoFor(waiting) : ""} big />
          <span className="school-waitlist-name">
            <strong>{waiting?.name || ""}</strong>
            <small>Handoff is not open here yet</small>
          </span>
        </div>
        <div className="school-panel plain">
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
            <form onSubmit={joinWaitlist} className="stack">
              <p className="muted">
                Leave your school email and we will tell you the moment students
                at {waiting?.name || "your school"} can list and browse.
              </p>
              <label className="field">
                <span className="field-label">School email</span>
                <input
                  type="email"
                  required
                  inputMode="email"
                  autoComplete="email"
                  tabIndex={waiting ? undefined : -1}
                  placeholder={`you@${waiting?.domain || "school.edu"}`}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {error && <ErrorBox message={error} />}
              <Button type="submit" busy={busy} tabIndex={waiting ? undefined : -1}>
                <MailPlus size={16} />
                Notify me
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
