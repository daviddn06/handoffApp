import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useApp } from "../lib/context";
import { backdropClick, trapTab, useDialogMotion } from "./ui";
import {
  ForgotForm,
  SignInForm,
  SignUpForm,
  type AuthFormMode,
} from "./AuthForms";

/**
 * Confirming you are a student never takes a signed out visitor off the page.
 * Every protected action opens this dialog over the current screen, blurred
 * behind, and it defaults to sign up because most people clicking are new.
 * Rendered once by the layout.
 */
export function AuthModal() {
  const { auth, closeAuth, notify } = useApp();
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<AuthFormMode>(auth.mode);
  // Kept across a switch, so "Sign in instead" arrives with the email filled.
  const [email, setEmail] = useState("");
  const motion = useDialogMotion(auth.open, ref);

  useEffect(() => {
    if (auth.open) setMode(auth.mode);
  }, [auth.open, auth.key, auth.mode]);

  function done() {
    closeAuth();
    const here = window.location.pathname + window.location.search;
    if (auth.next && auth.next !== here) navigate(auth.next);
  }

  return (
    <dialog
      className={`auth-modal ${motion}`.trim()}
      ref={ref}
      aria-label={mode === "signin" ? "Sign in" : "Confirm you are a student"}
      onCancel={(e) => {
        e.preventDefault();
        closeAuth();
      }}
      onKeyDown={trapTab}
      onClick={(e) => backdropClick(e, closeAuth)}
    >
      <span className="sheet-grip" aria-hidden="true">
        <span />
      </span>
      <button
        type="button"
        className="icon-button modal-close auth-modal-close"
        aria-label="Close"
        onClick={closeAuth}
      >
        <X size={20} />
      </button>
      <div className="auth-modal-body" key={auth.key}>
        <div className="auth-modal-inner">
          {mode === "signup" && (
            <SignUpForm
              compact
              next={auth.next}
              reason={auth.reason}
              email={email}
              onEmail={setEmail}
              onSwitch={setMode}
              onDone={done}
            />
          )}
          {mode === "signin" && (
            <SignInForm
              compact
              next={auth.next}
              reason={auth.reason}
              email={email}
              onEmail={setEmail}
              onSwitch={setMode}
              onDone={(user) => {
                notify(`Welcome back, ${user.name.split(" ")[0]}.`);
                done();
              }}
            />
          )}
          {mode === "forgot" && (
            <ForgotForm
              compact
              next={auth.next}
              email={email}
              onEmail={setEmail}
              onSwitch={setMode}
            />
          )}
        </div>
      </div>
    </dialog>
  );
}
