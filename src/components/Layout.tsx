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
    <Link className="brand" to="/browse" aria-label="Handoff home">
      Handoff
    </Link>
  );
}
export function Layout() {
  const { user, setUser, loading, error, retry, notify } = useApp(),
    navigate = useNavigate(),
    location = useLocation();
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
        {links.map(({ to, label, icon: Icon }) => (
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
