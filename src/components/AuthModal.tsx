import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useApp } from "../lib/context";
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
  const trigger = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<AuthFormMode>(auth.mode);

  useEffect(() => {
    if (auth.open) setMode(auth.mode);
  }, [auth.open, auth.key, auth.mode]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (auth.open && !el.open) {
      trigger.current = document.activeElement as HTMLElement | null;
      el.showModal();
    }
    if (!auth.open && el.open) {
      el.close();
      // Back to whatever they clicked, so the keyboard keeps its place.
      trigger.current?.focus?.();
    }
  }, [auth.open]);

  function done() {
    closeAuth();
    const here = window.location.pathname + window.location.search;
    if (auth.next && auth.next !== here) navigate(auth.next);
  }

  return (
    <dialog
      className="auth-modal"
      ref={ref}
      aria-label={mode === "signin" ? "Sign in" : "Confirm you are a student"}
      onCancel={(e) => {
        e.preventDefault();
        closeAuth();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const items = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ).filter((el) => el.offsetParent !== null && el.tabIndex !== -1);
        const first = items[0],
          last = items[items.length - 1];
        if (!first) return;
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === e.currentTarget)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          closeAuth();
      }}
    >
      <span className="sheet-grip" aria-hidden="true">
        <span />
      </span>
      <button
        type="button"
        className="icon-button auth-modal-close"
        aria-label="Close"
        onClick={closeAuth}
      >
        <X size={20} />
      </button>
      <div className="auth-modal-body" key={auth.key}>
        {mode === "signup" && (
          <SignUpForm
            compact
            next={auth.next}
            onSwitch={setMode}
            onDone={done}
          />
        )}
        {mode === "signin" && (
          <SignInForm
            compact
            next={auth.next}
            onSwitch={setMode}
            onDone={(user) => {
              notify(`Welcome back, ${user.name.split(" ")[0]}.`);
              done();
            }}
          />
        )}
        {mode === "forgot" && (
          <ForgotForm compact next={auth.next} onSwitch={setMode} />
        )}
      </div>
    </dialog>
  );
}
