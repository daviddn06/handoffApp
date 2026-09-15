/**
 * Internal admin dashboard API. It lives only on the internal surface
 * (internal.handofflease.com) and everything here is gated by requireAdmin,
 * which answers 404 rather than 403 so the surface stays invisible. Every
 * write records a row in admin_audit.
 */
import express from "express";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { cpus, freemem, hostname, loadavg, totalmem, uptime } from "node:os";
import { HttpError } from "./security.js";
import { readShareChannels } from "./validation.js";

const execute = promisify(execFile);
const iso = () => new Date().toISOString();
const DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 25;
const here = dirname(fileURLToPath(import.meta.url));

/** A signed in admin, or the endpoint simply does not exist. */
export const notFound = () => new HttpError(404, "Endpoint not found.");

/**
 * The admin allow list, read from HANDOFF_ADMIN_EMAILS once at startup.
 * Comma separated, trimmed, lower cased. An empty list allows nobody.
 */
export function adminAllowList(env = process.env) {
  return new Set(
    String(env.HANDOFF_ADMIN_EMAILS || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}
let warnedAboutEmptyAllowList = false;
/**
 * Builds isAllowedAdmin(user). The database flag alone is never enough, the
 * account's email must also be on the allow list, so a flagged but unlisted
 * account can reach nothing and is never told the dashboard exists.
 */
export function adminGate(allowList = adminAllowList()) {
  const emails =
    allowList instanceof Set ? allowList : adminAllowList(allowList);
  if (!emails.size && !warnedAboutEmptyAllowList) {
    warnedAboutEmptyAllowList = true;
    console.warn(
      "HANDOFF_ADMIN_EMAILS is empty. The internal dashboard is closed to every account.",
    );
  }
  return function isAllowedAdmin(user) {
    return Boolean(
      user &&
        user.is_admin &&
        !user.disabled_at &&
        emails.has(String(user.email || "").toLowerCase()),
    );
  };
}
/** Disabled accounts keep their data but lose every authenticated action. */
export const disabledError = (user) =>
  user?.disabled_at ? new HttpError(403, "This account is disabled.") : undefined;

const dayKey = (value) => new Date(value).toISOString().slice(0, 10);
/** The last n calendar days in UTC, oldest first, so a chart never has holes. */
function dayRange(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(Date.now() - i * DAY));
  return out;
}
function fillSeries(rows, n, key = "day", value = "count") {
  const found = new Map(rows.map((row) => [row[key], Number(row[value])]));
  return dayRange(n).map((day) => ({ day, count: found.get(day) || 0 }));
}
const positiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const text = (value, max = 120) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const uuid = (value) => {
  if (!/^[a-f0-9-]{36}$/.test(String(value || ""))) throw notFound();
  return value;
};
async function directorySize(path) {
  let bytes = 0;
  let files = 0;
  try {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      try {
        const info = await stat(join(path, entry.name));
        bytes += info.size;
        files += 1;
      } catch {
        // A file can vanish between the listing and the stat.
      }
    }
  } catch {
    return { bytes: 0, files: 0, available: false };
  }
  return { bytes, files, available: true };
}
async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export function adminRouter({
  db,
  limit,
  dataDir = resolve("data"),
  staticDir = resolve(here, "../dist"),
  emailReady = false,
  // The allow list gate. The app builds it once at startup and shares it with
  // serializeUser so the client and the API always agree.
  isAllowedAdmin = adminGate(),
} = {}) {
  const router = express.Router();
  const data = resolve(dataDir);
  const uploadDir = join(data, "uploads");
  const logoDir = join(data, "logos");
  const backupDir = resolve(process.env.HANDOFF_BACKUP_DIR || "/var/backups/handoff");

  const hasTable = (name) =>
    Boolean(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(name),
    );
  const hasColumn = (table, column) =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((row) => row.name === column);
  const sessionsHaveTimes = hasColumn("sessions", "created_at");

  const audit = (adminId, action, targetType, targetId, details = {}) =>
    db
      .prepare(
        "INSERT INTO admin_audit(id,admin_id,action,target_type,target_id,details,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        adminId,
        action,
        targetType,
        targetId,
        JSON.stringify(details),
        iso(),
      );

  // 404, never 403. A student, or a flagged account that is not on the allow
  // list, poking at /api/admin learns nothing.
  const requireAdmin = (req, res, next) =>
    isAllowedAdmin(req.user) ? next() : next(notFound());

  router.use(limit("admin", 3000, 15 * 60 * 1000, (req) => req.user?.id || req.ip));
  router.use(requireAdmin);

  const since = (days) => new Date(Date.now() - days * DAY).toISOString();
  const countQuery = (sql, ...params) =>
    Number(db.prepare(sql).get(...params)?.count || 0);
  const perDay = (table, days = 30, column = "created_at") =>
    fillSeries(
      db
        .prepare(
          `SELECT substr(${column},1,10) AS day, COUNT(*) AS count FROM ${table} WHERE ${column}>=? GROUP BY day`,
        )
        .all(since(days)),
      days,
    );

  /* ------------------------------------------------------------- overview */

  router.get("/overview", (req, res) => {
    const byStatus = (table) =>
      Object.fromEntries(
        db
          .prepare(`SELECT status, COUNT(*) AS count FROM ${table} GROUP BY status`)
          .all()
          .map((row) => [row.status, Number(row.count)]),
      );
    const totals = {
      users: countQuery("SELECT COUNT(*) AS count FROM users"),
      verifiedUsers: countQuery(
        "SELECT COUNT(*) AS count FROM users WHERE verified_at IS NOT NULL",
      ),
      admins: countQuery("SELECT COUNT(*) AS count FROM users WHERE is_admin=1"),
      disabledUsers: countQuery(
        "SELECT COUNT(*) AS count FROM users WHERE disabled_at IS NOT NULL",
      ),
      listings: countQuery("SELECT COUNT(*) AS count FROM listings"),
      listingsByStatus: byStatus("listings"),
      boostedActive: countQuery(
        "SELECT COUNT(*) AS count FROM listings WHERE boost_until IS NOT NULL AND boost_until>?",
        iso(),
      ),
      requests: countQuery("SELECT COUNT(*) AS count FROM handoff_requests"),
      requestsByStatus: byStatus("handoff_requests"),
      saved: countQuery("SELECT COUNT(*) AS count FROM saved_listings"),
      waitlist: countQuery("SELECT COUNT(*) AS count FROM waitlist"),
      reportsOpen: countQuery(
        "SELECT COUNT(*) AS count FROM reports WHERE status='open'",
      ),
      reports: countQuery("SELECT COUNT(*) AS count FROM reports"),
      uploads: countQuery("SELECT COUNT(*) AS count FROM uploads"),
      sessionsActive: countQuery(
        "SELECT COUNT(*) AS count FROM sessions WHERE expires_at>?",
        Date.now(),
      ),
    };
    const usersBySchool = db
      .prepare(
        "SELECT COALESCE(NULLIF(school_name,''),'Unknown') AS school, COUNT(*) AS count FROM users GROUP BY school ORDER BY count DESC, school LIMIT 10",
      )
      .all()
      .map((row) => ({ school: row.school, count: Number(row.count) }));
    const usersByGender = hasColumn("users", "gender")
      ? db
          .prepare(
            "SELECT COALESCE(NULLIF(gender,''),'unspecified') AS gender, COUNT(*) AS count FROM users GROUP BY gender ORDER BY count DESC",
          )
          .all()
          .map((row) => ({ gender: row.gender, count: Number(row.count) }))
      : null;
    const series = {
      signups: perDay("users"),
      listings: perDay("listings"),
      requests: perDay("handoff_requests"),
      views: hasTable("listing_views") ? perDay("listing_views") : null,
      aiTokens: hasTable("ai_usage")
        ? fillSeries(
            db
              .prepare(
                "SELECT substr(created_at,1,10) AS day, SUM(input_tokens+output_tokens) AS count FROM ai_usage WHERE created_at>=? GROUP BY day",
              )
              .all(since(30)),
            30,
          )
        : null,
    };
    res.json({ totals, usersBySchool, usersByGender, series, generatedAt: iso() });
  });

  /* ---------------------------------------------------------------- users */

  const userSorts = {
    created_desc: "u.created_at DESC",
    created_asc: "u.created_at ASC",
    name: "u.name COLLATE NOCASE ASC",
    email: "u.email COLLATE NOCASE ASC",
    listings: "listing_count DESC, u.created_at DESC",
  };

  router.get("/users", (req, res) => {
    const query = text(req.query.query);
    const school = text(req.query.school, 160);
    const verified = text(req.query.verified, 12);
    const page = positiveInt(req.query.page);
    const order = userSorts[text(req.query.sort, 20)] || userSorts.created_desc;
    const where = [];
    const params = [];
    if (query) {
      where.push("(u.name LIKE ? OR u.email LIKE ? OR u.id = ?)");
      params.push(`%${query}%`, `%${query}%`, query);
    }
    if (school) {
      where.push("COALESCE(u.school_name,'') = ?");
      params.push(school);
    }
    if (verified === "yes") where.push("u.verified_at IS NOT NULL");
    if (verified === "no") where.push("u.verified_at IS NULL");
    if (verified === "admin") where.push("u.is_admin=1");
    if (verified === "disabled") where.push("u.disabled_at IS NOT NULL");
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number(
      db.prepare(`SELECT COUNT(*) AS count FROM users u ${clause}`).get(...params)
        ?.count || 0,
    );
    const lastSignIn = sessionsHaveTimes
      ? "(SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id=u.id)"
      : "NULL";
    const rows = db
      .prepare(
        `SELECT u.*,
           (SELECT COUNT(*) FROM listings l WHERE l.owner_id=u.id) AS listing_count,
           (SELECT COUNT(*) FROM handoff_requests r WHERE r.requester_id=u.id) AS request_count,
           (SELECT COUNT(*) FROM saved_listings sl WHERE sl.user_id=u.id) AS saved_count,
           ${lastSignIn} AS last_sign_in
         FROM users u ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    res.json({
      users: rows.map(adminUser),
      page,
      pageSize: PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      schools: db
        .prepare(
          "SELECT COALESCE(NULLIF(school_name,''),'Unknown') AS school, COUNT(*) AS count FROM users GROUP BY school ORDER BY count DESC, school LIMIT 40",
        )
        .all()
        .map((row) => ({ school: row.school, count: Number(row.count) })),
    });
  });

  function adminUser(row) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      school: row.school_name || "",
      schoolDomain: row.school_domain || "",
      campusId: row.campus_id || null,
      verified: Boolean(row.verified_at),
      verifiedAt: row.verified_at || null,
      termsAccepted: Boolean(row.terms_accepted_at),
      termsAcceptedAt: row.terms_accepted_at || null,
      gender: hasColumn("users", "gender") ? row.gender || "unspecified" : null,
      /* Contact channels, shown to an admin reviewing an account. */
      phone: hasColumn("users", "phone") ? row.phone || null : null,
      instagram: hasColumn("users", "instagram") ? row.instagram || null : null,
      facebook: hasColumn("users", "facebook") ? row.facebook || null : null,
      shareChannels: hasColumn("users", "share_channels")
        ? readShareChannels(row.share_channels)
        : ["email"],
      isAdmin: Boolean(row.is_admin),
      disabledAt: row.disabled_at || null,
      bio: row.bio || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastSignIn: row.last_sign_in ? new Date(row.last_sign_in).toISOString() : null,
      listingCount: Number(row.listing_count || 0),
      requestCount: Number(row.request_count || 0),
      savedCount: Number(row.saved_count || 0),
    };
  }

  const findUser = (id) =>
    db.prepare("SELECT * FROM users WHERE id=?").get(uuid(id)) ||
    (() => {
      throw notFound();
    })();

  router.get("/users/:id", (req, res) => {
    const row = findUser(req.params.id);
    const lastSignIn = sessionsHaveTimes
      ? Number(
          db
            .prepare("SELECT MAX(created_at) AS at FROM sessions WHERE user_id=?")
            .get(row.id)?.at || 0,
        ) || null
      : null;
    const detail = adminUser({
      ...row,
      listing_count: countQuery(
        "SELECT COUNT(*) AS count FROM listings WHERE owner_id=?",
        row.id,
      ),
      request_count: countQuery(
        "SELECT COUNT(*) AS count FROM handoff_requests WHERE requester_id=?",
        row.id,
      ),
      saved_count: countQuery(
        "SELECT COUNT(*) AS count FROM saved_listings WHERE user_id=?",
        row.id,
      ),
      last_sign_in: lastSignIn,
    });
    res.json({
      user: detail,
      listings: db
        .prepare(
          "SELECT id,title,status,price,campus_id,boost_until,created_at,updated_at FROM listings WHERE owner_id=? ORDER BY created_at DESC",
        )
        .all(row.id)
        .map((listing) => ({
          id: listing.id,
          title: listing.title,
          status: listing.status,
          price: listing.price,
          campusId: listing.campus_id,
          boostUntil: listing.boost_until || null,
          createdAt: listing.created_at,
          updatedAt: listing.updated_at,
        })),
      requestsSent: requestRows("r.requester_id=?", row.id),
      requestsReceived: requestRows("l.owner_id=?", row.id),
      sessions: sessionsHaveTimes
        ? db
            .prepare(
              "SELECT created_at,expires_at FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
            )
            .all(row.id)
            .map((s) => ({
              createdAt: new Date(s.created_at).toISOString(),
              expiresAt: new Date(s.expires_at).toISOString(),
              active: s.expires_at > Date.now(),
            }))
        : [],
      boosts: db
        .prepare(
          "SELECT b.id,b.listing_id,b.kind,b.price_cents,b.starts_at,b.ends_at,l.title FROM boosts b LEFT JOIN listings l ON l.id=b.listing_id WHERE b.user_id=? ORDER BY b.created_at DESC",
        )
        .all(row.id)
        .map((b) => ({
          id: b.id,
          listingId: b.listing_id,
          listingTitle: b.title || "",
          kind: b.kind,
          priceCents: b.price_cents,
          startsAt: b.starts_at,
          endsAt: b.ends_at,
        })),
      audit: auditRows("target_id=? OR admin_id=?", row.id, row.id),
      aiUsage: hasTable("ai_usage")
        ? db
            .prepare(
              "SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens+output_tokens),0) AS tokens FROM ai_usage WHERE user_id=?",
            )
            .get(row.id)
        : null,
    });
  });

  function requestRows(clause, ...params) {
    return db
      .prepare(
        `SELECT r.*, l.title AS listing_title, l.owner_id AS owner_id, u.name AS requester_name, o.name AS owner_name
         FROM handoff_requests r JOIN listings l ON l.id=r.listing_id
         JOIN users u ON u.id=r.requester_id JOIN users o ON o.id=l.owner_id
         WHERE ${clause} ORDER BY r.created_at DESC LIMIT 100`,
      )
      .all(...params)
      .map(adminRequest);
  }
  const adminRequest = (row) => ({
    id: row.id,
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  router.post("/users/:id/verify", (req, res) => {
    const row = findUser(req.params.id);
    db.prepare(
      "UPDATE users SET verified_at=COALESCE(verified_at,?),updated_at=? WHERE id=?",
    ).run(iso(), iso(), row.id);
    audit(req.user.id, "user.verify", "user", row.id, { email: row.email });
    res.json({ ok: true, user: adminUser(findUser(row.id)) });
  });

  router.post("/users/:id/admin", (req, res) => {
    const row = findUser(req.params.id);
    const on = req.body?.on === true;
    if (!on && row.id === req.user.id)
      throw new HttpError(
        400,
        "You cannot remove your own admin access. Ask another admin.",
      );
    db.prepare("UPDATE users SET is_admin=?,updated_at=? WHERE id=?").run(
      on ? 1 : 0,
      iso(),
      row.id,
    );
    audit(req.user.id, on ? "user.admin.grant" : "user.admin.revoke", "user", row.id, {
      email: row.email,
    });
    res.json({ ok: true, user: adminUser(findUser(row.id)) });
  });

  for (const action of ["disable", "enable"]) {
    router.post(`/users/:id/${action}`, (req, res) => {
      const row = findUser(req.params.id);
      if (action === "disable" && row.id === req.user.id)
        throw new HttpError(400, "You cannot disable your own account.");
      db.transaction(() => {
        db.prepare("UPDATE users SET disabled_at=?,updated_at=? WHERE id=?").run(
          action === "disable" ? iso() : null,
          iso(),
          row.id,
        );
        if (action === "disable")
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.id);
      })();
      audit(req.user.id, `user.${action}`, "user", row.id, { email: row.email });
      res.json({ ok: true, user: adminUser(findUser(row.id)) });
    });
  }

  /* ------------------------------------------------------------- listings */

  router.get("/listings", (req, res) => {
    const status = text(req.query.status, 20);
    const query = text(req.query.query);
    const page = positiveInt(req.query.page);
    const where = [];
    const params = [];
    if (["draft", "active", "handed_off", "archived"].includes(status)) {
      where.push("l.status=?");
      params.push(status);
    }
    if (status === "boosted") where.push("l.boost_until > datetime('now')");
    if (query) {
      where.push("(l.title LIKE ? OR l.address LIKE ? OR u.email LIKE ? OR l.id=?)");
      params.push(`%${query}%`, `%${query}%`, `%${query}%`, query);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM listings l JOIN users u ON u.id=l.owner_id ${clause}`,
        )
        .get(...params)?.count || 0,
    );
    const rows = db
      .prepare(
        `SELECT l.*, u.name AS owner_name, u.email AS owner_email,
           (SELECT COUNT(*) FROM listing_views v WHERE v.listing_id=l.id) AS view_count,
           (SELECT COUNT(*) FROM handoff_requests r WHERE r.listing_id=l.id) AS request_count
         FROM listings l JOIN users u ON u.id=l.owner_id ${clause}
         ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    res.json({
      listings: rows.map(adminListing),
      page,
      pageSize: PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  });

  const adminListing = (row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    campusId: row.campus_id,
    address: row.address,
    price: row.price,
    originalPrice: row.original_price ?? null,
    deposit: row.deposit,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    roomType: row.room_type,
    availableFrom: row.available_from,
    availableTo: row.available_to,
    photos: JSON.parse(row.photos || "[]"),
    moderationLocked: Boolean(row.moderation_locked),
    boostUntil: row.boost_until || null,
    boosted: Boolean(row.boost_until && row.boost_until > iso()),
    views: Number(row.view_count || 0),
    requests: Number(row.request_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const findListing = (id) =>
    db
      .prepare(
        "SELECT l.*, u.name AS owner_name, u.email AS owner_email, 0 AS view_count, 0 AS request_count FROM listings l JOIN users u ON u.id=l.owner_id WHERE l.id=?",
      )
      .get(uuid(id)) ||
    (() => {
      throw notFound();
    })();

  router.get("/listings/:id", (req, res) => {
    const row = findListing(req.params.id);
    res.json({
      listing: adminListing({
        ...row,
        view_count: countQuery(
          "SELECT COUNT(*) AS count FROM listing_views WHERE listing_id=?",
          row.id,
        ),
        request_count: countQuery(
          "SELECT COUNT(*) AS count FROM handoff_requests WHERE listing_id=?",
          row.id,
        ),
      }),
      requests: requestRows("r.listing_id=?", row.id),
      boosts: db
        .prepare(
          "SELECT id,kind,price_cents,starts_at,ends_at FROM boosts WHERE listing_id=? ORDER BY created_at DESC",
        )
        .all(row.id)
        .map((b) => ({
          id: b.id,
          kind: b.kind,
          priceCents: b.price_cents,
          startsAt: b.starts_at,
          endsAt: b.ends_at,
        })),
      reports: db
        .prepare(
          "SELECT id,reason,details,status,created_at FROM reports WHERE listing_id=? ORDER BY created_at DESC",
        )
        .all(row.id)
        .map((r) => ({
          id: r.id,
          reason: r.reason,
          details: r.details,
          status: r.status,
          createdAt: r.created_at,
        })),
      audit: auditRows("target_id=?", row.id),
    });
  });

  router.post("/listings/:id/archive", (req, res) => {
    const row = findListing(req.params.id);
    db.transaction(() => {
      db.prepare(
        "UPDATE listings SET status='archived',moderation_locked=1,updated_at=? WHERE id=?",
      ).run(iso(), row.id);
      db.prepare(
        "UPDATE handoff_requests SET status='declined',updated_at=? WHERE listing_id=? AND status='pending'",
      ).run(iso(), row.id);
    })();
    audit(req.user.id, "listing.archive", "listing", row.id, { title: row.title });
    res.json({ ok: true });
  });

  router.post("/listings/:id/unarchive", (req, res) => {
    const row = findListing(req.params.id);
    db.prepare(
      "UPDATE listings SET status='draft',moderation_locked=0,updated_at=? WHERE id=?",
    ).run(iso(), row.id);
    audit(req.user.id, "listing.unarchive", "listing", row.id, { title: row.title });
    res.json({ ok: true });
  });

  router.post("/listings/:id/unboost", (req, res) => {
    const row = findListing(req.params.id);
    db.prepare("UPDATE listings SET boost_until=NULL,updated_at=? WHERE id=?").run(
      iso(),
      row.id,
    );
    audit(req.user.id, "listing.unboost", "listing", row.id, { title: row.title });
    res.json({ ok: true });
  });

  /* ------------------------------------------------- requests and reports */

  router.get("/requests", (req, res) => {
    const status = text(req.query.status, 20);
    const page = positiveInt(req.query.page);
    const where = ["pending", "accepted", "declined", "withdrawn"].includes(status)
      ? "r.status=?"
      : "1=1";
    const params = where === "1=1" ? [] : [status];
    const total = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM handoff_requests r JOIN listings l ON l.id=r.listing_id WHERE ${where}`,
        )
        .get(...params)?.count || 0,
    );
    const rows = db
      .prepare(
        `SELECT r.*, l.title AS listing_title, l.owner_id AS owner_id, u.name AS requester_name, o.name AS owner_name
         FROM handoff_requests r JOIN listings l ON l.id=r.listing_id
         JOIN users u ON u.id=r.requester_id JOIN users o ON o.id=l.owner_id
         WHERE ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    res.json({
      requests: rows.map(adminRequest),
      page,
      pageSize: PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  });

  router.get("/reports", (req, res) => {
    const status = text(req.query.status, 20);
    const page = positiveInt(req.query.page);
    const where = ["open", "resolved"].includes(status) ? "rp.status=?" : "1=1";
    const params = where === "1=1" ? [] : [status];
    const total = Number(
      db
        .prepare(`SELECT COUNT(*) AS count FROM reports rp WHERE ${where}`)
        .get(...params)?.count || 0,
    );
    const rows = db
      .prepare(
        `SELECT rp.*, l.title AS listing_title, l.status AS listing_status, u.name AS reporter_name, u.email AS reporter_email
         FROM reports rp JOIN listings l ON l.id=rp.listing_id JOIN users u ON u.id=rp.reporter_id
         WHERE ${where} ORDER BY rp.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    res.json({
      reports: rows.map((row) => ({
        id: row.id,
        listingId: row.listing_id,
        listingTitle: row.listing_title,
        listingStatus: row.listing_status,
        reporterId: row.reporter_id,
        reporterName: row.reporter_name,
        reporterEmail: row.reporter_email,
        reason: row.reason,
        details: row.details,
        status: row.status,
        createdAt: row.created_at,
      })),
      page,
      pageSize: PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  });

  router.post("/reports/:id/resolve", (req, res) => {
    const id = uuid(req.params.id);
    const row = db.prepare("SELECT * FROM reports WHERE id=?").get(id);
    if (!row) throw notFound();
    db.prepare("UPDATE reports SET status='resolved' WHERE id=?").run(id);
    audit(req.user.id, "report.resolve", "report", id, {
      listingId: row.listing_id,
    });
    res.json({ ok: true });
  });

  /* ---------------------------------------------------- waitlist and usage */

  router.get("/waitlist", (req, res) => {
    const page = positiveInt(req.query.page);
    const total = countQuery("SELECT COUNT(*) AS count FROM waitlist");
    res.json({
      waitlist: db
        .prepare(
          "SELECT id,email,school,domain,created_at FROM waitlist ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .all(PAGE_SIZE, (page - 1) * PAGE_SIZE)
        .map((row) => ({
          id: row.id,
          email: row.email,
          school: row.school,
          domain: row.domain,
          createdAt: row.created_at,
        })),
      bySchool: db
        .prepare(
          "SELECT school, COUNT(*) AS count FROM waitlist GROUP BY school ORDER BY count DESC LIMIT 20",
        )
        .all()
        .map((row) => ({ school: row.school, count: Number(row.count) })),
      page,
      pageSize: PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  });

  router.get("/waitlist.csv", (req, res) => {
    const cell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = ["email,school,domain,created_at"];
    for (const row of db
      .prepare("SELECT email,school,domain,created_at FROM waitlist ORDER BY created_at DESC")
      .all())
      lines.push(
        [row.email, row.school, row.domain, row.created_at].map(cell).join(","),
      );
    audit(req.user.id, "waitlist.export", "waitlist", "all", {
      rows: lines.length - 1,
    });
    res
      .type("text/csv")
      .set("Content-Disposition", 'attachment; filename="handoff-waitlist.csv"')
      .send(`${lines.join("\n")}\n`);
  });

  router.get("/ai-usage", (req, res) => {
    if (!hasTable("ai_usage")) {
      res.json({ available: false, perDay: [], perUser: [], totals: null });
      return;
    }
    res.json({
      available: true,
      perDay: fillSeries(
        db
          .prepare(
            "SELECT substr(created_at,1,10) AS day, SUM(input_tokens+output_tokens) AS count FROM ai_usage WHERE created_at>=? GROUP BY day",
          )
          .all(since(30)),
        30,
      ),
      perUser: db
        .prepare(
          `SELECT a.user_id, u.name, u.email, COUNT(*) AS calls,
             COALESCE(SUM(a.input_tokens),0) AS input_tokens,
             COALESCE(SUM(a.output_tokens),0) AS output_tokens,
             MAX(a.created_at) AS last_used
           FROM ai_usage a LEFT JOIN users u ON u.id=a.user_id
           GROUP BY a.user_id ORDER BY (input_tokens+output_tokens) DESC LIMIT 100`,
        )
        .all()
        .map((row) => ({
          userId: row.user_id,
          name: row.name || "",
          email: row.email || "",
          calls: Number(row.calls),
          inputTokens: Number(row.input_tokens),
          outputTokens: Number(row.output_tokens),
          lastUsed: row.last_used,
        })),
      totals: db
        .prepare(
          "SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens FROM ai_usage",
        )
        .get(),
    });
  });

  function auditRows(clause = "1=1", ...params) {
    return db
      .prepare(
        `SELECT a.*, u.name AS admin_name, u.email AS admin_email FROM admin_audit a
         LEFT JOIN users u ON u.id=a.admin_id WHERE ${clause} ORDER BY a.created_at DESC LIMIT 100`,
      )
      .all(...params)
      .map((row) => ({
        id: row.id,
        adminId: row.admin_id,
        adminName: row.admin_name || "",
        adminEmail: row.admin_email || "",
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: row.details,
        createdAt: row.created_at,
      }));
  }

  router.get("/audit", (req, res) => {
    const page = positiveInt(req.query.page);
    const total = countQuery("SELECT COUNT(*) AS count FROM admin_audit");
    const rows = db
      .prepare(
        `SELECT a.*, u.name AS admin_name, u.email AS admin_email FROM admin_audit a
         LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .map((row) => ({
        id: row.id,
        adminId: row.admin_id,
        adminName: row.admin_name || "",
        adminEmail: row.admin_email || "",
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: row.details,
        createdAt: row.created_at,
      }));
    res.json({
      audit: rows,
      page,
      pageSize: PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  });

  /* --------------------------------------------------------------- system */

  router.get("/system", async (req, res) => {
    const release = await readRelease();
    const memory = process.memoryUsage();
    const [uploads, logos, disk, backups, journal] = await Promise.all([
      directorySize(uploadDir),
      directorySize(logoDir),
      diskUsage(data),
      backupListing(backupDir),
      journalTail(),
    ]);
    res.json({
      app: {
        release,
        nodeVersion: process.version,
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        memory: {
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          external: memory.external,
        },
        dataDir: data,
        staticDir,
        environment: process.env.NODE_ENV || "development",
      },
      database: {
        schemaVersion: db.pragma("user_version", { simple: true }),
        file: join(data, "handoff.sqlite"),
        bytes: await fileSize(join(data, "handoff.sqlite")),
        walBytes: await fileSize(join(data, "handoff.sqlite-wal")),
        journalMode: db.pragma("journal_mode", { simple: true }),
        pageSize: db.pragma("page_size", { simple: true }),
        tables: db
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .get().count,
      },
      host: {
        hostname: hostname(),
        platform: process.platform,
        arch: process.arch,
        osUptimeSeconds: Math.round(uptime()),
        loadAverage: loadavg().map((n) => Number(n.toFixed(2))),
        totalMemory: totalmem(),
        freeMemory: freemem(),
        cpus: cpus().length,
        cpuModel: cpus()[0]?.model || "",
      },
      storage: { uploads, logos, disk },
      backups,
      services: {
        mailConfigured: Boolean(emailReady),
        aiConfigured: Boolean(
          process.env.OPENAI_API_KEY || process.env.HANDOFF_AI_KEY,
        ),
        origin: process.env.HANDOFF_ORIGIN || "",
      },
      journal,
      generatedAt: iso(),
    });
  });

  async function readRelease() {
    for (const path of [
      join(here, "release.json"),
      join(staticDir, "release.json"),
      resolve(here, "../release.json"),
    ]) {
      try {
        const parsed = JSON.parse(await readFile(path, "utf8"));
        if (parsed?.release) return String(parsed.release);
      } catch {
        // Try the next location. A development tree has no release marker.
      }
    }
    return "development";
  }

  async function diskUsage(path) {
    try {
      const { stdout } = await execute("df", ["-k", path], { timeout: 4000 });
      const line = stdout.trim().split("\n").pop().split(/\s+/);
      const totalKb = Number(line[1]);
      const usedKb = Number(line[2]);
      const freeKb = Number(line[3]);
      if (!Number.isFinite(totalKb)) throw new Error("unreadable");
      return {
        available: true,
        filesystem: line[0],
        totalBytes: totalKb * 1024,
        usedBytes: usedKb * 1024,
        freeBytes: freeKb * 1024,
        usedPercent: totalKb ? Math.round((usedKb / totalKb) * 100) : 0,
      };
    } catch {
      return { available: false };
    }
  }

  async function backupListing(path) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      const rows = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        try {
          const info = await stat(join(path, entry.name));
          rows.push({
            name: entry.name,
            directory: info.isDirectory(),
            bytes: info.isDirectory()
              ? (await directorySize(join(path, entry.name))).bytes
              : info.size,
            modifiedAt: info.mtime.toISOString(),
          });
        } catch {
          // Skip anything that disappears mid listing.
        }
      }
      rows.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
      return { available: true, path, entries: rows.slice(0, 40) };
    } catch {
      return { available: false, path, entries: [] };
    }
  }

  async function journalTail() {
    try {
      const { stdout } = await execute(
        "journalctl",
        ["-u", "handoff", "-n", "50", "--no-pager"],
        { timeout: 6000, maxBuffer: 2 * 1024 * 1024 },
      );
      return { available: true, lines: stdout.trimEnd().split("\n").slice(-50) };
    } catch {
      // The service user often cannot read the journal, and a Mac has none.
      return { available: false, lines: [] };
    }
  }

  return router;
}
