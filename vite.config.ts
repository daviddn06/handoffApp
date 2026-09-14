import { defineConfig } from "vite";
export default defineConfig({
  // Keep fonts as files. The CSP has no data: allowance for font-src.
  build: { assetsInlineLimit: 0 },
  server: {
    host: "127.0.0.1",
    port: 4741,
    proxy: {
      "/api": "http://127.0.0.1:4742",
      "/uploads": "http://127.0.0.1:4742",
    },
  },
});
