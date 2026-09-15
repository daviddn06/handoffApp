import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import { ApiError, api, errorMessage, json } from "../lib/api";
import { useApp, type AuthReason } from "../lib/context";
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
import { PhotoPicker } from "./PhotoPicker";

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
  /** What the student was reaching for, so the headline can name it. */
  reason?: AuthReason;
  /** Seeds the email field, so switching forms keeps what was typed. */
  email?: string;
  /** Reports every keystroke, so the host can seed the other form. */
  onEmail?: (value: string) => void;
};

/**
 * The headline names the action, because a dialog that appears over a page
 * has to say what it is for. The reason wins, the target is the fallback.
 */
function actionPhrase(next: string, reason?: AuthReason) {
  const byReason: Partial<Record<AuthReason, string>> = {
    saved: "to see your saved places",
    requests: "to see your requests",
    "my-listings": "to see your listings",
    "new-listing": "to list your place",
    request: "to request this place",
    details: "to see the address and details",
    save: "to save this place",
  };
  if (reason && byReason[reason]) return byReason[reason] as string;
  const path = (next || "").split("?")[0];
  if (path.startsWith("/saved")) return "to see your saved places";
  if (path.startsWith("/requests")) return "to see your requests";
  if (path.startsWith("/my-listings")) return "to see your listings";
  if (path.startsWith("/listings/new")) return "to list your place";
  return "";
}
export function signUpHeadline(next: string, reason?: AuthReason) {
  const phrase = actionPhrase(next, reason);
  return `Confirm you are a student ${phrase || "to continue"}.`;
}
export function signInLead(next: string, reason?: AuthReason) {
  const phrase = actionPhrase(next, reason);
  return `Sign in ${phrase || "to pick up where you left off"}.`;
}
export const STUDENTS_ONLY_LINE =
  "Handoff is students only. Confirm with your school email.";

/**
 * A settled success check, held for a beat so the student sees the result
 * before the dialog gets out of the way. transitions.dev 10.
 */
export const SUCCESS_HOLD = 700;
function useSettledSuccess(onDone: () => void) {
  const [done, setDone] = useState(false);
  const fire = useRef(onDone);
  fire.current = onDone;
  useEffect(() => {
    if (!done) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const t = window.setTimeout(() => fire.current(), reduced ? 120 : SUCCESS_HOLD);
    return () => window.clearTimeout(t);
  }, [done]);
  return { done, settle: () => setDone(true) };
}

/**
 * transitions.dev 12, but only the field that failed moves. Alternating the
 * class restarts the animation on a repeated failure without a remount, so
 * the caret never leaves the input.
 */
function useFieldShake() {
  const [state, setState] = useState<{ field: string; tick: number }>({
    field: "",
    tick: 0,
  });
  return {
    shakeField: (field: string) =>
      setState((c) => ({ field, tick: c.tick + 1 })),
    fieldClass: (field: string) =>
      state.field === field
        ? `auth-field-shake shake-${state.tick % 2}`
        : "",
  };
}

/** Signing up is a student confirming who they are, so the steps say that. */
export const STEP_NAMES = [
  "Your school email",
  "Your name",
  "A password",
  "Add a photo",
];
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

export function SignInForm({
  next,
  onDone,
  onSwitch,
  compact,
  reason,
  email: sharedEmail,
  onEmail,
}: AuthFormProps) {
  const { setUser, campuses: allCampuses } = useApp();
  const campuses = liveCampuses(allCampuses);
  const { shakeField, fieldClass } = useFieldShake();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [email, setEmailValue] = useState(sharedEmail || ""),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [signedIn, setSignedIn] = useState<User | null>(null),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const setEmail = (value: string) => {
    setEmailValue(value);
    onEmail?.(value);
  };
  const { done, settle } = useSettledSuccess(() => {
    if (signedIn) onDone?.(signedIn);
  });
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
      shakeField(problems.email ? "email" : "password");
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
      setSignedIn(r.user);
      settle();
    } catch (err) {
      setError(errorMessage(err));
      shakeField("password");
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className={`${blockClass(compact)} is-settled`}>
        <header className="auth-head">
          <SuccessCheck />
          <h1>You are in.</h1>
          <p className="auth-fade-in">Taking you back to what you were doing.</p>
        </header>
      </div>
    );

  return (
    <div className={blockClass(compact)}>
      <header className="auth-head">
        <h1>Welcome back.</h1>
        <p>{signInLead(next, reason)}</p>
      </header>
      {error && (
        <div className="auth-fade-in">
          <ErrorBox message={error} />
        </div>
      )}
      <form className="auth-form" noValidate onSubmit={submit}>
        <Field
          label="Student email"
          error={fieldErrors.email}
          className={fieldClass("email")}
        >
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
        <Field
          label="Password"
          error={fieldErrors.password}
          className={fieldClass("password")}
        >
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

export function SignUpForm({
  next,
  onDone,
  onSwitch,
  compact,
  reason,
  email: seedEmail,
  onEmail,
}: AuthFormProps) {
  const { setUser, campuses: allCampuses, emailReady } = useApp();
  const campuses = liveCampuses(allCampuses);
  const { shakeField, fieldClass } = useFieldShake();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [errorCode, setErrorCode] = useState(""),
    [success, setSuccess] = useState(""),
    [email, setEmailValue] = useState(seedEmail || ""),
    [name, setName] = useState(""),
    [gender, setGender] = useState<Gender>("unspecified"),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [step, setStep] = useState(1),
    [joined, setJoined] = useState<User | null>(null),
    [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const setEmail = (value: string) => {
    setEmailValue(value);
    onEmail?.(value);
  };
  // The school list is only needed by sign up, so it loads with the form.
  const [schools, setSchools] = useState<School[] | null>(null);
  useEffect(() => {
    loadSchools().then(setSchools);
  }, []);
  const slideRef = useRef<HTMLDivElement>(null);
  const [slideHeight, setSlideHeight] = useState<number>();
  const strength = passwordCheck(password, { email, name });
  const { done, settle } = useSettledSuccess(() => {
    if (joined) onDone?.(joined);
  });
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
  /* Focus lands only once the slide has settled. Focusing mid transition
     scrolls the clipped track sideways, which is the bug this avoids. */
  useEffect(() => {
    if (step < 2) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const t = window.setTimeout(
      () =>
        slideRef.current
          ?.querySelector<HTMLElement>(
            `.t-page[data-page-id="${step}"] input:not([type="file"])`,
          )
          ?.focus({ preventScroll: true }),
      reduced ? 0 : 280,
    );
    return () => window.clearTimeout(t);
  }, [step]);

  /* Sign up steps. Enter advances, the last step submits. */
  async function advance(e: FormEvent) {
    e.preventDefault();
    setError("");
    setErrorCode("");
    if (step === 1) {
      const problems = checkFields(["email"], { email, name, password });
      setFieldErrors(problems);
      if (Object.keys(problems).length) {
        shakeField("email");
        return;
      }
      // The school list may still be in flight on a fast first keystroke.
      setBusy(true);
      const list = schools || (await loadSchools());
      setSchools(list);
      setBusy(false);
      if (!schoolForEmail(email, list)) {
        setError("Use your school email. We could not find that school yet.");
        shakeField("email");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      const problems = checkFields(["name"], { email, name, password });
      setFieldErrors(problems);
      if (Object.keys(problems).length) {
        shakeField("name");
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
      shakeField("password");
      return;
    }
    setError("");
    setErrorCode("");
    setBusy(true);
    try {
      const r = await api<{ user: User | null; message: string }>(
        "/auth/signup",
        { method: "POST", body: json({ name, email, password, gender }) },
      );
      if (r.user) {
        setUser(r.user);
        setJoined(r.user);
        // The account exists now. The photo is the last, optional step.
        setStep(4);
        return;
      }
      setSuccess(
        "If that email is new you are in, otherwise sign in with the password you already have.",
      );
    } catch (err) {
      const code = err instanceof ApiError ? err.code || "" : "";
      setError(errorMessage(err));
      setErrorCode(code);
      // The email is the thing to fix, so that is the field that moves, and
      // the student is put back on the step that owns it.
      if (code === "account_exists") setStep(1);
      shakeField(code === "account_exists" ? "email" : "password");
    } finally {
      setBusy(false);
    }
  }

  /* The photo step. It runs against the session the password step created,
     so skipping costs nothing and a failed upload never blocks anyone. */
  async function finish() {
    if (!photo) {
      settle();
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("avatar", photo.file);
      const r = await api<{ user: User }>("/profile/avatar", {
        method: "POST",
        body,
      });
      setUser(r.user);
      setJoined(r.user);
    } catch (err) {
      setError(errorMessage(err));
      shakeField("photo");
      setBusy(false);
      return;
    }
    setBusy(false);
    settle();
  }

  if (done)
    return (
      <div className={`${blockClass(compact)} is-settled`}>
        <header className="auth-head">
          <SuccessCheck />
          <h1>You are confirmed.</h1>
          <p className="auth-fade-in">
            Welcome to Handoff, {name.split(" ")[0] || "student"}.
          </p>
        </header>
      </div>
    );

  if (success)
    return (
      <div className={blockClass(compact)}>
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

  const toSignIn = `/sign-in?next=${encodeURIComponent(next)}${
    email ? `&email=${encodeURIComponent(email)}` : ""
  }`;

  return (
    <div className={blockClass(compact)}>
      <header className="auth-head">
        <h1>{signUpHeadline(next, reason)}</h1>
        <p>{STUDENTS_ONLY_LINE}</p>
      </header>
      <p className="auth-step-name">
        Step {step} of {STEPS} · {STEP_NAMES[step - 1]}
      </p>
      <ol className="auth-progress" aria-label={`Step ${step} of ${STEPS}`}>
        {[1, 2, 3, 4].map((n) => (
          <li
            key={n}
            className={n < step ? "is-done" : n === step ? "is-active" : ""}
          />
        ))}
      </ol>
      {error &&
        (errorCode === "account_exists" ? (
          <div className="auth-exists auth-fade-in" role="alert">
            <AlertCircle size={18} />
            <div>
              <p>{error}</p>
              {onSwitch ? (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => onSwitch("signin")}
                >
                  Sign in
                  <ArrowRight size={15} />
                </button>
              ) : (
                <Link className="button secondary small" to={toSignIn}>
                  Sign in
                  <ArrowRight size={15} />
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="auth-fade-in">
            <ErrorBox message={error} />
          </div>
        ))}
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
            <Field
              label="Student email"
              error={fieldErrors.email}
              className={fieldClass("email")}
            >
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
                  if (errorCode === "account_exists") {
                    setError("");
                    setErrorCode("");
                  }
                }}
                placeholder={`you@${campuses[0]?.domain || "usc.edu"}`}
              />
            </Field>
            {detected && (
              <p className="auth-school-line auth-rise-in" key={detected.domain}>
                <SchoolLogo
                  src={`/api/logo/${encodeURIComponent(detected.domain)}`}
                />
                <span>{detected.name}</span>
                {!detected.live && (
                  <small>Browsing only for now, listings open soon</small>
                )}
              </p>
            )}
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
              className={fieldClass("name")}
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
              <p className="auth-school-line auth-rise-in" key={detected.domain}>
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
            <Field
              label="Password"
              error={fieldErrors.password}
              className={fieldClass("password")}
            >
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
        <section
          className="t-page photo-step"
          data-page-id="4"
          aria-hidden={step !== 4}
          style={{ "--t-page-from-x": "8px" } as React.CSSProperties}
        >
          <div className={`auth-form ${fieldClass("photo")}`}>
            <PhotoPicker
              src={photo?.preview}
              name={name}
              busy={busy}
              onPick={(file) => {
                if (photo) URL.revokeObjectURL(photo.preview);
                setPhoto({ file, preview: URL.createObjectURL(file) });
                setError("");
              }}
              onRemove={() => {
                if (photo) URL.revokeObjectURL(photo.preview);
                setPhoto(null);
              }}
            />
            <Button
              type="button"
              busy={busy}
              className="auth-cta"
              tabIndex={step === 4 ? undefined : -1}
              onClick={finish}
            >
              Finish
              <ArrowRight size={17} />
            </Button>
            <button
              type="button"
              className="auth-back text-button"
              tabIndex={step === 4 ? undefined : -1}
              onClick={() => {
                if (photo) URL.revokeObjectURL(photo.preview);
                setPhoto(null);
                settle();
              }}
            >
              Skip for now
            </button>
          </div>
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
            <Link to={toSignIn}>Sign in</Link>
          )}
        </p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- forgot */

export function ForgotForm({
  onSwitch,
  compact,
  email: seedEmail,
  onEmail,
}: AuthFormProps) {
  const { campuses: allCampuses, emailReady } = useApp();
  const campuses = liveCampuses(allCampuses);
  const { ref, shake } = useShake();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [email, setEmailValue] = useState(seedEmail || ""),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const setEmail = (value: string) => {
    setEmailValue(value);
    onEmail?.(value);
  };

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
