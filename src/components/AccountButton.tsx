import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Check, Gauge, LogOut, UserRound } from "lucide-react";
import { useApp } from "../lib/context";
import { api, errorMessage } from "../lib/api";
import { internalHome } from "../surface";
import { Avatar } from "./Avatar";

/**
 * The phone account entry. The site header is gone below 761px, so every
 * screen carries this instead, either in its title row or floating over a
 * full bleed surface. Signed out it becomes the confirm pill that opens the
 * auth modal. Tapping it signed in raises the account menu as a bottom sheet.
 */
export function MobileAccount({
  floating = false,
  className = "",
}: {
  floating?: boolean;
  className?: string;
}) {
  const { user, setUser, notify, openAuth } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrap = `m-account ${floating ? "is-floating" : ""} ${className}`.trim();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);

  async function logout() {
    setLoggingOut(true);
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setOpen(false);
      navigate("/browse");
      notify("You’re signed out.");
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setLoggingOut(false);
    }
  }

  if (!user)
    return (
      <div className={wrap}>
        <button
          type="button"
          className="m-account-pill"
          onClick={() =>
            openAuth({ next: location.pathname + location.search })
          }
        >
          Confirm
        </button>
      </div>
    );

  return (
    <div className={wrap}>
      <button
        type="button"
        className="m-account-avatar"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Avatar src={user.avatar} name={user.name} size={28} />
      </button>
      {open &&
        createPortal(
          <div className="m-sheet" role="presentation">
            <button
              type="button"
              className="m-sheet-scrim"
              aria-label="Close account menu"
              onClick={() => setOpen(false)}
            />
            <div className="m-sheet-panel" role="dialog" aria-label="Account">
              <span className="m-sheet-grip" aria-hidden="true" />
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
              <div className="account-menu m-sheet-list">
                <Link to="/profile" onClick={() => setOpen(false)}>
                  <UserRound size={17} />
                  Your profile
                </Link>
                {user.isAdmin && (
                  /* The dashboard is its own host, so this leaves the app. */
                  <a href={internalHome()}>
                    <Gauge size={17} />
                    Admin
                  </a>
                )}
                <button type="button" onClick={logout} disabled={loggingOut}>
                  <LogOut size={17} />
                  {loggingOut ? "Signing out…" : "Sign out"}
                </button>
                <div className="menu-legal">
                  <Link to="/terms" onClick={() => setOpen(false)}>
                    Terms
                  </Link>
                  <Link to="/privacy" onClick={() => setOpen(false)}>
                    Privacy
                  </Link>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
