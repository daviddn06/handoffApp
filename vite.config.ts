import { defineConfig, type ProxyOptions } from "vite";

/** internal.localhost:4741 is the development internal surface. */
const surfaceHeader: ProxyOptions["configure"] = (proxy) => {
  proxy.on("proxyReq", (proxyRequest, request) => {
    if (String(request.headers.host || "").startsWith("internal."))
      proxyRequest.setHeader("X-Handoff-Surface", "internal");
  });
};
export default defineConfig({
  // Keep fonts as files. The CSP has no data: allowance for font-src.
  build: { assetsInlineLimit: 0 },
  server: {
    host: "127.0.0.1",
    port: 4741,
    // The dashboard host. Chromium resolves any *.localhost name to loopback,
    // so internal.localhost:4741 is the development internal surface.
    allowedHosts: ["127.0.0.1", "localhost", "internal.localhost"],
    proxy: {
      // The dev proxy stands in for Caddy, including the one header that tells
      // the app which host the browser actually asked for.
      "/api": { target: "http://127.0.0.1:4742", configure: surfaceHeader },
      "/uploads": { target: "http://127.0.0.1:4742", configure: surfaceHeader },
      "/avatars": { target: "http://127.0.0.1:4742", configure: surfaceHeader },
    },
  },
});
