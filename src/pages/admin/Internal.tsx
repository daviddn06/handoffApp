/**
 * The internal surface. On internal.handofflease.com the same bundle drops the
 * whole student app and mounts the dashboard at the root with its own small
 * chrome: a wordmark, the Internal tag, who is signed in, and Sign out. No
 * header, no tab bar, no auth modal, no campus picker.
 *
 * Only an account on HANDOFF_ADMIN_EMAILS can sign in here. The server refuses
 * anybody else at login and answers 404 for every /api/admin call, so the
 * guards below are a second line, never the only one.
 */
import { useEffect, useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";
import { useApp } from "../../lib/context";
import { api, errorMessage } from "../../lib/api";
import { Button, ErrorBox, Field, Loading } from "../../components/ui";
import type { User } from "../../types";
import Admin from "./Admin";
import "../../styles/admin.css";

function InternalBar() {
  const { user, setUser, notify } = useApp();
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setSigningOut(false);
    }
  }
  return (
    <header className="internal-bar">
      <div className="internal-bar-inner">
        <span className="brand internal-brand">Handoff</span>
        <span className="internal-tag">Internal</span>
        {user && (
          <div className="internal-identity">
            <span className="internal-email">{user.email}</span>
            <button
              className="internal-signout"
              onClick={signOut}
              disabled={signingOut}
            >
              <LogOut size={15} />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

/** One centered card. No signup, no recovery, nothing a student would need. */
function InternalSignIn() {
  const { setUser } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setUser(result.user);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="internal-signin">
      <form className="internal-card" onSubmit={submit}>
        <h1>Handoff internal</h1>
        <p>This sign in is for the Handoff team.</p>
        {error && <ErrorBox message={error} />}
        <Field label="Email">
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" busy={busy}>
          Team sign in
        </Button>
      </form>
    </main>
  );
}

/** Login refuses an unlisted account, so this is a guard that never fires. */
function InternalNotFound() {
  return (
    <main className="internal-signin">
      <div className="internal-card">
        <h1>Not found</h1>
        <p>There is nothing here.</p>
      </div>
    </main>
  );
}

export default function Internal() {
  const { user, loading, error, retry } = useApp();
  useEffect(() => {
    document.title = "Handoff internal";
  }, []);
  if (loading) return <Loading label="Loading…" />;
  if (error)
    return (
      <main className="internal-signin">
        <div className="internal-card">
          <ErrorBox message={error} retry={retry} />
        </div>
      </main>
    );
  if (!user) return <InternalSignIn />;
  return (
    <>
      <InternalBar />
      {user.isAdmin ? <Admin /> : <InternalNotFound />}
    </>
  );
}
