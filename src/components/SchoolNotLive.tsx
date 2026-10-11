import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, MailPlus, Search } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useApp } from "../lib/context";
import { Button, ErrorBox } from "./ui";
import { SchoolLogo } from "./SchoolSearch";

/**
 * What a student sees when Handoff has not opened at their school yet. They
 * can already browse, save and request anywhere Handoff runs, so this is a
 * calm "not yet" and a waitlist, never a wall.
 */
export function SchoolNotLive({ compact = false }: { compact?: boolean }) {
  const { user } = useApp();
  const school = user?.school?.name || "your school";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function join(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ message: string }>("/waitlist", {
        method: "POST",
        body: JSON.stringify({
          email: user.email,
          school,
          domain: user.school?.domain || "",
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
    <div className={`not-live ${compact ? "compact" : ""}`}>
      <span className="not-live-mark">
        <SchoolLogo
          src={
            user?.school?.domain
              ? `/api/logo/${encodeURIComponent(user.school.domain)}`
              : ""
          }
          big
        />
      </span>
      <h1>Listing opens at {school} soon.</h1>
      <p>
        You can browse, save and request anywhere Handoff is live. When {school}{" "}
        opens you will be the first to know.
      </p>
      {error && <ErrorBox message={error} />}
      <div className="not-live-actions">
        {done ? (
          <p className="not-live-done">
            <span className="t-success-check" data-state="in" aria-hidden="true">
              <Check size={18} />
            </span>
            {done}
          </p>
        ) : (
          <form onSubmit={join}>
            <Button type="submit" busy={busy}>
              <MailPlus size={16} />
              Join the waitlist
            </Button>
          </form>
        )}
        <Link className="button secondary" to="/browse">
          <Search size={16} />
          Browse listings
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
