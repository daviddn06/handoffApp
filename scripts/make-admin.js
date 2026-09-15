#!/usr/bin/env node
// Grants or revokes internal dashboard access for one existing account.
// Usage: node scripts/make-admin.js <email> [--revoke]
// Production paths require HANDOFF_SEED_CONFIRM=production, like seed-demo.js.
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase } from "../server/database.js";

process.umask(0o077);

const FORBIDDEN = ["/var/lib/handoff", "/var/backups/handoff", "/opt/handoff"];

/** Toggles the admin flag. Returns the updated row, throws with a clear reason. */
export function setAdmin(db, email, on = true) {
  const address = String(email || "").trim().toLowerCase();
  if (!address.includes("@")) throw new Error("Provide the account email address.");
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(address);
  if (!user)
    throw new Error(
      `No Handoff account uses ${address}. The student must sign up first.`,
    );
  db.prepare("UPDATE users SET is_admin=?,updated_at=? WHERE id=?").run(
    on ? 1 : 0,
    new Date().toISOString(),
    user.id,
  );
  return db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
}

export function guardDataDir(dataDir, confirm = process.env.HANDOFF_SEED_CONFIRM) {
  const blocked = FORBIDDEN.some(
    (root) => dataDir === root || dataDir.startsWith(root + sep),
  );
  if (blocked && confirm !== "production")
    throw new Error(
      `Refusing to touch ${dataDir}. That path is a production location. Set HANDOFF_SEED_CONFIRM=production on purpose, or point HANDOFF_DATA_DIR at a local directory such as ./data.`,
    );
  return blocked;
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly && process.argv.length > 2) {
  const revoke = process.argv.includes("--revoke");
  const email = process.argv.slice(2).find((value) => !value.startsWith("--"));
  const dataDir = resolve(process.env.HANDOFF_DATA_DIR || "./data");
  console.log(`Handoff admin role`);
  console.log(`Data directory: ${dataDir}`);
  try {
    if (guardDataDir(dataDir))
      console.log("Production data directory confirmed explicitly.");
    const db = openDatabase(dataDir);
    try {
      const user = setAdmin(db, email, !revoke);
      console.log(
        `${revoke ? "Revoked" : "Granted"} admin access for ${user.email} (${user.name}).`,
      );
      console.log(
        revoke
          ? "Their existing sessions stay valid, the dashboard simply disappears."
          : "They can open /admin after their next page load.",
      );
    } finally {
      db.close();
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (invokedDirectly) {
  console.error("Usage: node scripts/make-admin.js <email> [--revoke]");
  process.exit(1);
}
