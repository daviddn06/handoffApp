import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, errorMessage } from "./api";
import type { Campus, User } from "../types";
import { CheckCircle2, X, AlertCircle } from "lucide-react";
type AppContextValue = {
  user: User | null;
  setUser: (u: User | null) => void;
  loading: boolean;
  error: string;
  retry: () => void;
  campuses: Campus[];
  emailReady: boolean;
  /** True when Smart import and the chat helper have a model configured. */
  aiReady: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  /** The overlay sign up modal, opened from anywhere a signed out student acts. */
  auth: AuthModalState;
  openAuth: (options?: {
    mode?: AuthModalMode;
    next?: string;
    reason?: AuthReason;
  }) => void;
  closeAuth: () => void;
};
export type AuthModalMode = "signup" | "signin";
/** What the student was reaching for. It names the action in the headline. */
export type AuthReason =
  | "saved"
  | "requests"
  | "my-listings"
  | "new-listing"
  | "request"
  | "details"
  | "save"
  | "default";
export type AuthModalState = {
  open: boolean;
  mode: AuthModalMode;
  /** Where to go once they are in. */
  next: string;
  /** What they were trying to do, which the headline says back to them. */
  reason: AuthReason;
  /** A key that changes on every open, so the modal remounts fresh. */
  key: number;
};

/** Routes a signed out visitor can never see. The modal stands in for them. */
const GUARDED_ROUTES: Array<{ path: string; reason: AuthReason }> = [
  { path: "/saved", reason: "saved" },
  { path: "/requests", reason: "requests" },
  { path: "/my-listings", reason: "my-listings" },
  { path: "/listings/new", reason: "new-listing" },
  { path: "/profile", reason: "default" },
];
const REASONS = new Set<string>([
  "saved",
  "requests",
  "my-listings",
  "new-listing",
  "request",
  "details",
  "save",
  "default",
]);
const asReason = (value: string | null): AuthReason =>
  value && REASONS.has(value) ? (value as AuthReason) : "default";
const safePath = (value: string | null | undefined) =>
  value && value.startsWith("/") && !value.startsWith("//") ? value : "";
const CLOSED: AuthModalState = {
  open: false,
  mode: "signup",
  next: "/browse",
  reason: "default",
  key: 0,
};
/** A hint that survives a reload, so a returning student never sees a flash. */
const SIGNED_IN_HINT = "handoff:signed-in";
const HANDOFF_KEY = "handoff:auth-intent";
const readHint = () => {
  try {
    return window.localStorage.getItem(SIGNED_IN_HINT) === "1";
  } catch {
    return false;
  }
};
const writeHint = (signedIn: boolean) => {
  try {
    if (signedIn) window.localStorage.setItem(SIGNED_IN_HINT, "1");
    else window.localStorage.removeItem(SIGNED_IN_HINT);
  } catch {
    /* Private windows refuse storage. The modal still works. */
  }
};
/**
 * What the very first render already knows. A direct hit on a protected route,
 * an ?auth=signup&next=/saved link, or a handoff left in sessionStorage all
 * resolve here, synchronously, so the dialog is open in the same frame the
 * page paints. Nothing navigates and no protected screen is ever drawn.
 */
function initialAuth(): AuthModalState {
  if (typeof window === "undefined") return CLOSED;
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  let handoff: { mode?: string; next?: string; reason?: string } | null = null;
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_KEY);
    if (raw) {
      window.sessionStorage.removeItem(HANDOFF_KEY);
      handoff = JSON.parse(raw);
    }
  } catch {
    handoff = null;
  }
  const asked = params.get("auth") || handoff?.mode;
  const guarded = GUARDED_ROUTES.find(
    (route) => pathname === route.path || pathname.startsWith(`${route.path}/`),
  );
  if (!asked && !guarded) return CLOSED;
  // A student we believe is signed in gets the page, not the dialog. If the
  // session turns out to be gone, the check below opens it a moment later.
  if (readHint()) return CLOSED;
  const next =
    safePath(params.get("next")) ||
    safePath(handoff?.next) ||
    (guarded ? pathname + search : "/browse");
  return {
    open: true,
    mode: asked === "signin" ? "signin" : "signup",
    next,
    reason: guarded
      ? guarded.reason
      : asReason(params.get("reason") || handoff?.reason || null),
    key: 1,
  };
}
const AppContext = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null),
    [campuses, setCampuses] = useState<Campus[]>([]),
    [emailReady, setEmailReady] = useState(false),
    [aiReady, setAiReady] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    kind: "success" | "error";
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Signed out students never leave the page they are on. Every protected
  // action opens this modal over the current screen instead. A direct hit on
  // a protected route decides this before the first paint, never after it.
  const [auth, setAuth] = useState<AuthModalState>(initialAuth);
  const setUser = useCallback((next: User | null) => {
    writeHint(Boolean(next));
    setUserState(next);
    // The dialog closes itself once its success check has settled, so signing
    // in does not yank it away the moment the session lands.
  }, []);
  const openAuth = useCallback(
    (options?: {
      mode?: AuthModalMode;
      next?: string;
      reason?: AuthReason;
    }) =>
      setAuth((current) => ({
        open: true,
        mode: options?.mode || "signup",
        // No target given means stay exactly where they are.
        next:
          options?.next || window.location.pathname + window.location.search,
        reason: options?.reason || "default",
        key: current.key + 1,
      })),
    [],
  );
  const closeAuth = useCallback(
    () => setAuth((current) => ({ ...current, open: false })),
    [],
  );
  const notify = useCallback(
    (message: string, kind: "success" | "error" = "success") => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, kind });
      timer.current = setTimeout(() => setToast(null), 6000);
    },
    [],
  );
  const retry = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([
      api<{ user: User | null }>("/session"),
      api<{ emailReady: boolean; aiReady: boolean; campuses: Campus[] }>(
        "/config",
      ),
    ])
      .then(([session, config]) => {
        writeHint(Boolean(session.user));
        setUserState(session.user);
        // A stale signed in hint kept the dialog shut. Now we know better.
        if (!session.user)
          setAuth((current) => (current.open ? current : initialAuth()));
        else setAuth((current) => ({ ...current, open: false }));
        setCampuses(config.campuses);
        setEmailReady(config.emailReady);
        setAiReady(Boolean(config.aiReady));
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    retry();
    const expired = () => {
      writeHint(false);
      setUserState(null);
    };
    window.addEventListener("handoff:session-expired", expired);
    return () => {
      window.removeEventListener("handoff:session-expired", expired);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [retry]);
  return (
    <AppContext.Provider
      value={{
        user,
        setUser,
        loading,
        error,
        retry,
        campuses,
        emailReady,
        aiReady,
        notify,
        auth,
        openAuth,
        closeAuth,
      }}
    >
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast && (
          <div className={`toast ${toast.kind} is-open`} key={toast.message}>
            {toast.kind === "success" ? (
              <CheckCircle2 size={20} />
            ) : (
              <AlertCircle size={20} />
            )}
            <span>{toast.message}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              <X size={18} />
            </button>
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("Missing app provider");
  return value;
}
