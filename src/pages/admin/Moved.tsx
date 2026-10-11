/**
 * /admin on the student host. The dashboard moved to its own host, so this
 * sends a browser there rather than rendering anything internal. Locally the
 * internal host is internal.localhost, which only Chromium style resolvers map
 * to loopback, so development gets the link instead of a silent redirect.
 */
import { useEffect } from "react";
import { INTERNAL_ORIGIN, internalHome, isLocalHost } from "../../surface";

export default function AdminMoved() {
  useEffect(() => {
    if (!isLocalHost) window.location.replace(INTERNAL_ORIGIN);
  }, []);
  return (
    <div className="page-container">
      <div className="internal-moved">
        <h1>The admin dashboard lives on internal.handofflease.com</h1>
        <p>
          <a href={internalHome()}>{internalHome()}</a>
        </p>
      </div>
    </div>
  );
}
