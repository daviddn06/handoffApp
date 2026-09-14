import Database from "better-sqlite3";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

process.umask(0o077);
const [command, argument] = process.argv.slice(2);
if (!process.env.HANDOFF_DATA_DIR)
  throw new Error(
    "Set HANDOFF_DATA_DIR to the existing production data directory.",
  );
const databasePath = join(
  resolve(process.env.HANDOFF_DATA_DIR),
  "handoff.sqlite",
);
const db = new Database(databasePath, { fileMustExist: true });
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
const requireId = () => {
  if (!/^[a-f0-9-]{36}$/.test(argument || ""))
    throw new Error("Provide a valid UUID.");
};
try {
  if (command === "waitlist") {
    const rows = db
      .prepare(
        "SELECT school, domain, COUNT(*) AS students, MIN(created_at) AS first_signup FROM waitlist GROUP BY school, domain ORDER BY students DESC, school",
      )
      .all();
    console.table(rows);
  } else if (command === "reports") {
    const status = argument || "open";
    if (!["open", "all"].includes(status))
      throw new Error("Usage: reports [open|all]");
    const rows = db
      .prepare(
        `SELECT r.id,r.listing_id,l.title AS listing_title,r.reporter_id,r.reason,r.details,r.status,r.created_at FROM reports r JOIN listings l ON l.id=r.listing_id ${status === "open" ? "WHERE r.status='open'" : ""} ORDER BY r.created_at DESC`,
      )
      .all();
    console.log(JSON.stringify(rows, null, 2));
  } else if (command === "resolve-report") {
    requireId();
    const result = db
      .prepare(
        "UPDATE reports SET status='resolved' WHERE id=? AND status='open'",
      )
      .run(argument);
    if (!result.changes) throw new Error("Open report not found.");
    console.log("Report marked resolved.");
  } else if (command === "archive-listing") {
    requireId();
    db.transaction(() => {
      const result = db
        .prepare(
          "UPDATE listings SET status='archived',moderation_locked=1,updated_at=? WHERE id=?",
        )
        .run(new Date().toISOString(), argument);
      if (!result.changes) throw new Error("Listing not found.");
      db.prepare(
        "UPDATE handoff_requests SET status='declined',updated_at=? WHERE listing_id=? AND status='pending'",
      ).run(new Date().toISOString(), argument);
    })();
    console.log(
      "Listing archived and pending requests declined. Records are retained.",
    );
  } else if (command === "unlock-listing") {
    requireId();
    const result = db
      .prepare(
        "UPDATE listings SET moderation_locked=0,updated_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), argument);
    if (!result.changes) throw new Error("Listing not found.");
    console.log(
      "Moderation lock removed. The owner can review and republish the listing.",
    );
  } else if (command === "backup") {
    if (!argument)
      throw new Error("Usage: backup /absolute/path/handoff-backup.sqlite");
    const target = resolve(argument);
    if (existsSync(target))
      throw new Error("Backup target already exists. Choose a new filename.");
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    await db.backup(target);
    chmodSync(target, 0o600);
    console.log(
      "Consistent SQLite backup completed. Back up the uploads directory separately.",
    );
  } else {
    throw new Error(
      "Commands: reports [open|all], resolve-report UUID, archive-listing UUID, unlock-listing UUID, backup FILE",
    );
  }
} finally {
  db.close();
}
