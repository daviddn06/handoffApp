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
import { Button, Field } from "./ui";
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
/** The terms footnote, the same words under every signed out form. */
export function TermsFootnote() {
  return (
    <p className="auth-fineprint">
      By continuing you agree to the{" "}
      <a href="/terms" target="_blank" rel="noreferrer">
        Terms of Service
      </a>{" "}
      and{" "}
      <a href="/privacy" target="_blank" rel="noreferrer">
        Privacy Policy
      </a>
      .
    </p>
  );
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
      setFieldErrors({ password: errorMessage(err) });
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
        <div className="auth-row is-single">
          <p className="auth-switch">
            New here?{" "}
            {onSwitch ? (
              <button
                type="button"
                className="text-button"
                onClick={() => onSwitch("signup")}
              >
                Confirm you are a student
              </button>
            ) : (
              <Link to={`/sign-up?next=${encodeURIComponent(next)}`}>
                Confirm you are a student
              </Link>
            )}
          </p>
        </div>
      </form>
      <TermsFootnote />
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
    [exists, setExists] = useState(false),
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

  /* The step container grows and shrinks with the card resize tokens rather
     than snapping, then goes back to auto so nothing is ever held at a stale
     height. transitions.dev card resize. */
  const lastHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const root = slideRef.current;
    if (!root) return;
    const from = lastHeight.current;
    root.style.height = "auto";
    const to = root.offsetHeight;
    lastHeight.current = to;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (from === null || from === to || reduced) return;
    root.style.height = `${from}px`;
    void root.offsetHeight;
    root.style.height = `${to}px`;
    let timer = 0;
    const release = () => {
      root.style.height = "";
      window.clearTimeout(timer);
      root.removeEventListener("transitionend", release);
    };
    root.addEventListener("transitionend", release);
    timer = window.setTimeout(release, 600);
    return release;
  }, [step, exists, emailReady, detected, fieldErrors, strength.hint, photo]);
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
    if (step === 1) {
      const problems = checkFields(["email"], { email, name, password });
      setFieldErrors(problems);
      if (Object.keys(problems).length) {
        shakeField("email");
        return;
      }
      // One request, on Continue. An email that is already taken is stopped
      // here rather than after four steps of typing.
      setExists(false);
      setBusy(true);
      try {
        const answer = await api<{
          exists: boolean;
          school: { name: string; domain: string; live: boolean };
        }>("/auth/check-email", { method: "POST", body: json({ email }) });
        if (answer.exists) {
          setExists(true);
          shakeField("email");
          return;
        }
        setStep(2);
      } catch (err) {
        setFieldErrors({ email: errorMessage(err) });
        shakeField("email");
      } finally {
        setBusy(false);
      }
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
      // The email is the thing to fix, so the student goes back to the step
      // that owns it and the amber card explains the way out.
      if (code === "account_exists") {
        setExists(true);
        setStep(1);
        shakeField("email");
      } else {
        setFieldErrors({ password: errorMessage(err) });
        shakeField("password");
      }
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
      setFieldErrors({ photo: errorMessage(err) });
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

  /* The one row under the primary button: a quiet way back on the left, the
     way over to sign in on the right. */
  const footerRow = (back?: () => void) => (
    <div className={`auth-row ${back ? "" : "is-single"}`}>
      {back && (
        <button
          type="button"
          className="button ghost small auth-back"
          onClick={back}
        >
          <ArrowLeft size={15} />
          Back
        </button>
      )}
      <p className="auth-switch">
        Already confirmed?{" "}
        {onSwitch ? (
          <button
            type="button"
            className="text-button"
            onClick={() => onSwitch("signin")}
          >
            Sign in
          </button>
        ) : (
          <Link to={toSignIn}>Sign in</Link>
        )}
      </p>
    </div>
  );

  const schoolLine = detected && (
    <p className="auth-school-line auth-rise-in" key={detected.domain}>
      <SchoolLogo src={`/api/logo/${encodeURIComponent(detected.domain)}`} />
      <span>{detected.name}</span>
      {!detected.live && (
        <small>Browsing only for now, listings open soon</small>
      )}
    </p>
  );

  return (
    <div className={blockClass(compact)}>
      <header className="auth-head">
        <h1>{signUpHeadline(next, reason)}</h1>
        <p>{STUDENTS_ONLY_LINE}</p>
      </header>
      <div className="auth-steps">
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
      </div>
      <div className="auth-slide t-page-slide" ref={slideRef} data-step={step}>
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
                  setExists(false);
                }}
                placeholder={`you@${campuses[0]?.domain || "usc.edu"}`}
              />
            </Field>
            {exists ? (
              <div className="auth-exists auth-fade-in" role="alert">
                <AlertCircle size={17} />
                <div>
                  <p>This email already has an account.</p>
                  {onSwitch ? (
                    <button
                      type="button"
                      className="button secondary small"
                      tabIndex={step === 1 ? undefined : -1}
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
              schoolLine
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
            {footerRow()}
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
            {schoolLine}
            <Button
              type="submit"
              className="auth-cta"
              tabIndex={step === 2 ? undefined : -1}
            >
              Continue
              <ArrowRight size={17} />
            </Button>
            {footerRow(() => setStep(1))}
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
              hint="At least 8 characters. Nothing else is required."
              error={fieldErrors.password}
              className={fieldClass("password")}
            >
              <div className="password-input">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
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
            {footerRow(() => setStep(2))}
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
                clearField("photo");
              }}
              onRemove={() => {
                if (photo) URL.revokeObjectURL(photo.preview);
                setPhoto(null);
              }}
            />
            {fieldErrors.photo && (
              <span className="field-error">{fieldErrors.photo}</span>
            )}
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
            <div className="auth-row is-single">
              <button
                type="button"
                className="button ghost small auth-back"
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
          </div>
        </section>
      </div>
      <TermsFootnote />
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
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/auth/forgot", {
        method: "POST",
        body: json({ email }),
      });
      setSuccess(r.message);
    } catch (err) {
      setFieldErrors({ email: errorMessage(err) });
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
        <div className="auth-row is-single">
          <p className="auth-switch">
            Remembered it?{" "}
            {onSwitch ? (
              <button
                type="button"
                className="text-button"
                onClick={() => onSwitch("signin")}
              >
                Sign in
              </button>
            ) : (
              <Link to="/sign-in">Sign in</Link>
            )}
          </p>
        </div>
      </form>
    </div>
  );
}
