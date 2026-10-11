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
import { Link } from "react-router-dom";
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import { ApiError, api, errorMessage, json } from "../lib/api";
import { useApp, type AuthReason } from "../lib/context";
import { Button, Field } from "./ui";
import type { Gender, ShareChannel, User } from "../types";
import { GenderChoice } from "./Gender";
import {
  liveCampuses,
  loadSchools,
  schoolForEmail,
  type School,
} from "../lib/schools";
import { passwordCheck, type PasswordCheck } from "../lib/password";
import { nameProblem, titleCaseName } from "../lib/name";
import { SchoolLogo } from "./SchoolSearch";
import { PhotoPicker } from "./PhotoPicker";
import { ContactFields, type ContactValues } from "./Contact";

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
  /** An account whose signup flow is still open, picked up where it stopped. */
  resume?: SignupResume;
};
/** The screen an unfinished account still owes, as the server names it. */
export type SignupStep = "code" | "name" | "photo" | "contact";
export type SignupResume = {
  step: SignupStep;
  email: string;
  name: string;
  user: User;
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
export function signUpHeadline(_next: string, _reason?: AuthReason) {
  return "Confirm your student email.";
}
/** The reason the student is here, shown as the support line under the h1. */
export function signUpLead(next: string, reason?: AuthReason) {
  const phrase = actionPhrase(next, reason);
  return phrase
    ? `Handoff is students only. Confirm with your school email ${phrase}.`
    : STUDENTS_ONLY_LINE;
}
/** The terms footnote, the same words under every signed out form. */
export function TermsFootnote() {
  return (
    <p className="auth-fineprint">
      By continuing you agree to our{" "}
      <a href="/terms" target="_blank" rel="noreferrer">
        Terms
      </a>{" "}
      and{" "}
      <a href="/privacy" target="_blank" rel="noreferrer">
        Privacy
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

/**
 * Sign up is one screen that keeps changing, not a numbered wizard, so there
 * is no step count anywhere in the UI. These are the screens in order.
 */
export const SIGNUP_EMAIL = 1;
export const SIGNUP_PASSWORD = 2;
export const SIGNUP_CODE = 3;
export const SIGNUP_NAME = 4;
export const SIGNUP_PHOTO = 5;
export const SIGNUP_CONTACT = 6;
const STEP_NUMBER: Record<SignupStep, number> = {
  code: SIGNUP_CODE,
  name: SIGNUP_NAME,
  photo: SIGNUP_PHOTO,
  contact: SIGNUP_CONTACT,
};
export function stepOf(step: SignupStep) {
  return STEP_NUMBER[step] ?? SIGNUP_CODE;
}
/** Every screen says what it is for. The first one also says why Handoff asks. */
function screenCopy(
  step: number,
  { next, reason, email }: { next: string; reason?: AuthReason; email: string },
) {
  const address = email.trim() || "your student email";
  if (step === SIGNUP_PASSWORD)
    return {
      heading: "Set a password.",
      lead: "At least 8 characters. Nothing else is required.",
    };
  if (step === SIGNUP_CODE)
    return {
      heading: "Enter the code we sent.",
      lead: `We sent a six digit code to ${address}.`,
    };
  if (step === SIGNUP_NAME)
    return {
      heading: "Set up your profile.",
      lead: "Your name is what other students see on your listings and requests.",
    };
  if (step === SIGNUP_PHOTO)
    return {
      heading: "Add a photo.",
      lead: "Optional, and you can change it later. It shows wherever your name does.",
    };
  if (step === SIGNUP_CONTACT)
    return {
      heading: "How should students reach you?",
      lead: "Email is always shared once a request is accepted. Add anything else you want to offer.",
    };
  return {
    heading: signUpHeadline(next, reason),
    lead: signUpLead(next, reason),
  };
}

/**
 * The six digit code input. One component, used by the /verify page and by the
 * code screen inside sign up, so there is one way to confirm a student email.
 */
export function OtpInput({
  digits,
  setDigits,
  disabled,
  autoFocus = true,
  tabIndex,
}: {
  digits: string[];
  setDigits: (next: string[]) => void;
  disabled?: boolean;
  /** Off inside the sign up slide, where a parked step must never take focus. */
  autoFocus?: boolean;
  tabIndex?: number;
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
          autoFocus={autoFocus && index === 0}
          tabIndex={tabIndex}
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
  if (fields.includes("name")) {
    const problem = nameProblem(values.name);
    if (problem) next.name = problem;
  }
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
  resume,
}: AuthFormProps) {
  const { setUser, campuses: allCampuses, emailReady, notify } = useApp();
  const campuses = liveCampuses(allCampuses);
  const { shakeField, fieldClass } = useFieldShake();
  const [busy, setBusy] = useState(false),
    [exists, setExists] = useState(false),
    [success, setSuccess] = useState(""),
    [email, setEmailValue] = useState(resume?.email || seedEmail || ""),
    [name, setName] = useState(resume?.name || ""),
    [gender, setGender] = useState<Gender>("unspecified"),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [step, setStep] = useState(resume ? stepOf(resume.step) : SIGNUP_EMAIL),
    [joined, setJoined] = useState<User | null>(resume?.user || null),
    [digits, setDigits] = useState(["", "", "", "", "", ""]),
    [cooldown, setCooldown] = useState(0),
    [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null),
    [contact, setContact] = useState<ContactValues>({
      phone: "",
      instagram: "",
      facebook: "",
    }),
    [channels, setChannels] = useState<ShareChannel[]>(["email"]),
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
  /* The session answers after the dialog has already mounted, so an account
     that never finished signing up arrives a moment late. Picking it up is a
     one time jump, and only while the form is still on its first screen, so
     nothing can pull a student backwards once they are typing. */
  const resumed = useRef(Boolean(resume));
  useEffect(() => {
    if (!resume || resumed.current) return;
    resumed.current = true;
    setStep((current) => {
      if (current !== SIGNUP_EMAIL) return current;
      setEmailValue(resume.email);
      setName(resume.name);
      setJoined(resume.user);
      return stepOf(resume.step);
    });
  }, [resume]);
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
  const code = digits.join("");

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
  }, [
    step,
    exists,
    emailReady,
    detected,
    fieldErrors,
    strength.hint,
    photo,
    contact,
  ]);
  /* Focus lands only once the slide has settled. Focusing mid transition
     scrolls the clipped track sideways, which is the bug this avoids. */
  useEffect(() => {
    if (step < SIGNUP_PASSWORD) return;
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
  useEffect(() => {
    if (!cooldown) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  /* Where the flow has got to, kept on the server, so closing the tab and
     signing in again picks the same screen back up. "done" is the only thing
     that opens the rest of the app, so it is the one whose failure is shown. */
  async function record(mark: SignupStep | "done") {
    try {
      const r = await api<{ user: User }>("/auth/signup-step", {
        method: "POST",
        body: json({ step: mark }),
      });
      setUser(r.user);
      setJoined(r.user);
      return true;
    } catch (err) {
      if (mark === "done") {
        setFieldErrors({ contact: errorMessage(err) });
        shakeField("contact");
        return false;
      }
      return true;
    }
  }

  /* Sign up steps. Enter advances, the password step creates the account. */
  async function advance(e: FormEvent) {
    e.preventDefault();
    if (step === SIGNUP_EMAIL) {
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
        setStep(SIGNUP_PASSWORD);
      } catch (err) {
        setFieldErrors({ email: errorMessage(err) });
        shakeField("email");
      } finally {
        setBusy(false);
      }
    }
  }

  /* The password step is the one that creates the account. */
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
        { method: "POST", body: json({ email, password, gender }) },
      );
      if (r.user) {
        setUser(r.user);
        setJoined(r.user);
        // The account exists now, unverified, and the code is on its way.
        setCooldown(30);
        setStep(SIGNUP_CODE);
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
        setStep(SIGNUP_EMAIL);
        shakeField("email");
      } else {
        setFieldErrors({ password: errorMessage(err) });
        shakeField("password");
      }
    } finally {
      setBusy(false);
    }
  }

  /* The code step. The same six digit input and the same contract as the
     /verify page, so there is one way to confirm a student email. */
  const submitCode = useCallback(
    async (value: string) => {
      setBusy(true);
      try {
        const r = await api<{ user: User }>("/auth/verify-code", {
          method: "POST",
          body: json({ code: value }),
        });
        setUser(r.user);
        setJoined(r.user);
        clearField("code");
        await record("name");
        setStep(SIGNUP_NAME);
      } catch (err) {
        setFieldErrors({ code: errorMessage(err) });
        shakeField("code");
        setDigits(["", "", "", "", "", ""]);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    if (step === SIGNUP_CODE && code.length === 6 && !busy) submitCode(code);
  }, [step, code, busy, submitCode]);

  async function resend() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/auth/resend", {
        method: "POST",
        body: json({ email }),
      });
      setCooldown(30);
      notify(r.message);
    } catch (err) {
      setFieldErrors({ code: errorMessage(err) });
      shakeField("code");
    } finally {
      setBusy(false);
    }
  }

  /* The name step. It writes through the profile route, because the account
     already exists by the time the student types it. */
  async function saveName(e: FormEvent) {
    e.preventDefault();
    const problems = checkFields(["name"], { email, name, password });
    setFieldErrors(problems);
    if (Object.keys(problems).length) {
      shakeField("name");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ user: User }>("/profile", {
        method: "PATCH",
        body: json({ name, bio: joined?.bio || "", gender }),
      });
      setUser(r.user);
      setJoined(r.user);
      setName(r.user.name);
    } catch (err) {
      setFieldErrors({ name: errorMessage(err) });
      shakeField("name");
      setBusy(false);
      return;
    }
    setBusy(false);
    await record("photo");
    setStep(SIGNUP_PHOTO);
  }

  /* The photo step. It runs against the session the password step created,
     so skipping costs nothing and a failed upload never blocks anyone. */
  async function savePhoto() {
    if (!photo) {
      await record("contact");
      setStep(SIGNUP_CONTACT);
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
    await record("contact");
    setStep(SIGNUP_CONTACT);
  }

  /* The contact step, the last one. Optional like the photo, and skipping
     leaves the student with email only, which is what every account starts
     with. Finishing here is what opens the rest of Handoff. */
  async function finish() {
    const nothingTyped = !Object.values(contact).some((value) => value.trim());
    setBusy(true);
    if (!nothingTyped) {
      try {
        const r = await api<{ user: User }>("/profile", {
          method: "PATCH",
          body: json({
            name,
            bio: joined?.bio || "",
            phone: contact.phone,
            instagram: contact.instagram,
            facebook: contact.facebook,
            shareChannels: channels,
          }),
        });
        setUser(r.user);
        setJoined(r.user);
      } catch (err) {
        setFieldErrors({ contact: errorMessage(err) });
        shakeField("contact");
        setBusy(false);
        return;
      }
    }
    const opened = await record("done");
    setBusy(false);
    if (opened) settle();
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

  /* The school sits in a slot that is there from the first paint, so
     recognising the school fades and rises into place instead of pushing the
     button, the footer and the fine print down the card. */
  const schoolSlot = (
    <div className="auth-school-slot" aria-live="polite">
      {detected && (
        <p className="auth-school-line is-in" key={detected.domain}>
          <SchoolLogo src={`/api/logo/${encodeURIComponent(detected.domain)}`} />
          <span>{detected.name}</span>
          {!detected.live && (
            <small>Browsing only for now, listings open soon</small>
          )}
        </p>
      )}
    </div>
  );

  const copy = screenCopy(step, { next, reason, email });

  return (
    <div className={blockClass(compact)}>
      <header className="auth-head auth-head-swap" key={step}>
        <h1>{copy.heading}</h1>
        <p>{copy.lead}</p>
      </header>
      <div className="auth-slide t-page-slide" ref={slideRef} data-step={step}>
        <section
          className="t-page"
          data-page-id={SIGNUP_EMAIL}
          aria-hidden={step !== SIGNUP_EMAIL}
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
                tabIndex={step === SIGNUP_EMAIL ? undefined : -1}
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
                      className="button primary small"
                      tabIndex={step === SIGNUP_EMAIL ? undefined : -1}
                      onClick={() => onSwitch("signin")}
                    >
                      Sign in
                      <ArrowRight size={15} />
                    </button>
                  ) : (
                    <Link className="button primary small" to={toSignIn}>
                      Sign in
                      <ArrowRight size={15} />
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              schoolSlot
            )}
            <Button
              type="submit"
              busy={busy && step === SIGNUP_EMAIL}
              variant={exists ? "secondary" : "primary"}
              className="auth-cta"
              disabled={exists}
              tabIndex={step === SIGNUP_EMAIL ? undefined : -1}
            >
              Continue
              <ArrowRight size={17} />
            </Button>
            {footerRow()}
          </form>
        </section>
        <section
          className="t-page"
          data-page-id={SIGNUP_PASSWORD}
          aria-hidden={step !== SIGNUP_PASSWORD}
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
                  minLength={8}
                  maxLength={128}
                  tabIndex={step === SIGNUP_PASSWORD ? undefined : -1}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearField("password");
                  }}
                />
                <button
                  type="button"
                  className="icon-button"
                  tabIndex={step === SIGNUP_PASSWORD ? undefined : -1}
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
                Email is paused on this server. The code may not arrive.
              </p>
            )}
            <Button
              type="submit"
              busy={busy && step === SIGNUP_PASSWORD}
              className="auth-cta"
              disabled={!strength.valid}
              tabIndex={step === SIGNUP_PASSWORD ? undefined : -1}
            >
              Confirm and continue
              <ArrowRight size={17} />
            </Button>
            {footerRow(() => setStep(SIGNUP_EMAIL))}
          </form>
        </section>
        <section
          className="t-page code-step"
          data-page-id={SIGNUP_CODE}
          aria-hidden={step !== SIGNUP_CODE}
          style={{ "--t-page-from-x": "8px" } as React.CSSProperties}
        >
          <div className={`auth-form ${fieldClass("code")}`}>
            <OtpInput
              digits={digits}
              setDigits={setDigits}
              disabled={busy || step !== SIGNUP_CODE}
              tabIndex={step === SIGNUP_CODE ? undefined : -1}
            />
            {fieldErrors.code && (
              <span className="field-error">{fieldErrors.code}</span>
            )}
            <Button
              type="button"
              busy={busy && step === SIGNUP_CODE}
              className="auth-cta"
              disabled={code.length !== 6}
              tabIndex={step === SIGNUP_CODE ? undefined : -1}
              onClick={() => submitCode(code)}
            >
              Verify
              <ArrowRight size={17} />
            </Button>
            <div className="auth-quiet-row">
              <button
                type="button"
                className="text-button auth-later"
                tabIndex={step === SIGNUP_CODE ? undefined : -1}
                onClick={async () => {
                  await record("name");
                  setStep(SIGNUP_NAME);
                }}
              >
                Do this later
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy || cooldown > 0}
                tabIndex={step === SIGNUP_CODE ? undefined : -1}
                onClick={resend}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </div>
        </section>
        <section
          className="t-page"
          data-page-id={SIGNUP_NAME}
          aria-hidden={step !== SIGNUP_NAME}
          style={{ "--t-page-from-x": "8px" } as React.CSSProperties}
        >
          <form className="auth-form" noValidate onSubmit={saveName}>
            <Field
              label="Your name"
              error={fieldErrors.name}
              className={fieldClass("name")}
            >
              <input
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={80}
                required
                tabIndex={step === SIGNUP_NAME ? undefined : -1}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearField("name");
                }}
                onBlur={() => setName((current) => titleCaseName(current))}
                placeholder="First and last name"
              />
            </Field>
            <GenderChoice
              name="signup-gender"
              value={gender}
              onChange={setGender}
              tabIndex={step === SIGNUP_NAME ? undefined : -1}
            />
            <Button
              type="submit"
              busy={busy && step === SIGNUP_NAME}
              className="auth-cta"
              tabIndex={step === SIGNUP_NAME ? undefined : -1}
            >
              Continue
              <ArrowRight size={17} />
            </Button>
          </form>
        </section>
        <section
          className="t-page signup-photo-step"
          data-page-id={SIGNUP_PHOTO}
          aria-hidden={step !== SIGNUP_PHOTO}
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
              busy={busy && step === SIGNUP_PHOTO}
              className="auth-cta"
              tabIndex={step === SIGNUP_PHOTO ? undefined : -1}
              onClick={savePhoto}
            >
              Continue
              <ArrowRight size={17} />
            </Button>
            <div className="auth-quiet-row is-single">
              <button
                type="button"
                className="text-button auth-later"
                tabIndex={step === SIGNUP_PHOTO ? undefined : -1}
                onClick={async () => {
                  if (photo) URL.revokeObjectURL(photo.preview);
                  setPhoto(null);
                  await record("contact");
                  setStep(SIGNUP_CONTACT);
                }}
              >
                Do this later
              </button>
            </div>
          </div>
        </section>
        <section
          className="t-page contact-step"
          data-page-id={SIGNUP_CONTACT}
          aria-hidden={step !== SIGNUP_CONTACT}
          style={{ "--t-page-from-x": "8px" } as React.CSSProperties}
        >
          <div className={`auth-form ${fieldClass("contact")}`}>
            <ContactFields
              email={email}
              values={contact}
              onValues={setContact}
              channels={channels}
              onChannels={setChannels}
              tabIndex={step === SIGNUP_CONTACT ? undefined : -1}
            />
            {fieldErrors.contact && (
              <span className="field-error">{fieldErrors.contact}</span>
            )}
            <Button
              type="button"
              busy={busy && step === SIGNUP_CONTACT}
              className="auth-cta"
              tabIndex={step === SIGNUP_CONTACT ? undefined : -1}
              onClick={finish}
            >
              Finish
              <ArrowRight size={17} />
            </Button>
            <div className="auth-quiet-row is-single">
              <button
                type="button"
                className="text-button auth-later"
                tabIndex={step === SIGNUP_CONTACT ? undefined : -1}
                onClick={finish}
              >
                Do this later
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
          <p className="auth-hint is-notice">
            <AlertCircle size={15} />
            Email is paused on this server. The link may not arrive.
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
