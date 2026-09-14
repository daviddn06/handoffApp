import Database from "better-sqlite3";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(dataDir, "uploads"), { recursive: true, mode: 0o700 });
  const filename = join(dataDir, "handoff.sqlite");
  const existed = existsSync(filename);
  const db = new Database(filename);
  chmodSync(filename, 0o600);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const version = db.pragma("user_version", { simple: true });
  if (version > 5) {
    db.close();
    throw new Error(
      "Database schema is newer than this release. Restore the matching application release.",
    );
  }
  // A pre-existing unversioned database is not silently adopted or overwritten.
  if (
    existed &&
    version === 0 &&
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all().length
  ) {
    db.close();
    throw new Error(
      "Back up and explicitly migrate the unversioned database before starting Handoff.",
    );
  }
  if (version === 0)
    db.transaction(() => {
      db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        campus_id TEXT NOT NULL, password_hash TEXT NOT NULL, verified_at TEXT,
        bio TEXT NOT NULL DEFAULT '', terms_accepted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      CREATE TABLE auth_tokens (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('verify','reset')), expires_at INTEGER NOT NULL,
        consumed_at INTEGER, created_at INTEGER NOT NULL
      );
      CREATE INDEX auth_tokens_user ON auth_tokens(user_id, kind);
      CREATE TABLE rate_limits (
        bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE uploads (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL UNIQUE,
        bytes INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE listings (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), campus_id TEXT NOT NULL,
        title TEXT NOT NULL, description TEXT NOT NULL, address TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
        price INTEGER NOT NULL, deposit INTEGER NOT NULL, bedrooms INTEGER NOT NULL, bathrooms REAL NOT NULL,
        room_type TEXT NOT NULL CHECK(room_type IN ('private','shared','entire')),
        available_from TEXT NOT NULL, available_to TEXT NOT NULL,
        amenities TEXT NOT NULL DEFAULT '[]', photos TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK(status IN ('draft','active','handed_off','archived')),
        moderation_locked INTEGER NOT NULL DEFAULT 0,
        original_price INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX listings_discovery ON listings(status, campus_id, available_to);
      CREATE INDEX listings_owner ON listings(owner_id, updated_at);
      CREATE TABLE saved_listings (
        user_id TEXT NOT NULL REFERENCES users(id), listing_id TEXT NOT NULL REFERENCES listings(id),
        created_at TEXT NOT NULL, PRIMARY KEY(user_id, listing_id)
      );
      CREATE TABLE handoff_requests (
        id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id),
        requester_id TEXT NOT NULL REFERENCES users(id),
        message TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','withdrawn')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX requests_one_live_per_student ON handoff_requests(listing_id, requester_id)
        WHERE status IN ('pending','accepted');
      CREATE INDEX requests_listing ON handoff_requests(listing_id, created_at);
      CREATE INDEX requests_requester ON handoff_requests(requester_id, created_at);
      CREATE TABLE waitlist (
        id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, school TEXT NOT NULL, domain TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, UNIQUE(email, school)
      );
      CREATE TABLE reports (
        id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id), reporter_id TEXT NOT NULL REFERENCES users(id),
        reason TEXT NOT NULL, details TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
      );
      PRAGMA user_version = 5;
    `);
    })();
  if (version === 1) {
    const backupDir = join(dataDir, "backups");
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const backup = join(backupDir, `before-schema-2-${Date.now()}.sqlite`);
    // VACUUM INTO produces a consistent backup that includes committed WAL state.
    db.prepare("VACUUM INTO ?").run(backup);
    chmodSync(backup, 0o600);
    db.transaction(() => {
      db.exec(
        "ALTER TABLE listings ADD COLUMN moderation_locked INTEGER NOT NULL DEFAULT 0",
      );
      db.pragma("user_version = 2");
    })();
  }
  if (db.pragma("user_version", { simple: true }) === 2) {
    const backupDir = join(dataDir, "backups");
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const backup = join(backupDir, `before-schema-3-${Date.now()}.sqlite`);
    db.prepare("VACUUM INTO ?").run(backup);
    chmodSync(backup, 0o600);
    db.transaction(() => {
      // What the lister currently pays, so students can see the savings.
      const columns = db
        .prepare("PRAGMA table_info(listings)")
        .all()
        .map((column) => column.name);
      if (!columns.includes("original_price"))
        db.exec("ALTER TABLE listings ADD COLUMN original_price INTEGER");
      db.pragma("user_version = 3");
    })();
  }
  if (db.pragma("user_version", { simple: true }) === 3) {
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS waitlist (
        id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, school TEXT NOT NULL, domain TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, UNIQUE(email, school)
      )`);
      db.pragma("user_version = 4");
    })();
  }
  if (db.pragma("user_version", { simple: true }) === 4) {
    db.transaction(() => {
      const columns = db
        .prepare("PRAGMA table_info(users)")
        .all()
        .map((column) => column.name);
      if (!columns.includes("terms_accepted_at"))
        db.exec("ALTER TABLE users ADD COLUMN terms_accepted_at TEXT");
      db.pragma("user_version = 5");
    })();
  }
  return db;
}
