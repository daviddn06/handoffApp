import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  BedDouble,
  CalendarDays,
  ChevronDown,
  Eye,
  EyeOff,
  GraduationCap,
  Search,
  SlidersHorizontal,
  Wallet,
  Zap,
} from "lucide-react";
import { api, errorMessage, json, safeNext } from "../lib/api";
import { useApp } from "../lib/context";
import { Button, ErrorBox, Field, Loading } from "../components/ui";
import type { User } from "../types";
import { liveCampuses } from "../lib/schools";
import { passwordCheck } from "../lib/password";
import {
  ForgotForm,
  PasswordMeter,
  SignInForm,
  SignUpForm,
  SuccessCheck,
} from "../components/AuthForms";
type Mode =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "reset-password"
  | "verify";

/** One card in the replica, the same markup and classes the browse list uses. */
function ReplicaCard({
  tone,
  price,
  savings,
  title,
  meta,
  dates,
  walk,
  boosted,
}: {
  tone: string;
  price: string;
  savings?: string;
  title: string;
  meta: string;
  dates: string;
  walk: string;
  boosted?: boolean;
}) {
  return (
    <article className="listing-card compact">
      <div className="card-photo">
        <span className={`auth-photo ${tone}`} />
      </div>
      <div className="card-body">
        <div className="card-topline">
          <div className="card-price">
            <strong>{price}</strong>
            <span>/mo</span>
          </div>
          {boosted && (
            <span className="boost-tag">
              <Zap size={11} fill="currentColor" strokeWidth={0} />
              Boosted
            </span>
          )}
          {savings && <span className="savings-tag">{savings}</span>}
        </div>
        <h2 className="card-title">{title}</h2>
        <p className="card-meta">{meta}</p>
        <p className="card-meta">
          {dates} · <span className="card-distance">{walk}</span>
        </p>
      </div>
    </article>
  );
}

/**
 * A flat, still replica of the browse screen, built from the app's own
 * classes so the sign in page shows the real product rather than a drawing.
 * It is scaled inside an overflow hidden frame and carries no motion.
 */
function BrowseReplica() {
  return (
    <aside className="auth-preview" aria-hidden="true">
      <div className="auth-replica-frame">
        <div className="auth-replica">
          <div className="browse-page">
            <div className="browse-panel">
              <div className="panel-head">
                <div className="head-row">
                  <span className="campus-switch">
                    <span className="school-logo">
                      <img src="/logos/usc.svg" alt="" className="brand" />
                    </span>
                    <span className="campus-text">
                      <strong>Near University of Southern California</strong>
                      <small>Change school</small>
                    </span>
                    <ChevronDown size={15} className="chip-chevron" />
                  </span>
                </div>
                <div className="search-row">
                  <span className="search-field">
                    <Search size={17} />
                    <span className="auth-replica-placeholder">
                      Search by street, building, or keyword
                    </span>
                  </span>
                </div>
                <div className="chip-row">
                  <span className="chip">
                    <CalendarDays size={15} />
                    Dates
                    <ChevronDown size={14} className="chip-chevron" />
                  </span>
                  <span className="chip">
                    <Wallet size={15} />
                    Price
                    <ChevronDown size={14} className="chip-chevron" />
                  </span>
                  <span className="chip">
                    <BedDouble size={15} />
                    Rooms
                    <ChevronDown size={14} className="chip-chevron" />
                  </span>
                  <span className="chip">
                    <SlidersHorizontal size={15} />
                    Amenities
                  </span>
                </div>
              </div>
              <div className="results-toolbar">
                <span className="results-count">
                  <span>
                    <strong>22</strong> places
                    <span className="results-scope">on the map</span>
                  </span>
                </span>
                <span className="auth-replica-sort">
                  Closest to campus
                  <ChevronDown size={14} className="chip-chevron" />
                </span>
              </div>
              <div className="listing-list">
                <ReplicaCard
                  tone="one"
                  price="$1,950"
                  savings="Save $300"
                  boosted
                  title="Two bedroom near Figueroa and Adams"
                  meta="Entire place · 2 bd · 1 ba"
                  dates="May 15 to Aug 20"
                  walk="8 min walk"
                />
                <ReplicaCard
                  tone="two"
                  price="$1,200"
                  savings="Save $250"
                  title="A sunny room off Jefferson"
                  meta="Private room · 1 bd · 1 ba"
                  dates="June 1 to Aug 15"
                  walk="12 min walk"
                />
                <ReplicaCard
                  tone="three"
                  price="$950"
                  title="Studio on Vermont Avenue"
                  meta="Entire place · Studio · 1 ba"
                  dates="June 1 to Aug 31"
                  walk="18 min walk"
                />
              </div>
            </div>
            <div className="auth-replica-map">
              <svg
                className="auth-replica-art"
                viewBox="0 0 520 620"
                preserveAspectRatio="xMidYMid slice"
              >
                <rect width="520" height="620" fill="#f8f9fa" />
                <g fill="#eef0f2">
                  <rect x="16" y="18" width="120" height="96" rx="3" />
                  <rect x="160" y="18" width="148" height="96" rx="3" />
                  <rect x="332" y="18" width="130" height="96" rx="3" />
                  <rect x="16" y="150" width="120" height="120" rx="3" />
                  <rect x="16" y="300" width="120" height="120" rx="3" />
                  <rect x="16" y="452" width="120" height="150" rx="3" />
                  <rect x="160" y="452" width="148" height="150" rx="3" />
                  <rect x="332" y="452" width="130" height="150" rx="3" />
                  <rect x="486" y="18" width="34" height="584" rx="3" />
                </g>
                <rect
                  x="160"
                  y="150"
                  width="302"
                  height="270"
                  rx="6"
                  fill="#e6eee2"
                />
                <g fill="#eef0f2">
                  <rect x="196" y="186" width="96" height="62" rx="3" />
                  <rect x="316" y="186" width="110" height="62" rx="3" />
                  <rect x="196" y="316" width="110" height="60" rx="3" />
                  <rect x="330" y="316" width="96" height="60" rx="3" />
                </g>
                <g stroke="#e3e6ea" strokeWidth="14" fill="none">
                  <path d="M0 132H520M0 284H520M0 436H520M148 0V620M320 0V620M474 0V620" />
                </g>
                <g stroke="#fff" strokeWidth="10" fill="none">
                  <path d="M0 132H520M0 284H520M0 436H520M148 0V620M320 0V620M474 0V620" />
                </g>
                <g stroke="#eceef1" strokeWidth="5" fill="none">
                  <path d="M0 210H520M0 360H520M234 0V620M398 0V620" />
                </g>
                <path
                  d="M182 176 L402 164 L440 244 L428 384 L262 402 L188 348 Z"
                  fill="rgb(21 154 106 / 0.07)"
                  stroke="#159a6a"
                  strokeWidth="2"
                  strokeDasharray="7 6"
                />
                <g
                  fontFamily="Geist, sans-serif"
                  fontSize="10"
                  fill="#9aa2ab"
                  letterSpacing="0.6"
                >
                  <text x="168" y="124">PICO UNION</text>
                  <text x="22" y="276" transform="rotate(-90 22 276)">
                    VERMONT AVENUE
                  </text>
                  <text x="186" y="430">JEFFERSON BOULEVARD</text>
                  <text x="24" y="500">EXPOSITION PARK</text>
                </g>
              </svg>
              <span
                className="campus-marker"
                style={{ left: "40%", top: "46%" }}
              >
                <GraduationCap size={13} />
                University of Southern California
              </span>
              <span className="price-marker" style={{ left: "26%", top: "23%" }}>
                $950
              </span>
              <span className="price-marker" style={{ left: "58%", top: "31%" }}>
                $1,100
              </span>
              <span
                className="price-marker is-active"
                style={{ left: "34%", top: "64%" }}
              >
                $1,950
              </span>
              <span className="price-marker" style={{ left: "62%", top: "71%" }}>
                $1,450
              </span>
              <span
                className="cluster-marker"
                style={{ left: "52%", top: "15%" }}
              >
                8
              </span>
            </div>
          </div>
        </div>
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

export default function Auth({ mode }: { mode: Mode }) {
  const { user, setUser, campuses: allCampuses, emailReady, notify } = useApp(),
    navigate = useNavigate(),
    [params] = useSearchParams();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [shake, setShake] = useState(0),
    [signedUp, setSignedUp] = useState(false),
    [verified, setVerified] = useState(false),
    [digits, setDigits] = useState(["", "", "", "", "", ""]),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}),
    [cooldown, setCooldown] = useState(0);
  const campuses = liveCampuses(allCampuses);
  const verifiedToken = useRef("");
  const shakeRef = useRef<HTMLDivElement>(null);
  const next = safeNext(params.get("next"));
  const resetToken = params.get("token");
  const code = digits.join("");
  const strength = passwordCheck(password, { email });

  useEffect(() => {
    setError("");
    setSuccess("");
    setPassword("");
    setBusy(false);
    setSignedUp(false);
    setFieldErrors({});
  }, [mode]);
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

  /* Our own validation, so the browser never shows its native bubble. */
  function validateEmail() {
    const address = email.trim();
    const problem = !address
      ? "Enter your student email."
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
        ? "That does not look like an email address."
        : "";
    setFieldErrors(problem ? { email: problem } : {});
    if (problem) setShake((s) => s + 1);
    return !problem;
  }
  const clearField = (key: string) =>
    setFieldErrors((current) =>
      current[key] ? { ...current, [key]: "" } : current,
    );

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

  /* Reset password, the only form still unique to the full page. */
  async function submitReset(e: FormEvent) {
    e.preventDefault();
    const check = passwordCheck(password, { email });
    if (!check.valid) {
      setFieldErrors({
        password: check.problem || "Choose a stronger password.",
      });
      setShake((s) => s + 1);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/auth/reset", {
        method: "POST",
        body: json({ token: resetToken, password }),
      });
      setUser(null);
      setSuccess(r.message);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }

  const verifyingUser = user && !user.verified;
  const showVerify =
    mode === "verify" || (mode === "sign-up" && signedUp) ||
    ((mode === "sign-in" || mode === "sign-up") && verifyingUser && !verified);
  const address = user?.email || email;

  function shell(children: React.ReactNode, switcher?: React.ReactNode) {
    return (
      <div className="auth-page">
        <div className="auth-box">
          <section className="auth-panel">
            <div className="auth-panel-inner enter-stagger">
              <div className="auth-shake" ref={shakeRef}>
                {children}
              </div>
              {switcher && <p className="auth-switch">{switcher}</p>}
            </div>
          </section>
          <BrowseReplica />
        </div>
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
            <h1>One more step, confirm your email</h1>
            <p>
              Tell us the address you signed up with and we will send a fresh
              code and link.
            </p>
          </header>
          {error && <ErrorBox message={error} />}
          <form
            noValidate
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!validateEmail()) return;
              resend();
            }}
          >
            <Field label="Student email" error={fieldErrors.email}>
              <input
                type="email"
                autoComplete="email"
                placeholder={`you@${campuses[0]?.domain || "usc.edu"}`}
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearField("email");
                }}
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
          <h1>One more step, confirm your email</h1>
          <p>
            We sent a 6 digit code to <strong>{address}</strong>. Verify to
            publish a listing or request a handoff.
          </p>
        </header>
        {error && <ErrorBox message={error} />}
        <OtpInput digits={digits} setDigits={setDigits} disabled={busy} />
        <div className="auth-pinned">
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
        </div>
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

  /* Sign in, the shared form inside the full page shell. */
  if (mode === "sign-in")
    return shell(
      <SignInForm
        next={next}
        email={params.get("email") || ""}
        onDone={(signedIn) => {
          if (!signedIn.verified) return;
          navigate(next, { replace: true });
          notify("Welcome back.");
        }}
      />,
    );

  /* Sign up, the shared three step form inside the full page shell. */
  if (mode === "sign-up")
    return shell(
      <SignUpForm
        next={next}
        onDone={() => {
          setSignedUp(true);
          setCooldown(30);
        }}
      />,
    );

  /* Forgot password, the shared form inside the full page shell. */
  if (mode === "forgot-password")
    return shell(
      <ForgotForm next={next} />,
    );

  /* Reset password. */
  if (success)
    return shell(
      <div className="auth-block">
        <header className="auth-head">
          <SuccessCheck />
          <h1>Password updated.</h1>
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
        <h1>A fresh start.</h1>
        <p>Choose a new password for your Handoff account.</p>
      </header>
      {error && <ErrorBox message={error} />}
      <form className="auth-form" noValidate onSubmit={submitReset}>
        <Field label="New password" error={fieldErrors.password}>
          <div className="password-input">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearField("password");
              }}
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
        <PasswordMeter check={strength} />
        {!emailReady && (
          <p className="auth-hint is-notice">
            <AlertCircle size={15} />
            Email is paused on this server. The link may not arrive.
          </p>
        )}
        {!resetToken && (
          <ErrorBox message="This reset link is incomplete. Request a new link from the forgot password page." />
        )}
        <Button
          type="submit"
          busy={busy}
          className="auth-cta"
          disabled={!resetToken || !strength.valid}
        >
          Update password
          <ArrowRight size={17} />
        </Button>
      </form>
    </div>,
    <>
      Remembered it? <Link to="/sign-in">Sign in</Link>
    </>,
  );
}
