import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, GraduationCap, MailPlus, Search, X } from "lucide-react";
import type { Campus } from "../types";
import { api, errorMessage } from "../lib/api";
import { loadSchools, searchSchools, type School } from "../lib/schools";
import { Button, ErrorBox } from "./ui";

/**
 * Search every US school. Supported campuses open right away, the rest take
 * an email for the waitlist.
 */
export function CampusPicker({
  campuses,
  current,
  onChoose,
}: {
  campuses: Campus[];
  current?: string;
  onChoose: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [schools, setSchools] = useState<School[] | null>(null);
  const [waiting, setWaiting] = useState<School | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    loadSchools().then(setSchools);
    const t = window.setTimeout(() => input.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, []);
  const supportedDomains = useMemo(
    () => new Map(campuses.map((c) => [c.domain, c])),
    [campuses],
  );
  const supported = (school: School) =>
    school.d.map((d) => supportedDomains.get(d)).find(Boolean) || null;
  const live = useMemo(
    () => campuses.map((c) => ({ n: c.name, d: [c.domain], s: "" })),
    [campuses],
  );
  const searching = query.trim().length > 0;
  const results = useMemo(() => {
    if (!schools || !searching) return live;
    // Live campuses that match come first, then the closest other schools.
    const found = searchSchools(schools, query, 40);
    const open = found.filter((s) => supported(s));
    const rest = found.filter((s) => !supported(s));
    return [...open, ...rest].slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schools, query, searching, live]);

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
          school: waiting.n,
          domain: waiting.d[0] || "",
        }),
      });
      setDone(result.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (waiting) {
    return (
      <div className="campus-waitlist">
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setWaiting(null);
            setDone("");
            setError("");
          }}
        >
          <X size={14} /> Back to search
        </button>
        <div className="campus-waitlist-head">
          <span className="campus-icon">
            <GraduationCap size={16} />
          </span>
          <div>
            <strong>{waiting.n}</strong>
            <small>Handoff is not open here yet</small>
          </div>
        </div>
        {done ? (
          <div className="notice">
            <Check size={18} />
            <div>{done}</div>
          </div>
        ) : (
          <form onSubmit={joinWaitlist} className="stack">
            <p className="muted">
              Leave your school email and we will let you know the moment
              students at {waiting.n} can list and browse.
            </p>
            <label className="field">
              <span className="field-label">School email</span>
              <input
                type="email"
                required
                inputMode="email"
                autoComplete="email"
                placeholder={`you@${waiting.d[0] || "school.edu"}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error && <ErrorBox message={error} />}
            <Button type="submit" busy={busy}>
              <MailPlus size={16} />
              Notify me
            </Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="campus-picker">
      <label className="search-field campus-search">
        <Search size={17} />
        <input
          ref={input}
          aria-label="Search schools"
          placeholder="Search any school"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="icon-button clear"
            aria-label="Clear"
            onClick={() => setQuery("")}
          >
            <X size={15} />
          </button>
        )}
      </label>
      {!searching && <div className="campus-group-label">Live now</div>}
      <div className="campus-results" role="listbox" aria-label="Schools">
        {searching && !schools && (
          <div className="muted campus-hint">Loading schools…</div>
        )}
        {searching && schools && results.length === 0 && (
          <div className="muted campus-hint">
            Nothing matches. Try the full name or the email domain.
          </div>
        )}
        {results.map((school) => {
          const campus = supported(school);
          return (
            <button
              key={school.n}
              type="button"
              role="option"
              aria-selected={!!campus && campus.id === current}
              className="campus-option"
              onClick={() => (campus ? onChoose(campus.id) : setWaiting(school))}
            >
              <span className="campus-icon">
                <GraduationCap size={15} />
              </span>
              <span className="campus-option-text">
                <strong>{school.n}</strong>
              </span>
              {campus ? (
                campus.id === current ? (
                  <Check size={16} className="campus-check" />
                ) : (
                  <ArrowRight size={15} className="campus-arrow" />
                )
              ) : (
                <span className="campus-waitlist-tag">Waitlist</span>
              )}
            </button>
          );
        })}
      </div>
      {!searching && (
        <p className="campus-foot">
          Not at one of these? Search your school above and we will let you
          know when Handoff opens there.
        </p>
      )}
    </div>
  );
}
