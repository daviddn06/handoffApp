import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, Mail } from "lucide-react";
import { ApiError, api, errorMessage, json } from "../lib/api";
import { useApp } from "../lib/context";
import { passwordCheck } from "../lib/password";
import type { User } from "../types";
import { PasswordMeter } from "./AuthForms";
import { Button, ErrorBox, Field, Loading } from "./ui";

const uscEmail = (value: string) => /^[^\s@]+@(?:[a-z0-9-]+\.)*usc\.edu$/i.test(value.trim());
const inputStyle = { fontSize: 16, minHeight: 48 };
type Action = "auth" | "verify" | "resend" | "claim" | "logout";

/** Compact access flow for a private referral. The parent performs the attested claim. */
export function ReferralAccess({ authorName, onReady }: { authorName: string; onReady: () => Promise<void> }) {
  const { user, setUser, loading, emailReady } = useApp();
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState(authorName.slice(0, 80));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [cooldown, setCooldown] = useState(0);
  const pending = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const strength = passwordCheck(password, { email, name });
  const isUsc = Boolean(user && user.campusId === "usc" && uscEmail(user.email));

  useEffect(() => { setConfirmed(false); setCode(""); setError(""); setFields({}); setNotice(""); }, [user?.id, user?.verified]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  // An email-link verification in another tab should also advance this open dialog.
  useEffect(() => {
    if (!user || user.verified) return;
    const refresh = () => {
      if (document.visibilityState !== "visible" || pending.current) return;
      api<{ user: User | null }>("/session").then((result) => {
        if (result.user?.verified || !result.user) setUser(result.user);
      }).catch(() => { /* A temporary connection loss leaves the code form available. */ });
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [user, setUser]);

  function clear(field: string) {
    setFields((current) => ({ ...current, [field]: "" }));
    setError("");
    setNotice("");
  }
  async function run(action: Action, task: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(action); setError(""); setNotice("");
    try { await task(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { pending.current = false; setBusy(null); }
  }
  function switchMode() {
    setMode((current) => current === "signup" ? "signin" : "signup");
    setFields({}); setError(""); setNotice(""); setPassword("");
  }
  async function authenticate(event: FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (!uscEmail(email)) problems.email = "Use your USC email, like you@usc.edu.";
    if (mode === "signup" && name.trim().length < 2) problems.name = "Enter your name.";
    if (mode === "signup" ? !strength.valid : !password) problems.password = mode === "signup" ? strength.problem : "Enter your password.";
    setFields(problems);
    if (Object.keys(problems).length) return;
    await run("auth", async () => {
      try {
        const result = await api<{ user: User }>(`/auth/${mode === "signup" ? "signup" : "login"}`, {
          method: "POST", body: json({ email: email.trim().toLowerCase(), password, ...(mode === "signup" ? { name: name.trim() } : {}) }),
        });
        setPassword(""); setUser(result.user);
        if (!result.user.verified && mode === "signup") setCooldown(30);
      } catch (reason) {
        if (reason instanceof ApiError && reason.code === "account_exists") { setMode("signin"); setPassword(""); }
        throw reason;
      }
    });
  }
  async function verify(value: string) {
    if (!/^\d{6}$/.test(value)) { setFields({ code: "Enter the six-digit code from your email." }); return; }
    await run("verify", async () => {
      try {
        const result = await api<{ user: User }>("/auth/verify-code", { method: "POST", body: json({ code: value }) });
        setUser(result.user);
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401) setUser(null);
        setCode(""); codeInput.current?.focus({ preventScroll: true });
        throw reason;
      }
    });
  }
  const signOut = () => run("logout", async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null); setEmail(""); setPassword(""); setMode("signin");
  });

  if (loading) return <Loading label="Checking your account…" />;
  if (user && !isUsc) return <div className="referral-access stack">
    <h2>Use your USC account.</h2>
    <p>This draft can be claimed with a verified USC email. You're signed in as <strong style={{ overflowWrap: "anywhere" }}>{user.email}</strong>.</p>
    {error && <ErrorBox message={error} />}
    <Button type="button" busy={busy === "logout"} onClick={signOut}>Switch account</Button>
  </div>;

  if (user?.verified) return <form className="referral-access stack" onSubmit={(event) => {
    event.preventDefault();
    if (!confirmed) { setError("Confirm this is your sublease to continue."); return; }
    void run("claim", onReady);
  }}>
    <header className="stack" style={{ gap: 8 }}><CheckCircle2 size={30} aria-hidden="true" /><h2>Make this draft yours.</h2><p>Your USC email is verified. You'll review the details before publishing.</p></header>
    <label className="check-label referral-consent" style={{ alignItems: "flex-start", paddingBlock: 12, lineHeight: 1.5 }}>
      <input type="checkbox" required checked={confirmed} disabled={Boolean(busy)} onChange={(event) => { setConfirmed(event.target.checked); setError(""); }} />
      <span>I am a current USC student, this is my sublease, and I have the right to list it and use these photos. I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
    </label>
    {error && <ErrorBox message={error} />}
    <Button type="submit" busy={busy === "claim"} disabled={Boolean(busy) || !confirmed}>Review my listing <ArrowRight size={17} /></Button>
    <Button type="button" variant="ghost" busy={busy === "logout"} disabled={Boolean(busy)} onClick={signOut}>Use another account</Button>
  </form>;

  if (user) return <div className="referral-access stack">
    <header className="stack" style={{ gap: 8 }}><Mail size={28} aria-hidden="true" /><h2>Check your USC inbox.</h2><p>Enter the code sent to <strong style={{ overflowWrap: "anywhere" }}>{user.email}</strong>.</p></header>
    <form className="auth-form" noValidate onSubmit={(event) => { event.preventDefault(); void verify(code); }}>
      <Field label="Verification code" error={fields.code} hint="Six digits. Check spam if it hasn't arrived.">
        <input ref={codeInput} name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={Boolean(busy)}
          style={{ ...inputStyle, fontSize: 24, letterSpacing: ".22em", fontVariantNumeric: "tabular-nums", textAlign: "center" }}
          onChange={(event) => { const value = event.target.value.replace(/\D/g, "").slice(0, 6); setCode(value); clear("code"); if (value.length === 6) void verify(value); }} />
      </Field>
      {error && <ErrorBox message={error} />}
      {notice && <p role="status" className="field-hint">{notice}</p>}
      <Button type="submit" busy={busy === "verify"} disabled={Boolean(busy) || code.length !== 6}>Verify email <ArrowRight size={17} /></Button>
    </form>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
      <Button type="button" variant="ghost" busy={busy === "resend"} disabled={Boolean(busy) || cooldown > 0 || !emailReady} style={{ fontVariantNumeric: "tabular-nums" }} onClick={() => void run("resend", async () => {
        await api("/auth/resend", { method: "POST", body: json({ email: user.email }) });
        setCode(""); setFields({}); setCooldown(30); setNotice("A new code is on its way. Use the most recent email.");
      })}>{cooldown ? `Resend in ${cooldown}s` : "Resend code"}</Button>
      <Button type="button" variant="ghost" busy={busy === "logout"} disabled={Boolean(busy)} onClick={signOut}>Use another email</Button>
    </div>
    {!emailReady && <p className="field-hint">Email delivery is temporarily unavailable. Try again later.</p>}
  </div>;

  return <div className="referral-access stack">
    <header className="stack" style={{ gap: 8 }}><h2>{mode === "signup" ? "Your listing is almost yours." : "Welcome back."}</h2><p>{mode === "signup" ? "Create your account with your USC email to review this draft." : "Sign in to claim your private draft."}</p></header>
    <form className="auth-form" noValidate onSubmit={authenticate}>
      {mode === "signup" && <Field label="Your name" error={fields.name}><input name="name" autoComplete="name" required maxLength={80} value={name} disabled={Boolean(busy)} style={inputStyle} onChange={(event) => { setName(event.target.value); clear("name"); }} /></Field>}
      <Field label="USC email" error={fields.email}><input name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder="you@usc.edu" value={email} disabled={Boolean(busy)} style={inputStyle} onChange={(event) => { setEmail(event.target.value); clear("email"); }} /></Field>
      <Field label="Password" error={fields.password} hint={mode === "signup" && !password ? "At least 8 characters." : undefined}>
        <div className="password-wrap" style={{ position: "relative" }}><input name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required maxLength={128} value={password} disabled={Boolean(busy)} style={{ ...inputStyle, width: "100%", paddingRight: 50 }} onChange={(event) => { setPassword(event.target.value); clear("password"); }} />
          <button type="button" className="icon-button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} disabled={Boolean(busy)} onClick={() => setShowPassword((visible) => !visible)} style={{ position: "absolute", right: 4, top: 4, width: 40, height: 40 }}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </div>
      </Field>
      {mode === "signup" && password && <PasswordMeter check={strength} />}
      {error && <ErrorBox message={error} />}
      {mode === "signup" && !emailReady && <p className="field-hint">Student email delivery is temporarily unavailable. Please try again later.</p>}
      <Button type="submit" busy={busy === "auth"} disabled={Boolean(busy) || (mode === "signup" && !emailReady)}>{mode === "signup" ? "Continue with USC email" : "Sign in"} <ArrowRight size={17} /></Button>
    </form>
    <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={switchMode}>{mode === "signup" ? "Already have an account? Sign in" : "New to Handoff? Create an account"}</Button>
    {mode === "signin" && <a href={`/forgot-password?next=${encodeURIComponent(window.location.pathname)}`} target="_blank" rel="noreferrer" style={{ textAlign: "center", minHeight: 40, display: "grid", placeItems: "center" }}>Forgot password?</a>}
  </div>;
}
