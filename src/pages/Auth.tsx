import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  GraduationCap,
} from "lucide-react";
import { api, errorMessage, json, safeNext } from "../lib/api";
import { useApp } from "../lib/context";
import { Button, ErrorBox, Field, Loading } from "../components/ui";
import type { Campus, User } from "../types";
type Mode =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "reset-password"
  | "verify";

const STEPS = 3;

function SuccessCheck() {
  const path = useRef<SVGPathElement>(null);
  useEffect(() => {
    const p = path.current;
    if (!p) return;
    const len = Math.ceil(p.getTotalLength());
    p.style.strokeDasharray = String(len);
    p.style.strokeDashoffset = String(len);
  }, []);
  return (
    <span className="auth-check t-success-check" data-state="in">
      <svg viewBox="0 0 48 48" width="26" height="26" fill="none">
        <path
          ref={path}
          d="M13 24.5 20.5 32 35 17"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** The real app in the right column, same origin so it renders locally. */
function Preview() {
  const [ready, setReady] = useState(false);
  return (
    <aside className="auth-preview">
      <div className="auth-preview-frame">
        <iframe
          src="/browse?embed=1&campusId=usc"
          title="Handoff preview"
          loading="lazy"
          className={ready ? "is-ready" : ""}
          onLoad={() => setReady(true)}
        />
        <span className="auth-preview-pill">Live listings near USC</span>
      </div>
    </aside>
  );
}

/** Six digit code entry. Auto advances, accepts a paste, numeric on mobile. */
function OtpInput({
  digits,
  setDigits,
  disabled,
}: {
  digits: string[];
  setDigits: (next: string[]) => void;
  disabled?: boolean;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const focusAt = (index: number) => {
    const box = boxes.current[Math.max(0, Math.min(5, index))];
    box?.focus();
    box?.select();
  };
  function change(index: number, raw: string) {
    const typed = raw.replace(/\D/g, "");
    const next = [...digits];
    if (!typed) {
      next[index] = "";
      setDigits(next);
      return;
    }
    let cursor = index;
    for (const character of typed) {
      if (cursor > 5) break;
      next[cursor] = character;
      cursor += 1;
    }
    setDigits(next);
    focusAt(cursor);
  }
  function keyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = "";
      setDigits(next);
      focusAt(index - 1);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAt(index - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAt(index + 1);
    }
  }
  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!text) return;
    event.preventDefault();
    const next = ["", "", "", "", "", ""];
    text
      .slice(0, 6)
      .split("")
      .forEach((character, index) => {
        next[index] = character;
      });
    setDigits(next);
    focusAt(Math.min(text.length, 5));
  }
  return (
    <div className="auth-otp" role="group" aria-label="Six digit code">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            boxes.current[index] = node;
          }}
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          autoFocus={index === 0}
          aria-label={`Digit ${index + 1}`}
          onChange={(e) => change(index, e.target.value)}
          onKeyDown={(e) => keyDown(index, e)}
          onPaste={paste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

function campusFor(email: string, campuses: Campus[]) {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  return (
    campuses.find(
      (c) => domain === c.domain || domain.endsWith(`.${c.domain}`),
    ) || null
  );
}

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
    [campusId, setCampusId] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [shake, setShake] = useState(0),
    [step, setStep] = useState(1),
    [signedUp, setSignedUp] = useState(false),
    [verified, setVerified] = useState(false),
    [digits, setDigits] = useState(["", "", "", "", "", ""]),
    [cooldown, setCooldown] = useState(0);
  const verifiedToken = useRef("");
  const shakeRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const [slideHeight, setSlideHeight] = useState<number>();
  const next = safeNext(params.get("next"));
  const resetToken = params.get("token");
  const code = digits.join("");
  const detected = campusFor(email, campuses);
  const campus =
    campuses.find((c) => c.id === campusId) || detected || campuses[0];
  const domains = campuses.map((c) => c.domain).join(", ");

  useEffect(() => {
    setError("");
    setSuccess("");
    setPassword("");
    setBusy(false);
    setStep(1);
    setSignedUp(false);
  }, [mode]);
  useEffect(() => {
    if (detected) setCampusId(detected.id);
  }, [detected]);
  useEffect(() => {
    if (!shake) return;
    const el = shakeRef.current;
    if (!el) return;
    el.classList.remove("is-shaking");
    void el.offsetWidth;
    el.classList.add("is-shaking");
    const t = window.setTimeout(() => el.classList.remove("is-shaking"), 320);
    return () => window.clearTimeout(t);
  }, [shake]);
  useEffect(() => {
    if (!cooldown) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  /* The email link lands here with a token. Verify it and sign the student in. */
  useEffect(() => {
    if (mode !== "verify") return;
    const token = params.get("token");
    if (!token) return;
    if (verifiedToken.current === token) return;
    verifiedToken.current = token;
    setBusy(true);
    api<{ user: User }>("/auth/verify", { method: "POST", body: json({ token }) })
      .then((r) => {
        setUser(r.user);
        setVerified(true);
      })
      .catch((e) => {
        setError(errorMessage(e));
        setShake((s) => s + 1);
      })
      .finally(() => setBusy(false));
  }, [mode, params, setUser]);

  const failed = useCallback((e: unknown) => {
    setError(errorMessage(e));
    setShake((s) => s + 1);
  }, []);

  const submitCode = useCallback(
    async (value: string) => {
      setBusy(true);
      setError("");
      try {
        const r = await api<{ user: User }>("/auth/verify-code", {
          method: "POST",
          body: json({ code: value }),
        });
        setUser(r.user);
        setVerified(true);
        notify("Your student email is verified.");
      } catch (e) {
        setError(errorMessage(e));
        setShake((s) => s + 1);
        setDigits(["", "", "", "", "", ""]);
      } finally {
        setBusy(false);
      }
    },
    [notify, setUser],
  );
  useEffect(() => {
    if (code.length === 6 && !busy && !verified) submitCode(code);
  }, [code, busy, verified, submitCode]);

  async function resend(address = email) {
    if (!address) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ message: string }>("/auth/resend", {
        method: "POST",
        body: json({ email: address }),
      });
      setCooldown(30);
      notify(r.message);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }

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
        if (r.user.verified) {
          navigate(next, { replace: true });
          notify("Welcome back.");
        }
      } else if (mode === "sign-up") {
        const r = await api<{ user: User | null; message: string }>(
          "/auth/signup",
          {
            method: "POST",
            body: json({
              name,
              email,
              password,
              campusId: campus?.id || campusId,
            }),
          },
        );
        if (r.user) {
          setUser(r.user);
          setSignedUp(true);
          setCooldown(30);
        } else {
          setSuccess(
            "If that email is new you are in, otherwise sign in with the password you already have.",
          );
        }
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
      failed(e);
    } finally {
      setBusy(false);
    }
  }

  /* Sign up steps. Enter advances, the last step submits. */
  function advance(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (step === 1) {
      if (!detected) {
        setError(`Use your school email. We cover ${domains}.`);
        setShake((s) => s + 1);
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (name.trim().length < 2) {
        setError("Tell us the name other students will see.");
        setShake((s) => s + 1);
        return;
      }
      setStep(3);
    }
  }

  /* Keep the sliding step container as tall as the step on screen. */
  useLayoutEffect(() => {
    const root = slideRef.current;
    if (!root) return;
    const panel = root.querySelector<HTMLElement>(
      `.t-page[data-page-id="${step}"]`,
    );
    if (!panel) return;
    const measure = () => setSlideHeight(panel.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [step, error, mode, emailReady, detected]);
  useEffect(() => {
    if (mode !== "sign-up" || signedUp) return;
    const root = slideRef.current;
    const first = root?.querySelector<HTMLElement>(
      `.t-page[data-page-id="${step}"] input`,
    );
    if (step > 1) first?.focus();
  }, [step, mode, signedUp]);

  const verifyingUser = user && !user.verified;
  const showVerify =
    mode === "verify" || (mode === "sign-up" && signedUp) ||
    ((mode === "sign-in" || mode === "sign-up") && verifyingUser && !verified);
  const address = user?.email || email;

  function shell(children: React.ReactNode, switcher?: React.ReactNode) {
    return (
      <div className="auth-page">
        <section className="auth-panel">
          <div className="auth-panel-inner enter-stagger">
            <Link to="/browse" className="auth-brand">
              Handoff
            </Link>
            <div className="auth-shake" ref={shakeRef}>
              {children}
            </div>
            {switcher && <p className="auth-switch">{switcher}</p>}
          </div>
        </section>
        <Preview />
      </div>
    );
  }

  /* Already signed in and verified. */
  if (user && user.verified && (mode === "sign-in" || mode === "sign-up"))
    return shell(
      <div className="auth-block">
        <header className="auth-head">
          <SuccessCheck />
          <h1>You are already signed in.</h1>
          <p>Welcome back, {user.name.split(" ")[0]}.</p>
        </header>
        <Link className="button primary full-width auth-cta" to={next}>
          Continue to Handoff
          <ArrowRight size={17} />
        </Link>
      </div>,
    );

  /* Verification, shared by the sign up finish and the /verify route. */
  if (showVerify) {
    if (verified || (mode === "verify" && user?.verified))
      return shell(
        <div className="auth-block">
          <header className="auth-head">
            <SuccessCheck />
            <h1>You are verified.</h1>
            <p>
              Your student email is confirmed. You can publish a listing or
              request a handoff now.
            </p>
          </header>
          <Link className="button primary full-width auth-cta" to={next}>
            Continue to Handoff
            <ArrowRight size={17} />
          </Link>
        </div>,
      );
    if (busy && mode === "verify" && params.get("token"))
      return shell(<Loading label="Verifying your email…" />);
    if (!user)
      return shell(
        <div className="auth-block">
          <header className="auth-head">
            <h1>Verify your email</h1>
            <p>
              Tell us the address you signed up with and we will send a fresh
              code and link.
            </p>
          </header>
          {error && <ErrorBox message={error} />}
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              resend();
            }}
          >
            <Field label="Student email">
              <input
                type="email"
                autoComplete="email"
                placeholder={`you@${campuses[0]?.domain || "usc.edu"}`}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Button type="submit" busy={busy} className="auth-cta">
              Send a new code
              <ArrowRight size={17} />
            </Button>
          </form>
        </div>,
        <>
          Know your password? <Link to="/sign-in">Sign in</Link>
        </>,
      );
    return shell(
      <div className="auth-block">
        <header className="auth-head">
          <h1>Check your email</h1>
          <p>
            We sent a 6 digit code to <strong>{address}</strong>. Verify to
            publish a listing or request a handoff.
          </p>
        </header>
        {error && <ErrorBox message={error} />}
        <OtpInput digits={digits} setDigits={setDigits} disabled={busy} />
        <Button
          type="button"
          busy={busy}
          className="auth-cta"
          disabled={code.length !== 6}
          onClick={() => submitCode(code)}
        >
          Verify
          <ArrowRight size={17} />
        </Button>
        <div className="auth-verify-aside">
          <button
            type="button"
            className="text-button"
            disabled={busy || cooldown > 0}
            onClick={() => resend(address)}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
          <p className="auth-hint">
            Or tap the link in the email, it works on any device.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="auth-cta"
          onClick={() => navigate(next)}
        >
          Skip for now, browse first
        </Button>
      </div>,
    );
  }

  /* Sign in. */
  if (mode === "sign-in")
    return shell(
      <div className="auth-block">
        <header className="auth-head">
          <h1>Welcome back.</h1>
          <p>Sign in to pick up where you left off.</p>
        </header>
        {error && <ErrorBox message={error} />}
        <form className="auth-form" onSubmit={submit}>
          <Field label="Student email">
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`you@${campuses[0]?.domain || "usc.edu"}`}
            />
          </Field>
          <Field label="Password">
            <div className="password-input">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                minLength={1}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          <Link to="/forgot-password" className="forgot-link">
            Forgot password?
          </Link>
          <Button type="submit" busy={busy} className="auth-cta">
            Sign in
            <ArrowRight size={17} />
          </Button>
        </form>
      </div>,
      <>
        New here?{" "}
        <Link to={`/sign-up?next=${encodeURIComponent(next)}`}>
          Create an account
        </Link>
      </>,
    );

  /* Sign up, three steps. */
  if (mode === "sign-up") {
    if (success)
      return shell(
        <div className="auth-block">
          <header className="auth-head">
            <SuccessCheck />
            <h1>Check your inbox.</h1>
            <p>{success}</p>
          </header>
          <Link className="button primary full-width auth-cta" to="/sign-in">
            Go to sign in
            <ArrowRight size={17} />
          </Link>
        </div>,
      );
    const strength =
      password.length === 0
        ? ""
        : password.length < 10
          ? `${10 - password.length} more characters to go.`
          : "Long enough. Make it something only you know.";
    return shell(
      <div className="auth-block">
        <header className="auth-head">
          <h1>Your campus. Your next place.</h1>
          <p>A student email is all it takes to get started.</p>
        </header>
        <ol className="auth-progress" aria-label={`Step ${step} of ${STEPS}`}>
          {[1, 2, 3].map((n) => (
            <li
              key={n}
              className={n < step ? "is-done" : n === step ? "is-active" : ""}
            />
          ))}
        </ol>
        {error && <ErrorBox message={error} />}
        <div
          className="auth-slide t-page-slide"
          ref={slideRef}
          data-step={step}
          style={slideHeight ? { height: `${slideHeight}px` } : undefined}
        >
          <section
            className="t-page"
            data-page-id="1"
            aria-hidden={step !== 1}
            style={{ "--t-page-from-x": "-8px" } as React.CSSProperties}
          >
            <form className="auth-form" onSubmit={advance}>
              <Field label="Student email" hint="Use your school email.">
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  tabIndex={step === 1 ? undefined : -1}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={`you@${campuses[0]?.domain || "usc.edu"}`}
                />
              </Field>
              {detected ? (
                <span className="auth-campus-chip">
                  <Check size={14} />
                  {detected.name}
                </span>
              ) : (
                <span className="auth-hint">We cover {domains}.</span>
              )}
              <Button
                type="submit"
                className="auth-cta"
                tabIndex={step === 1 ? undefined : -1}
              >
                Continue
                <ArrowRight size={17} />
              </Button>
            </form>
          </section>
          <section
            className="t-page"
            data-page-id="2"
            aria-hidden={step !== 2}
            style={
              { "--t-page-from-x": step > 2 ? "-8px" : "8px" } as React.CSSProperties
            }
          >
            <form className="auth-form" onSubmit={advance}>
              <Field label="Your name" hint="First and last, the way students will see it.">
                <input
                  name="name"
                  autoComplete="name"
                  minLength={2}
                  maxLength={80}
                  required
                  tabIndex={step === 2 ? undefined : -1}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="First and last name"
                />
              </Field>
              <div className="auth-campus-card">
                <span className="auth-campus-icon">
                  <GraduationCap size={18} />
                </span>
                <div>
                  <strong>{campus?.shortName || "Your campus"}</strong>
                  <small>{campus?.name || "Pick your campus"}</small>
                </div>
                <select
                  aria-label="Campus"
                  value={campus?.id || ""}
                  tabIndex={step === 2 ? undefined : -1}
                  onChange={(e) => setCampusId(e.target.value)}
                >
                  {campuses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shortName}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="submit"
                className="auth-cta"
                tabIndex={step === 2 ? undefined : -1}
              >
                Continue
                <ArrowRight size={17} />
              </Button>
              <button
                type="button"
                className="auth-back text-button"
                tabIndex={step === 2 ? undefined : -1}
                onClick={() => setStep(1)}
              >
                <ArrowLeft size={15} />
                Back
              </button>
            </form>
          </section>
          <section
            className="t-page"
            data-page-id="3"
            aria-hidden={step !== 3}
            style={{ "--t-page-from-x": "8px" } as React.CSSProperties}
          >
            <form className="auth-form" onSubmit={submit}>
              <Field label="Password" hint={strength || "At least 10 characters."}>
                <div className="password-input">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={10}
                    maxLength={128}
                    tabIndex={step === 3 ? undefined : -1}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    tabIndex={step === 3 ? undefined : -1}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
              <div
                className="auth-meter"
                data-filled={password.length >= 10 ? "yes" : "no"}
              >
                <span
                  style={{
                    width: `${Math.min(100, (password.length / 10) * 100)}%`,
                  }}
                />
              </div>
              {!emailReady && (
                <p className="auth-hint">
                  Email delivery is paused on this server, so the code may not
                  arrive.
                </p>
              )}
              <Button
                type="submit"
                busy={busy}
                className="auth-cta"
                tabIndex={step === 3 ? undefined : -1}
              >
                Create your account
                <ArrowRight size={17} />
              </Button>
              <button
                type="button"
                className="auth-back text-button"
                tabIndex={step === 3 ? undefined : -1}
                onClick={() => setStep(2)}
              >
                <ArrowLeft size={15} />
                Back
              </button>
            </form>
          </section>
        </div>
        <p className="auth-fineprint">
          Use Handoff to connect with students. Confirm the lease and property
          details together before committing.
        </p>
      </div>,
      <>
        Already have an account?{" "}
        <Link to={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link>
      </>,
    );
  }

  /* Forgot and reset password. */
  const forgot = mode === "forgot-password";
  if (success)
    return shell(
      <div className="auth-block">
        <header className="auth-head">
          <SuccessCheck />
          <h1>{forgot ? "Check your inbox." : "Password updated."}</h1>
          <p>{success}</p>
        </header>
        <Link className="button primary full-width auth-cta" to="/sign-in">
          Back to sign in
          <ArrowRight size={17} />
        </Link>
      </div>,
    );
  return shell(
    <div className="auth-block">
      <header className="auth-head">
        <h1>{forgot ? "Let’s get you back in." : "A fresh start."}</h1>
        <p>
          {forgot
            ? "We will send a link to reset your password."
            : "Choose a new password for your Handoff account."}
        </p>
      </header>
      {error && <ErrorBox message={error} />}
      <form className="auth-form" onSubmit={submit}>
        {forgot ? (
          <Field label="Student email">
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`you@${campuses[0]?.domain || "usc.edu"}`}
            />
          </Field>
        ) : (
          <Field
            label="New password"
            hint="At least 10 characters. Make it something only you know."
          >
            <div className="password-input">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
        )}
        {forgot && !emailReady && (
          <p className="auth-hint">
            Email delivery is paused on this server, so the link may not arrive.
          </p>
        )}
        {!forgot && !resetToken && (
          <ErrorBox message="This reset link is incomplete. Request a new link from the forgot password page." />
        )}
        <Button
          type="submit"
          busy={busy}
          className="auth-cta"
          disabled={!forgot && !resetToken}
        >
          {forgot ? "Send reset link" : "Update password"}
          <ArrowRight size={17} />
        </Button>
      </form>
    </div>,
    <>
      Remembered it? <Link to="/sign-in">Sign in</Link>
    </>,
  );
}
