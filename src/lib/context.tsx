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
  notify: (message: string, kind?: "success" | "error") => void;
};
const AppContext = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [campuses, setCampuses] = useState<Campus[]>([]),
    [emailReady, setEmailReady] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    kind: "success" | "error";
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      api<{ emailReady: boolean; campuses: Campus[] }>("/config"),
    ])
      .then(([session, config]) => {
        setUser(session.user);
        setCampuses(config.campuses);
        setEmailReady(config.emailReady);
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
        notify,
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
