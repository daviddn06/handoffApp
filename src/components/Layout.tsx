import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  Navigate,
} from "react-router-dom";
import {
  ArrowUpRight,
  MailCheck,
  Search,
  Heart,
  Inbox,
  House,
  Plus,
  ChevronDown,
  UserRound,
  LogOut,
  Check,
} from "lucide-react";
import { useApp } from "../lib/context";
import { api, errorMessage } from "../lib/api";
import { ErrorBox, Loading } from "./ui";
const links = [
  { to: "/browse", label: "Browse", icon: Search },
  { to: "/saved", label: "Saved", icon: Heart },
  { to: "/requests", label: "Requests", icon: Inbox },
  { to: "/my-listings", label: "My listings", icon: House },
];
export function Brand() {
  return (
    <a
      className="brand"
      href="https://handofflease.com/"
      aria-label="Handoff home"
    >
      Handoff
    </a>
  );
}
/** Embedded mode, used by the homepage to show the real app inside a frame. */
export const isEmbed = () =>
  new URLSearchParams(window.location.search).get("embed") === "1";

export function Layout() {
  const { user, setUser, loading, error, retry, notify } = useApp(),
    navigate = useNavigate(),
    location = useLocation();
  const embed = isEmbed();
  useEffect(() => {
    document.documentElement.classList.toggle("is-embed", embed);
    if (!embed) return;
    // Inside the homepage frame every navigation opens the full app instead.
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (!href.startsWith("/")) return;
      e.preventDefault();
      window.open(new URL(href, window.location.origin).toString(), "_blank", "noopener");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [embed]);
  const [menu, setMenu] = useState(false),
    [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
    const names: Record<string, string> = {
      "/browse": "Browse",
      "/saved": "Saved places",
      "/requests": "Requests",
      "/my-listings": "My listings",
      "/profile": "Profile",
      "/sign-in": "Sign in",
      "/sign-up": "Create account",
      "/verify": "Verify your email",
      "/forgot-password": "Forgot password",
      "/reset-password": "Reset password",
      "/listings/new": "List your place",
    };
    document.title = `${names[location.pathname] || "Your next place"} · Handoff`;
  }, [location.pathname]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  async function logout() {
    setLoggingOut(true);
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setMenu(false);
      navigate("/browse");
      notify("You’re signed out.");
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav className="desktop-nav" aria-label="Main navigation">
            {links.map(({ to, label }) => (
              <NavLink key={to} to={to}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <Link to="/listings/new" className="button primary list-place">
              <Plus size={17} />
              <span>List your place</span>
            </Link>
            {user ? (
              <div className="user-menu" ref={menuRef}>
                <button
                  className="avatar-button"
                  aria-label="Account menu"
                  aria-expanded={menu}
                  aria-controls="account-menu"
                  onClick={() => setMenu(!menu)}
                >
                  <span className="avatar">
                    {user.name
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <ChevronDown size={15} />
                </button>
                {menu && (
                  <div className="account-menu" id="account-menu">
                    <div className="menu-identity">
                      <strong>{user.name}</strong>
                      <span>{user.email}</span>
                      {user.verified && (
                        <small>
                          <Check size={13} />
                          Verified student
                        </small>
                      )}
                    </div>
                    <Link to="/profile">
                      <UserRound size={16} />
                      Your profile
                    </Link>
                    <button onClick={logout} disabled={loggingOut}>
                      <LogOut size={16} />
                      {loggingOut ? "Signing out…" : "Sign out"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link to="/sign-in" className="button ghost sign-in-link">
                Sign in <ArrowUpRight size={16} />
              </Link>
            )}
          </div>
        </div>
      </header>
      {user && !user.verified && !embed && <VerifyBanner email={user.email} />}
      <main id="main-content" tabIndex={-1}>
        {loading ? (
          <Loading />
        ) : error ? (
          <div className="page-container">
            <ErrorBox message={error} retry={retry} />
          </div>
        ) : (
          <Outlet />
        )}
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {links.slice(0, 2).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}>
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
        <Link to="/listings/new" className="mobile-list-action">
          <span className="mobile-list-button">
            <Plus size={22} strokeWidth={2.4} />
          </span>
          <span>List</span>
        </Link>
        {links.slice(2).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}>
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
export function RequireAuth() {
  const { user } = useApp(),
    location = useLocation();
  return user ? (
    <Outlet />
  ) : (
    <Navigate
      to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}
      replace
    />
  );
}

/** Reminder strip for signed in students who have not verified their email. */
export function VerifyBanner({ email }: { email: string }) {
  const { notify } = useApp();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  if (location.pathname === "/verify") return null;
  async function resend() {
    setBusy(true);
    try {
      await api("/auth/resend", { method: "POST", body: JSON.stringify({ email }) });
      notify("We sent a fresh code and link to your inbox.");
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="verify-banner" role="status">
      <MailCheck size={15} />
      <span>
        <strong>Verify your student email</strong> to publish a listing or
        request a handoff. We sent a code to {email}.
      </span>
      <Link to="/verify" className="button primary small">
        Enter code
      </Link>
      <button type="button" className="text-button" onClick={resend} disabled={busy}>
        {busy ? "Sending…" : "Resend"}
      </button>
    </div>
  );
}
