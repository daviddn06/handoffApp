import Database from "better-sqlite3";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CAMPUSES } from "./config.js";

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
  if (version > 11) {
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
        campus_id TEXT, school_domain TEXT, school_name TEXT, password_hash TEXT NOT NULL, verified_at TEXT,
        bio TEXT NOT NULL DEFAULT '', terms_accepted_at TEXT,
        gender TEXT NOT NULL DEFAULT 'unspecified',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
        boost_until TEXT,
        gender_preference TEXT NOT NULL DEFAULT 'any',
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
      CREATE TABLE boosts (
        id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id), user_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL CHECK(kind IN ('launch','paid')), price_cents INTEGER NOT NULL DEFAULT 0,
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX boosts_listing ON boosts(listing_id, created_at);
      CREATE INDEX boosts_user ON boosts(user_id, created_at);
      CREATE TABLE listing_views (
        listing_id TEXT NOT NULL REFERENCES listings(id), viewer_key TEXT NOT NULL, hour TEXT NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY(listing_id, viewer_key, hour)
      );
      CREATE INDEX listing_views_listing ON listing_views(listing_id, created_at);
      PRAGMA user_version = 8;
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
  if (db.pragma("user_version", { simple: true }) === 5) {
    db.transaction(() => {
      // Boost: a paid or free window that lifts one listing to the top.
      const columns = db
        .prepare("PRAGMA table_info(listings)")
        .all()
        .map((column) => column.name);
      if (!columns.includes("boost_until"))
        db.exec("ALTER TABLE listings ADD COLUMN boost_until TEXT");
      db.exec(`CREATE TABLE IF NOT EXISTS boosts (
        id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id), user_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL CHECK(kind IN ('launch','paid')), price_cents INTEGER NOT NULL DEFAULT 0,
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, created_at TEXT NOT NULL
      )`);
      db.exec(
        "CREATE INDEX IF NOT EXISTS boosts_listing ON boosts(listing_id, created_at)",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS boosts_user ON boosts(user_id, created_at)",
      );
      db.exec(`CREATE TABLE IF NOT EXISTS listing_views (
        listing_id TEXT NOT NULL REFERENCES listings(id), viewer_key TEXT NOT NULL, hour TEXT NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY(listing_id, viewer_key, hour)
      )`);
      db.exec(
        "CREATE INDEX IF NOT EXISTS listing_views_listing ON listing_views(listing_id, created_at)",
      );
      db.pragma("user_version = 6");
    })();
  }
  if (db.pragma("user_version", { simple: true }) === 6) {
    const backupDir = join(dataDir, "backups");
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const backup = join(backupDir, `before-schema-7-${Date.now()}.sqlite`);
    db.prepare("VACUUM INTO ?").run(backup);
    chmodSync(backup, 0o600);
    // Rebuilding users means dropping a table other tables point at, so the
    // foreign key check is suspended for the length of the rebuild only.
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        // Any student at any school may hold an account. campus_id keeps its
        // name but changes meaning: the live campus this student may post at,
        // NULL when Handoff has not opened at their school. The school itself
        // is recorded separately so the app can name it in full.
        const columns = db
          .prepare("PRAGMA table_info(users)")
          .all()
          .map((column) => column.name);
        if (!columns.includes("school_domain"))
          db.exec("ALTER TABLE users ADD COLUMN school_domain TEXT");
        if (!columns.includes("school_name"))
          db.exec("ALTER TABLE users ADD COLUMN school_name TEXT");
        for (const campus of CAMPUSES)
          db.prepare(
            "UPDATE users SET school_domain=COALESCE(school_domain,?),school_name=COALESCE(school_name,?) WHERE campus_id=?",
          ).run(campus.domain, campus.name, campus.id);
        // SQLite cannot drop NOT NULL in place, so users is rebuilt once.
        db.exec(`
          CREATE TABLE users_v7 (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            campus_id TEXT, school_domain TEXT, school_name TEXT, password_hash TEXT NOT NULL, verified_at TEXT,
            bio TEXT NOT NULL DEFAULT '', terms_accepted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          INSERT INTO users_v7(id,name,email,campus_id,school_domain,school_name,password_hash,verified_at,bio,terms_accepted_at,created_at,updated_at)
            SELECT id,name,email,campus_id,school_domain,school_name,password_hash,verified_at,bio,terms_accepted_at,created_at,updated_at FROM users;
          DROP TABLE users;
          ALTER TABLE users_v7 RENAME TO users;
        `);
        // A campus that is not open can no longer grant posting. Listings keep
        // their own campus, so nothing already published disappears.
        for (const campus of CAMPUSES)
          if (campus.live === false)
            db.prepare("UPDATE users SET campus_id=NULL WHERE campus_id=?").run(
              campus.id,
            );
        db.pragma("user_version = 7");
      })();
      const violations = db.pragma("foreign_key_check");
      if (violations.length)
        throw new Error(
          "Schema 7 migration left dangling references. Restore the backup beside the database and retry.",
        );
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
  if (db.pragma("user_version", { simple: true }) === 7) {
    db.transaction(() => {
      // Gender is optional for students and defaults to unspecified. A listing
      // roommate preference defaults to any, and the server keeps it at any
      // for an entire place, where fair housing rules leave no room for one.
      const userColumns = db
        .prepare("PRAGMA table_info(users)")
        .all()
        .map((column) => column.name);
      if (!userColumns.includes("gender"))
        db.exec(
          "ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT 'unspecified'",
        );
      const listingColumns = db
        .prepare("PRAGMA table_info(listings)")
        .all()
        .map((column) => column.name);
      if (!listingColumns.includes("gender_preference"))
        db.exec(
          "ALTER TABLE listings ADD COLUMN gender_preference TEXT NOT NULL DEFAULT 'any'",
        );
      db.exec(
        "UPDATE listings SET gender_preference='any' WHERE room_type='entire'",
      );
      db.pragma("user_version = 8");
    })();
  }
  if (db.pragma("user_version", { simple: true }) === 8) {
    db.transaction(() => {
      // Smart import records what each AI call cost, so the operator can see
      // tokens per day. No prompt text and no listing content is stored.
      db.exec(`CREATE TABLE IF NOT EXISTS ai_usage (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL CHECK(kind IN ('parse','chat')),
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
        model TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      )`);
      db.exec(
        "CREATE INDEX IF NOT EXISTS ai_usage_created ON ai_usage(created_at)",
      );
      db.exec("CREATE INDEX IF NOT EXISTS ai_usage_user ON ai_usage(user_id, created_at)");
      db.pragma("user_version = 9");
    })();
  }
  if (db.pragma("user_version", { simple: true }) === 9) {
    db.transaction(() => {
      // The internal dashboard. is_admin opens it, disabled_at closes an
      // account without deleting anything, and admin_audit keeps a permanent
      // record of every write an admin makes.
      const userColumns = db
        .prepare("PRAGMA table_info(users)")
        .all()
        .map((column) => column.name);
      if (!userColumns.includes("is_admin"))
        db.exec(
          "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
        );
      if (!userColumns.includes("disabled_at"))
        db.exec("ALTER TABLE users ADD COLUMN disabled_at TEXT");
      db.exec(`CREATE TABLE IF NOT EXISTS admin_audit (
        id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES users(id),
        action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
      )`);
      db.exec(
        "CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit(created_at)",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS admin_audit_target ON admin_audit(target_id, created_at)",
      );
      db.pragma("user_version = 10");
    })();
  }
  if (db.pragma("user_version", { simple: true }) === 10) {
    db.transaction(() => {
      // An optional profile photo, stored beside the listing photos and
      // referenced by its public path, exactly like a listing photo is.
      const userColumns = db
        .prepare("PRAGMA table_info(users)")
        .all()
        .map((column) => column.name);
      if (!userColumns.includes("avatar"))
        db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
      db.pragma("user_version = 11");
    })();
  }
  return db;
}
