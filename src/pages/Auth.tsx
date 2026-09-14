import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  GraduationCap,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { api, errorMessage, json, safeNext } from "../lib/api";
import { useApp } from "../lib/context";
import { Button, ErrorBox, Field, Loading } from "../components/ui";
import type { User } from "../types";
type Mode =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "reset-password"
  | "verify";
export default function Auth({ mode }: { mode: Mode }) {
  const { user, setUser, campuses, emailReady, notify } = useApp(),
    navigate = useNavigate(),
    [params] = useSearchParams();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [campusId, setCampusId] = useState(campuses[0]?.id || "usc"),
    [showPassword, setShowPassword] = useState(false);
  const verifiedToken = useRef("");
  const next = safeNext(params.get("next"));
  useEffect(() => {
    setError("");
    setSuccess("");
    setPassword("");
    setBusy(false);
  }, [mode]);
  useEffect(() => {
    if (mode !== "verify") return;
    const token = params.get("token");
    if (!token) {
      setError(
        "This verification link is missing its token. Request a new link below.",
      );
      return;
    }
    if (verifiedToken.current === token) return;
    verifiedToken.current = token;
    setBusy(true);
    api<{ user: User }>("/auth/verify", {
      method: "POST",
      body: json({ token }),
    })
      .then((r) => {
        setUser(r.user);
        setSuccess(
          "Your student email is verified. You’re ready to find a place or list your own.",
        );
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  }, [mode, params, setUser]);
  const campus = campuses.find((c) => c.id === campusId);
  const resetToken = params.get("token");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "sign-in") {
        const r = await api<{ user: User }>("/auth/login", {
          method: "POST",
          body: json({ email, password }),
        });
        setUser(r.user);
        navigate(next, { replace: true });
        notify("Welcome back.");
      } else if (mode === "sign-up") {
        const r = await api<{ message: string }>("/auth/signup", {
          method: "POST",
          body: json({ name, email, password, campusId }),
        });
        setSuccess(r.message);
      } else if (mode === "forgot-password") {
        const r = await api<{ message: string }>("/auth/forgot", {
          method: "POST",
          body: json({ email }),
        });
        setSuccess(r.message);
      } else if (mode === "reset-password") {
        const r = await api<{ message: string }>("/auth/reset", {
          method: "POST",
          body: json({ token: resetToken, password }),
        });
        setUser(null);
        setSuccess(r.message);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function resend(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ message: string }>("/auth/resend", {
        method: "POST",
        body: json({ email }),
      });
      setSuccess(r.message);
      notify(r.message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const titles = {
    "sign-in": "Welcome back.",
    "sign-up": "Your campus. Your next place.",
    "forgot-password": "Let’s get you back in.",
    "reset-password": "A fresh start.",
    verify: "Make it official.",
  };
  const descriptions = {
    "sign-in": "Sign in to pick up where you left off.",
    "sign-up": "A student email is all it takes to get started.",
    "forgot-password": "We’ll send a link to reset your password.",
    "reset-password": "Choose a new password for your Handoff account.",
    verify: "We’re confirming your student email.",
  };
  if (user && (mode === "sign-in" || mode === "sign-up"))
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-symbol">
            <Check size={27} />
          </div>
          <h1>You’re already signed in.</h1>
          <p className="muted">Welcome, {user.name.split(" ")[0]}.</p>
          <Link className="button primary full-width" to={next}>
            Continue to Handoff
            <ArrowRight size={17} />
          </Link>
        </div>
      </div>
    );
  return (
    <div className="auth-page">
      <div className="auth-aside">
        <div className="eyebrow">A little closer to home</div>
        <h2>
          Your next chapter
          <br />
          starts here.
        </h2>
        <p>Find a place near campus. Or pass yours on to the next student.</p>
        <div className="auth-principles">
          <div>
            <GraduationCap size={20} />
            <span>Connect through your campus</span>
          </div>
          <div>
            <ShieldCheck size={20} />
            <span>Verify your student email</span>
          </div>
          <div>
            <Mail size={20} />
            <span>Share contact details when you’re ready</span>
          </div>
        </div>
        <Link to="/browse" className="back-link">
          <ArrowLeft size={16} />
          Keep exploring
        </Link>
      </div>
      <section className="auth-card">
        <div className="auth-symbol">
          {success ? (
            <Check size={25} />
          ) : mode === "sign-up" ? (
            <GraduationCap size={25} />
          ) : (
            <Mail size={24} />
          )}
        </div>
        <h1>
          {success
            ? mode === "reset-password"
              ? "Password updated."
              : mode === "verify"
                ? "You’re verified."
                : "Check your inbox."
            : titles[mode]}
        </h1>
        <p className="auth-description">{success || descriptions[mode]}</p>
        {error && <ErrorBox message={error} />}{" "}
        {mode === "verify" ? (
          <>
            {busy ? (
              <Loading label="Verifying your email…" />
            ) : user ? (
              <Link className="button primary full-width" to="/browse">
                Find your place
                <ArrowRight size={17} />
              </Link>
            ) : (
              <form onSubmit={resend} className="auth-form">
                <Field label="Student email">
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@usc.edu"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Button type="submit" busy={busy}>
                  Send a new verification link
                </Button>
              </form>
            )}
          </>
        ) : success ? (
          <div className="auth-success">
            {mode === "sign-up" && (
              <>
                <p>
                  Open the link in your email to verify your account. If it’s
                  not there, check your spam folder.
                </p>
                <Button
                  variant="secondary"
                  className="full-width"
                  onClick={() => resend()}
                  busy={busy}
                >
                  Resend verification email
                </Button>
              </>
            )}
            <Link to="/sign-in" className="button primary full-width">
              Back to sign in
              <ArrowRight size={17} />
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="auth-form">
            {mode === "sign-up" && (
              <>
                <Field label="Your name">
                  <input
                    name="name"
                    autoComplete="name"
                    minLength={2}
                    maxLength={80}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="First and last name"
                  />
                </Field>
                <Field label="Your campus">
                  <select
                    value={campusId}
                    onChange={(e) => setCampusId(e.target.value)}
                  >
                    {campuses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {mode !== "reset-password" && (
              <Field
                label="Student email"
                hint={
                  mode === "sign-up"
                    ? `Use your @${campus?.domain || "usc.edu"} email. We’ll send you a verification link.`
                    : undefined
                }
              >
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={`you@${campus?.domain || "usc.edu"}`}
                />
              </Field>
            )}
            {(mode === "sign-in" ||
              mode === "sign-up" ||
              mode === "reset-password") && (
              <Field
                label={mode === "reset-password" ? "New password" : "Password"}
                hint={
                  mode !== "sign-in"
                    ? "At least 10 characters. Make it something only you know."
                    : undefined
                }
              >
                <div className="password-input">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      mode === "sign-in" ? "current-password" : "new-password"
                    }
                    required
                    minLength={mode === "sign-in" ? 1 : 10}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
            )}
            {mode === "sign-in" && (
              <Link to="/forgot-password" className="forgot-link">
                Forgot password?
              </Link>
            )}
            {!emailReady &&
              (mode === "sign-up" || mode === "forgot-password") && (
                <ErrorBox message="Email delivery is temporarily unavailable. Please check back soon." />
              )}
            {mode === "reset-password" && !resetToken && (
              <ErrorBox message="This reset link is incomplete. Request a new link from the forgot password page." />
            )}
            <Button
              type="submit"
              busy={busy}
              disabled={
                (!emailReady &&
                  (mode === "sign-up" || mode === "forgot-password")) ||
                (mode === "reset-password" && !resetToken)
              }
            >
              {mode === "sign-in"
                ? "Sign in"
                : mode === "sign-up"
                  ? "Create your account"
                  : mode === "forgot-password"
                    ? "Send reset link"
                    : "Update password"}
              <ArrowRight size={17} />
            </Button>
            {mode === "sign-up" && (
              <p className="auth-fineprint">
                Use Handoff to connect with students. Confirm the lease and
                property details together before committing.
              </p>
            )}
          </form>
        )}
        {!success && (mode === "sign-in" || mode === "sign-up") && (
          <div className="auth-switch">
            {mode === "sign-in" ? (
              <>
                New to Handoff?{" "}
                <Link to={`/sign-up?next=${encodeURIComponent(next)}`}>
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link to={`/sign-in?next=${encodeURIComponent(next)}`}>
                  Sign in
                </Link>
              </>
            )}
          </div>
        )}
        {mode === "sign-in" && error.toLowerCase().includes("verif") && (
          <button
            className="text-button resend-inline"
            onClick={() => resend()}
            disabled={busy}
          >
            Resend verification email
          </button>
        )}
      </section>
    </div>
  );
}
