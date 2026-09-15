import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  Gauge,
  LogOut,
  Check,
} from "lucide-react";
import { useApp, type AuthReason } from "../lib/context";
import { internalHome } from "../surface";
import { api, errorMessage } from "../lib/api";
import { ErrorBox, Loading } from "./ui";
import { AuthModal } from "./AuthModal";
import { Avatar } from "./Avatar";
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

/** Routes where the header must not offer sign in or listing actions. */
const AUTH_ROUTES = new Set([
  "/sign-in",
  "/sign-up",
  "/verify",
  "/forgot-password",
  "/reset-password",
]);

/** Links a signed out visitor cannot use yet. They open the auth modal, and
    the reason is what the dialog's headline says back to them. */
const GUARDED = new Map<string, AuthReason>([
  ["/saved", "saved"],
  ["/requests", "requests"],
  ["/my-listings", "my-listings"],
  ["/listings/new", "new-listing"],
]);

export function Layout() {
  const { user, setUser, loading, error, retry, notify, openAuth } = useApp(),
    navigate = useNavigate(),
    location = useLocation();
  const embed = isEmbed();
  const onAuthRoute = AUTH_ROUTES.has(location.pathname);
  const onEditor =
    location.pathname === "/listings/new" || location.pathname.endsWith("/edit");
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
  /* Signed out, these never navigate. They confirm you are a student here. */
  const guard = (to: string) =>
    user || !GUARDED.has(to)
      ? undefined
      : (e: React.MouseEvent) => {
          e.preventDefault();
          openAuth({ next: to, reason: GUARDED.get(to) });
        };
  const [menu, setMenu] = useState(false),
    [loggingOut, setLoggingOut] = useState(false),
    [navHidden, setNavHidden] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
    const names: Record<string, string> = {
      "/browse": "Browse",
      "/admin": "Admin",
      "/saved": "Saved places",
      "/requests": "Requests",
      "/my-listings": "My listings",
      "/profile": "Profile",
      "/sign-in": "Sign in",
      "/sign-up": "Confirm you are a student",
      "/verify": "Verify your email",
      "/forgot-password": "Forgot password",
      "/reset-password": "Reset password",
      "/terms": "Terms of Service",
      "/privacy": "Privacy Policy",
      "/listings/new": "List your place",
    };
    const name =
      names[location.pathname] ||
      (location.pathname.startsWith("/admin") ? "Admin" : "Your next place");
    document.title = `${name} · Handoff`;
  }, [location.pathname]);
  /* The floating nav pill steps aside while the student scrolls down a page
     and comes back the moment they scroll up. */
  useEffect(() => {
    setNavHidden(false);
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 6) return;
      setNavHidden(y > last && y > 72);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
            {links
              .filter(({ to }) => user || !GUARDED.has(to))
              .map(({ to, label }) => (
                <NavLink key={to} to={to} onClick={guard(to)}>
                  {label}
                </NavLink>
              ))}
          </nav>
          <div className="header-actions">
            {!onAuthRoute && !onEditor && (
              <Link
                to="/listings/new"
                className="button primary list-place"
                onClick={guard("/listings/new")}
              >
                <Plus size={17} />
                <span>List your place</span>
              </Link>
            )}
            {user ? (
              <div className="user-menu" ref={menuRef}>
                <button
                  className="avatar-button"
                  aria-label="Account menu"
                  aria-expanded={menu}
                  aria-controls="account-menu"
                  onClick={() => setMenu(!menu)}
                >
                  <Avatar src={user.avatar} name={user.name} size={28} />
                  <ChevronDown size={15} />
                </button>
                {menu && (
                  <div className="account-menu" id="account-menu">
                    <div className="menu-identity">
                      <Avatar src={user.avatar} name={user.name} size={36} />
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
                    {user.isAdmin && (
                      <a href={internalHome()}>
                        <Gauge size={16} />
                        Admin
                      </a>
                    )}
                    <button onClick={logout} disabled={loggingOut}>
                      <LogOut size={16} />
                      {loggingOut ? "Signing out…" : "Sign out"}
                    </button>
                    <div className="menu-legal">
                      <Link to="/terms">Terms</Link>
                      <Link to="/privacy">Privacy</Link>
                    </div>
                  </div>
                )}
              </div>
            ) : onAuthRoute ? null : (
              <Link
                to="/sign-in"
                className="button ghost sign-in-link"
                onClick={(e) => {
                  e.preventDefault();
                  openAuth({
                    mode: "signin",
                    next: location.pathname + location.search,
                  });
                }}
              >
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
      <nav
        className={`mobile-nav ${navHidden ? "is-hidden" : ""}`}
        aria-label="Mobile navigation"
      >
        {links.slice(0, 2).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={guard(to)}>
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
        <Link
          to="/listings/new"
          className="mobile-list-action"
          onClick={guard("/listings/new")}
        >
          <span className="mobile-list-button">
            <Plus size={22} strokeWidth={2.4} />
          </span>
          <span>Post</span>
        </Link>
        {links.slice(2).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={guard(to)}>
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <AuthModal />
    </>
  );
}
/**
 * A signed out visitor who wants to list a place is almost always new, so the
 * listing routes send them to create an account. Everything else still opens
 * sign in, where a returning student expects to land.
 */
export function RequireAuth(_props: { to?: string } = {}) {
  const { user, loading, auth, openAuth } = useApp(),
    location = useLocation();
  const target = location.pathname + location.search;
  // The dialog is already open on a direct hit, decided before the first
  // paint in the provider. This only covers the in app case, and it runs
  // before the browser paints, so the protected screen is never drawn.
  useLayoutEffect(() => {
    if (!user && !loading && !auth.open)
      openAuth({ next: target, reason: GUARDED.get(location.pathname) });
  }, [user, loading, auth.open, target, location.pathname, openAuth]);
  if (user) return <Outlet />;
  // Browse is what sits behind the dialog. Replacing keeps the back button
  // pointing at wherever they came from, not at the page they cannot see.
  return loading ? null : <Navigate to="/browse" replace />;
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
