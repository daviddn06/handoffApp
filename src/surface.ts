/**
 * Which host the bundle is running on. The same build serves the student app
 * on app.handofflease.com and the internal dashboard on
 * internal.handofflease.com. The server injects the meta tag when it serves
 * the internal host, which is the reliable signal, and the hostname prefix
 * covers a dev server that hands out the plain index.html.
 */
const metaSurface = () =>
  typeof document === "undefined"
    ? ""
    : document
        .querySelector('meta[name="handoff-surface"]')
        ?.getAttribute("content")
        ?.trim()
        .toLowerCase() || "";

const hostSurface = () =>
  typeof window !== "undefined" &&
  window.location.hostname.toLowerCase().startsWith("internal.");

export const isInternalSurface = metaSurface() === "internal" || hostSurface();

/** Where the dashboard lives in production. */
export const INTERNAL_ORIGIN = "https://internal.handofflease.com/";
/** The dev equivalent. Chromium resolves any *.localhost name to loopback. */
export const INTERNAL_DEV_ORIGIN =
  typeof window === "undefined"
    ? "http://internal.localhost:4741/"
    : `http://internal.localhost:${window.location.port || "4741"}/`;
/** A local dev host, where internal.handofflease.com does not exist yet. */
export const isLocalHost =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    window.location.hostname.toLowerCase(),
  );

/** Where /admin and the account menu point. Production host, or its dev twin. */
export const internalHome = () =>
  isLocalHost ? INTERNAL_DEV_ORIGIN : INTERNAL_ORIGIN;
