import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4741,
    proxy: {
      "/api": "http://127.0.0.1:4742",
      "/uploads": "http://127.0.0.1:4742",
    },
  },
});
