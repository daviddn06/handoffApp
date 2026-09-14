import { createApp } from "./app.js";

process.umask(0o077);
const port = Number(process.env.PORT || 4742);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT must be an integer between 1024 and 65535.");
const app = createApp();
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Handoff listening on 127.0.0.1:${port}`);
  if (!app.locals.emailReady)
    console.warn(
      "Student email delivery is not configured; new registration and recovery are unavailable.",
    );
});
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
