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
  openAuth: (options?: { mode?: AuthModalMode; next?: string }) => void;
  closeAuth: () => void;
};
export type AuthModalMode = "signup" | "signin";
export type AuthModalState = {
  open: boolean;
  mode: AuthModalMode;
  /** Where to go once they are in. */
  next: string;
  /** A key that changes on every open, so the modal remounts fresh. */
  key: number;
};
const AppContext = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
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
  // action opens this modal over the current screen instead.
  const [auth, setAuth] = useState<AuthModalState>({
    open: false,
    mode: "signup",
    next: "/browse",
    key: 0,
  });
  const openAuth = useCallback(
    (options?: { mode?: AuthModalMode; next?: string }) =>
      setAuth((current) => ({
        open: true,
        mode: options?.mode || "signup",
        // No target given means stay exactly where they are.
        next:
          options?.next ||
          window.location.pathname + window.location.search,
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
        setUser(session.user);
        setCampuses(config.campuses);
        setEmailReady(config.emailReady);
        setAiReady(Boolean(config.aiReady));
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    retry();
    const expired = () => setUser(null);
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
