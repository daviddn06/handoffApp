import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import { api, errorMessage, json } from "../lib/api";
import { useApp } from "../lib/context";
import { Button, ErrorBox, Field } from "./ui";
import type { Gender, User } from "../types";
import { GenderChoice } from "./Gender";
import {
  liveCampuses,
  loadSchools,
  schoolForEmail,
  type School,
} from "../lib/schools";
import { passwordCheck, type PasswordCheck } from "../lib/password";
import { SchoolLogo } from "./SchoolSearch";

/**
 * The three signed out forms, lifted out of the auth pages so the same code
 * runs inside the full page shell and inside the auth modal. Nothing here
 * navigates. Each form reports the signed in student through onDone and the
 * host decides where to go next.
 */
export type AuthFormMode = "signup" | "signin" | "forgot";
export type AuthFormProps = {
  next: string;
  onDone?: (user: User) => void;
  onSwitch?: (mode: AuthFormMode) => void;
  /** Tighter spacing for the modal. */
  compact?: boolean;
};

/** Signing up is a student confirming who they are, so the steps say that. */
export const STEP_NAMES = ["Your school email", "Your name", "A password"];
export const STEPS = STEP_NAMES.length;

export function SuccessCheck() {
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

/**
 * Four segments that fill as the estimate rises, plus the single most useful
 * next step. The colour carries the level: red for weak, blue for good, green
 * for strong.
 */
export function PasswordMeter({ check }: { check: PasswordCheck }) {
  return (
    <div className="auth-meter-block">
      <div
        className="auth-meter"
        data-level={check.level}
        role="img"
        aria-label={
          check.level === "empty"
            ? "Password strength not measured yet"
            : `Password strength ${check.label}`
        }
      >
        {[1, 2, 3, 4].map((segment) => (
          <span key={segment} data-on={check.score >= segment ? "yes" : "no"} />
        ))}
      </div>
      <p className="auth-meter-note" data-level={check.level}>
        {check.label && <strong>{check.label}</strong>}
        {check.hint && <span>{check.hint}</span>}
        {!check.hint && check.crack && (
          <span>Would take {check.crack} to guess.</span>
        )}
      </p>
    </div>
  );
}

/** transitions.dev 12, the form block shakes once whenever something fails. */
function useShake() {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!count) return;
    const el = ref.current;
    if (!el) return;
    el.classList.remove("is-shaking");
    void el.offsetWidth;
    el.classList.add("is-shaking");
    const t = window.setTimeout(() => el.classList.remove("is-shaking"), 320);
    return () => window.clearTimeout(t);
  }, [count]);
  return { ref, shake: () => setCount((c) => c + 1) };
}

/** Our own validation, so the browser never shows its native bubble. */
type FieldName = "email" | "name" | "password" | "newPassword";
function checkFields(
  fields: FieldName[],
  values: { email: string; name: string; password: string },
) {
  const next: Record<string, string> = {};
  const address = values.email.trim();
  if (fields.includes("email")) {
    if (!address) next.email = "Enter your student email.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      next.email = "That does not look like an email address.";
  }
  if (fields.includes("name") && values.name.trim().length < 2)
    next.name = "Tell us the name other students will see.";
  if (fields.includes("password") && !values.password)
    next.password = "Enter your password.";
  if (fields.includes("newPassword")) {
    const check = passwordCheck(values.password, {
      email: values.email,
      name: values.name,
    });
    if (!check.valid)
      next.password = check.problem || "Choose a stronger password.";
  }
  return next;
}

function blockClass(compact?: boolean) {
  return `auth-block auth-shake${compact ? " is-compact" : ""}`;
}

/** The live campus for an email, used only to tell a student what to expect. */
function liveCampusFor(
  email: string,
  campuses: Array<{ id: string; domain: string }>,
) {
  const domain = email.trim().toLowerCase().split("@")[1] || "";
  if (!domain) return null;
  return (
    campuses.find(
      (c) => domain === c.domain || domain.endsWith(`.${c.domain}`),
    ) || null
  );
}

/* ---------------------------------------------------------------- sign in */

export function SignInForm({ next, onDone, onSwitch, compact }: AuthFormProps) {
  const { setUser, campuses: allCampuses } = useApp();
  const campuses = liveCampuses(allCampuses);
  const { ref, shake } = useShake();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearField = (key: string) =>
    setFieldErrors((current) =>
      current[key] ? { ...current, [key]: "" } : current,
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problems = checkFields(["email", "password"], {
      email,
      name: "",
      password,
    });
    setFieldErrors(problems);
    if (Object.keys(problems).length) {
      shake();
      return;
    }
    setError("");
    setBusy(true);
    try {
      const r = await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: json({ email, password }),
      });
      setUser(r.user);
      onDone?.(r.user);
    } catch (err) {
      setError(errorMessage(err));
      shake();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={blockClass(compact)} ref={ref}>
      <header className="auth-head">
        <h1>Welcome back.</h1>
        <p>Sign in to pick up where you left off.</p>
      </header>
      {error && <ErrorBox message={error} />}
      <form className="auth-form" noValidate onSubmit={submit}>
        <Field label="Student email" error={fieldErrors.email}>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearField("email");
            }}
            placeholder={`you@${campuses[0]?.domain || "usc.edu"}`}
          />
        </Field>
        <Field label="Password" error={fieldErrors.password}>
          <div className="password-input">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              minLength={1}
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
        {onSwitch ? (
          <button
            type="button"
            className="forgot-link text-button"
            onClick={() => onSwitch("forgot")}
          >
            Forgot password?
          </button>
        ) : (
          <Link to="/forgot-password" className="forgot-link">
            Forgot password?
          </Link>
        )}
        <Button type="submit" busy={busy} className="auth-cta">
          Sign in
          <ArrowRight size={17} />
        </Button>
      </form>
      {compact && (
        <p className="auth-switch">
          New here?{" "}
          {onSwitch ? (
            <button type="button" className="text-button" onClick={() => onSwitch("signup")}>
              Confirm you are a student
            </button>
          ) : (
            <Link to={`/sign-up?next=${encodeURIComponent(next)}`}>
              Confirm you are a student
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- sign up */

export function SignUpForm({ next, onDone, onSwitch, compact }: AuthFormProps) {
  const { setUser, campuses: allCampuses, emailReady } = useApp();
  const campuses = liveCampuses(allCampuses);
  const { ref, shake } = useShake();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [gender, setGender] = useState<Gender>("unspecified"),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [step, setStep] = useState(1),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // The school list is only needed by sign up, so it loads with the form.
  const [schools, setSchools] = useState<School[] | null>(null);
  useEffect(() => {
    loadSchools().then(setSchools);
  }, []);
  const slideRef = useRef<HTMLDivElement>(null);
  const [slideHeight, setSlideHeight] = useState<number>();
  const strength = passwordCheck(password, { email, name });
  const listingNext = next === "/listings/new" || next.startsWith("/listings/new?");
  // The school is read from the email as the student types. There is nothing
  // to pick: their email decides it, and listing opens when Handoff does.
  const found = schools ? schoolForEmail(email, schools) : null;
  const detected = found
    ? {
        name: found.school.n,
        domain: found.domain,
        live: Boolean(liveCampusFor(email, campuses)),
      }
    : null;
  const clearField = (key: string) =>
    setFieldErrors((current) =>
      current[key] ? { ...current, [key]: "" } : current,
    );

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
  }, [step, error, emailReady, detected]);
  useEffect(() => {
    const root = slideRef.current;
    const first = root?.querySelector<HTMLElement>(
      `.t-page[data-page-id="${step}"] input`,
    );
    if (step > 1) first?.focus();
  }, [step]);

  /* Sign up steps. Enter advances, the last step submits. */
  async function advance(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (step === 1) {
      const problems = checkFields(["email"], { email, name, password });
      setFieldErrors(problems);
      if (Object.keys(problems).length) {
        shake();
        return;
      }
      // The school list may still be in flight on a fast first keystroke.
      setBusy(true);
      const list = schools || (await loadSchools());
      setSchools(list);
      setBusy(false);
      if (!schoolForEmail(email, list)) {
        setError("Use your school email. We could not find that school yet.");
        shake();
        return;
      }
      setStep(2);
    } else if (step === 2) {
      const problems = checkFields(["name"], { email, name, password });
      setFieldErrors(problems);
      if (Object.keys(problems).length) {
        shake();
        return;
      }
      setStep(3);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problems = checkFields(["newPassword"], { email, name, password });
    setFieldErrors(problems);
    if (Object.keys(problems).length) {
      shake();
      return;
    }
    setError("");
    setBusy(true);
    try {
      const r = await api<{ user: User | null; message: string }>(
        "/auth/signup",
        { method: "POST", body: json({ name, email, password, gender }) },
      );
      if (r.user) {
        setUser(r.user);
        onDone?.(r.user);
      } else {
        setSuccess(
          "If that email is new you are in, otherwise sign in with the password you already have.",
        );
      }
    } catch (err) {
      setError(errorMessage(err));
      shake();
    } finally {
      setBusy(false);
    }
  }

  if (success)
    return (
      <div className={blockClass(compact)} ref={ref}>
        <header className="auth-head">
          <SuccessCheck />
          <h1>Check your inbox.</h1>
          <p>{success}</p>
        </header>
        {onSwitch ? (
          <Button
            type="button"
            className="auth-cta"
            onClick={() => onSwitch("signin")}
          >
            Go to sign in
            <ArrowRight size={17} />
          </Button>
        ) : (
          <Link className="button primary full-width auth-cta" to="/sign-in">
            Go to sign in
            <ArrowRight size={17} />
          </Link>
        )}
      </div>
    );

  return (
    <div className={blockClass(compact)} ref={ref}>
      <header className="auth-head">
        <h1>
          {listingNext
            ? "Confirm you are a student to list your place."
            : "Confirm you are a student."}
        </h1>
        <p>Your school email is all it takes.</p>
      </header>
      <p className="auth-step-name">
        Step {step} of {STEPS} · {STEP_NAMES[step - 1]}
      </p>
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
          <form className="auth-form" noValidate onSubmit={advance}>
            <Field label="Student email" error={fieldErrors.email}>
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                tabIndex={step === 1 ? undefined : -1}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearField("email");
                }}
                placeholder={`you@${campuses[0]?.domain || "usc.edu"}`}
              />
            </Field>
            {error && !detected && (
              <p className="auth-hint">
                Not seeing your school?{" "}
                <Link to="/browse" tabIndex={step === 1 ? undefined : -1}>
                  Join the waitlist
                </Link>{" "}
                and we will tell you when it opens.
              </p>
            )}
            <Button
              type="submit"
              busy={busy && step === 1}
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
          <form className="auth-form" noValidate onSubmit={advance}>
            <Field
              label="Your name"
              hint="First and last, the way students will see it."
              error={fieldErrors.name}
            >
              <input
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={80}
                required
                tabIndex={step === 2 ? undefined : -1}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearField("name");
                }}
                placeholder="First and last name"
              />
            </Field>
            <GenderChoice
              name="signup-gender"
              value={gender}
              onChange={setGender}
              tabIndex={step === 2 ? undefined : -1}
            />
            {detected && (
              <p className="auth-school-line">
                <SchoolLogo
                  src={`/api/logo/${encodeURIComponent(detected.domain)}`}
                />
                <span>{detected.name}</span>
                {!detected.live && (
                  <small>Browsing only for now, listings open soon</small>
                )}
              </p>
            )}
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
          <form className="auth-form" noValidate onSubmit={submit}>
            <Field label="Password" error={fieldErrors.password}>
              <div className="password-input">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={128}
                  tabIndex={step === 3 ? undefined : -1}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearField("password");
                  }}
                />
                <button
                  type="button"
                  className="icon-button"
                  tabIndex={step === 3 ? undefined : -1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            <PasswordMeter check={strength} />
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
              disabled={!strength.valid}
              tabIndex={step === 3 ? undefined : -1}
            >
              Confirm and continue
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
        By confirming you agree to our <Link to="/terms">Terms of Service</Link>{" "}
        and <Link to="/privacy">Privacy Policy</Link>.
      </p>
      {compact && (
        <p className="auth-switch">
          Already confirmed?{" "}
          {onSwitch ? (
            <button type="button" className="text-button" onClick={() => onSwitch("signin")}>
              Sign in
            </button>
          ) : (
            <Link to={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link>
          )}
        </p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- forgot */

export function ForgotForm({ onSwitch, compact }: AuthFormProps) {
  const { campuses: allCampuses, emailReady } = useApp();
  const campuses = liveCampuses(allCampuses);
  const { ref, shake } = useShake();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [email, setEmail] = useState(""),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problems = checkFields(["email"], { email, name: "", password: "" });
    setFieldErrors(problems);
    if (Object.keys(problems).length) {
      shake();
      return;
    }
    setError("");
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/auth/forgot", {
        method: "POST",
        body: json({ email }),
      });
      setSuccess(r.message);
    } catch (err) {
      setError(errorMessage(err));
      shake();
    } finally {
      setBusy(false);
    }
  }

  if (success)
    return (
      <div className={blockClass(compact)} ref={ref}>
        <header className="auth-head">
          <SuccessCheck />
          <h1>Check your inbox.</h1>
          <p>{success}</p>
        </header>
        {onSwitch ? (
          <Button
            type="button"
            className="auth-cta"
            onClick={() => onSwitch("signin")}
          >
            Back to sign in
            <ArrowRight size={17} />
          </Button>
        ) : (
          <Link className="button primary full-width auth-cta" to="/sign-in">
            Back to sign in
            <ArrowRight size={17} />
          </Link>
        )}
      </div>
    );

  return (
    <div className={blockClass(compact)} ref={ref}>
      <header className="auth-head">
        <h1>Let’s get you back in.</h1>
        <p>We will send a link to reset your password.</p>
      </header>
      {error && <ErrorBox message={error} />}
      <form className="auth-form" noValidate onSubmit={submit}>
        <Field label="Student email" error={fieldErrors.email}>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErrors((c) => (c.email ? { ...c, email: "" } : c));
            }}
            placeholder={`you@${campuses[0]?.domain || "usc.edu"}`}
          />
        </Field>
        {!emailReady && (
          <p className="auth-hint">
            Email delivery is paused on this server, so the link may not arrive.
          </p>
        )}
        <Button type="submit" busy={busy} className="auth-cta">
          Send reset link
          <ArrowRight size={17} />
        </Button>
      </form>
      {compact && (
        <p className="auth-switch">
          Remembered it?{" "}
          {onSwitch ? (
            <button type="button" className="text-button" onClick={() => onSwitch("signin")}>
              Sign in
            </button>
          ) : (
            <Link to="/sign-in">Sign in</Link>
          )}
        </p>
      )}
    </div>
  );
}
