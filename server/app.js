import express from "express";
import multer from "multer";
import sharp from "sharp";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CAMPUSES, configuredMailTransport } from "./config.js";
import {
  firstLiveCampus,
  liveCampusForEmail,
  schoolForEmail,
} from "./schools.js";
import {
  adminAllowList,
  adminGate,
  adminRouter,
  disabledError,
} from "./admin.js";
import { openDatabase } from "./database.js";
import { geocode } from "./geocode.js";
import {
  AiInputError,
  AiUnavailableError,
  chatListing,
  importChatSchema,
  mockEnabled,
  parseListing,
} from "./ai.js";
import {
  hashToken,
  randomToken,
  hashPassword,
  checkPassword,
  cookies,
  HttpError,
  rateLimiter,
} from "./security.js";
import {
  parse,
  email,
  token,
  password,
  signupSchema,
  passwordProblem,
  loginSchema,
  profileSchema,
  createListingSchema,
  patchListingSchema,
  listingQuerySchema,
  enforceGenderPreference,
  listingSchema,
  requestSchema,
  boostSchema,
  requestUpdateSchema,
  reportSchema,
  today,
  validateListing,
} from "./validation.js";

const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const GENERIC_EMAIL_MESSAGE =
  "If this email is eligible, you will receive a link shortly. Check your spam folder too.";
const listingFields = "l.*, u.name AS owner_name, u.avatar AS owner_avatar";
const listingJoin = "listings l JOIN users u ON u.id=l.owner_id";
const iso = () => new Date().toISOString();
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

const LOGO_HOSTNAME =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const LOGO_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const LOGO_TYPES = {
  png: "image/png",
  ico: "image/x-icon",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};
/** Trust the bytes over the header, icon services mislabel plenty of files. */
function logoExtension(contentType, body) {
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "png";
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)
    return "jpg";
  if (body.length >= 6 && body.subarray(0, 6).toString("latin1").startsWith("GIF8"))
    return "gif";
  if (body.length >= 12 && body.subarray(0, 4).toString("latin1") === "RIFF" && body.subarray(8, 12).toString("latin1") === "WEBP")
    return "webp";
  if (body.length >= 4 && body[0] === 0x00 && body[1] === 0x00 && body[2] === 0x01 && body[3] === 0x00)
    return "ico";
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (type === "image/svg+xml") return "svg";
  return null;
}
async function readLogoCache(logoDir, domain) {
  for (const ext of [...Object.keys(LOGO_TYPES), "none"]) {
    const file = join(logoDir, `${domain}.${ext}`);
    try {
      const info = await stat(file);
      if (Date.now() - info.mtimeMs > LOGO_MAX_AGE) continue;
      if (ext === "none") return "missing";
      return { ext, body: await readFile(file) };
    } catch {
      // Not cached under this extension, try the next one.
    }
  }
  return null;
}
async function writeLogoCache(logoDir, domain, ext, body) {
  try {
    await writeFile(join(logoDir, `${domain}.${ext}`), body, { mode: 0o600 });
  } catch {
    // A cache write failure must never fail the response.
  }
}
async function fetchLogo(domain) {
  const sources = [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
  ];
  for (const url of sources) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        redirect: "follow",
        headers: { Accept: "image/*" },
      });
      if (!response.ok) continue;
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length < 120 || body.length > 512 * 1024) continue;
      const ext = logoExtension(response.headers.get("content-type"), body);
      if (ext) return { ext, body };
    } catch {
      // Icon services fail often. Fall through to the next source.
    }
  }
  return null;
}
function sendLogo(res, ext, body) {
  res.set("Cache-Control", "public, max-age=604800");
  res.type(LOGO_TYPES[ext] || "application/octet-stream").send(body);
}

export function createApp({
  dataDir = process.env.HANDOFF_DATA_DIR || resolve("data"),
  mailTransport,
  origin = process.env.HANDOFF_ORIGIN || "https://app.handofflease.com",
  secureCookies,
  mailFrom = process.env.MAIL_FROM || "Handoff <hello@handofflease.com>",
  staticDir = resolve(dirname(fileURLToPath(import.meta.url)), "../dist"),
  // Smart import's model client. Undefined means read the environment, null
  // means there is no model, and a fake is injected by the tests.
  aiClient: injectedAiClient,
} = {}) {
  const aiReady = () =>
    injectedAiClient !== undefined
      ? Boolean(injectedAiClient)
      : Boolean(process.env.OPENAI_API_KEY) || mockEnabled();
  let aiClientPromise;
  const aiClient = () => {
    if (injectedAiClient !== undefined) return Promise.resolve(injectedAiClient);
    if (!process.env.OPENAI_API_KEY) return Promise.resolve(null);
    // Imported on first use so a deployment without a key never loads the SDK.
    aiClientPromise ||= import("openai").then(
      ({ OpenAI }) =>
        new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
          timeout: 90_000,
          maxRetries: 1,
        }),
    );
    return aiClientPromise;
  };
  const parsedOrigin = new URL(origin);
  if (
    !["https:", "http:"].includes(parsedOrigin.protocol) ||
    parsedOrigin.origin !== origin
  )
    throw new Error(
      "HANDOFF_ORIGIN must be an origin without a trailing slash or path.",
    );
  if (
    parsedOrigin.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname)
  )
    throw new Error("Public Handoff deployments require HTTPS.");
  /**
   * The internal dashboard host. Caddy reverse proxies
   * internal.handofflease.com to this same app and adds X-Handoff-Surface,
   * so one build and one process serve both surfaces.
   */
  const internalHosts = new Set([
    "internal.handofflease.com",
    "internal.localhost",
  ]);
  const surfaceOf = (req) =>
    String(req.get("X-Handoff-Surface") || "")
      .trim()
      .toLowerCase() === "internal" ||
    internalHosts.has(String(req.hostname || "").toLowerCase())
      ? "internal"
      : "app";
  // Mutations on the internal host carry its own Origin, never the app's.
  const internalOrigins = new Set([origin]);
  if (process.env.HANDOFF_INTERNAL_ORIGIN)
    internalOrigins.add(process.env.HANDOFF_INTERNAL_ORIGIN);
  else if (parsedOrigin.protocol === "https:")
    internalOrigins.add(
      `https://internal.${parsedOrigin.hostname.replace(/^app\./, "")}`,
    );
  if (parsedOrigin.protocol !== "https:")
    internalOrigins.add(
      `http://internal.localhost${parsedOrigin.port ? `:${parsedOrigin.port}` : ""}`,
    );
  /** The admin flag plus the HANDOFF_ADMIN_EMAILS allow list, read once here. */
  const isAllowedAdmin = adminGate(adminAllowList());
  const useSecureCookies = secureCookies ?? parsedOrigin.protocol === "https:";
  if (!useSecureCookies && parsedOrigin.protocol === "https:")
    throw new Error("HTTPS deployments require secure cookies.");
  const transport =
    mailTransport === undefined ? configuredMailTransport() : mailTransport;
  const emailReady = Boolean(
    transport && typeof transport.sendMail === "function",
  );
  const db = openDatabase(resolve(dataDir));
  const uploadDir = join(resolve(dataDir), "uploads");
  const logoDir = join(resolve(dataDir), "logos");
  mkdirSync(logoDir, { recursive: true, mode: 0o700 });
  const app = express();
  const limit = rateLimiter(db);
  const cookieName = useSecureCookies
    ? "__Host-handoff_session"
    : "handoff_session";
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.locals.db = db;
  app.locals.close = () => {
    if (db.open) {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
    }
  };
  app.locals.emailReady = emailReady;
  app.use((req, res, next) => {
    req.surface = surfaceOf(req);
    // The internal host is never indexed. Caddy sends this too, belt and braces.
    if (req.surface === "internal")
      res.set("X-Robots-Tag", "noindex, nofollow");
    next();
  });
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tiles.openfreemap.org; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; child-src blob:; font-src 'self'; object-src 'none'; frame-ancestors 'self' https://handofflease.com https://www.handofflease.com; base-uri 'self'; form-action 'self'",
    });
    if (useSecureCookies)
      res.set("Strict-Transport-Security", "max-age=31536000");
    if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    next();
  });
  // The homepage on the root domain asks who is signed in so its header can
  // show the student instead of a sign in link. Read only, session cookie is
  // same site, and only the two root origins are allowed.
  const homepageOrigins = new Set([
    "https://handofflease.com",
    "https://www.handofflease.com",
  ]);
  app.get("/api/session", (req, res, next) => {
    const from = req.get("Origin");
    if (from && homepageOrigins.has(from)) {
      res.set({
        "Access-Control-Allow-Origin": from,
        "Access-Control-Allow-Credentials": "true",
        Vary: "Origin",
      });
    }
    next();
  });
  app.use("/api", (req, res, next) => {
    const allowedOrigin =
      req.surface === "internal"
        ? internalOrigins.has(req.get("Origin"))
        : req.get("Origin") === origin;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !allowedOrigin)
      return next(
        new HttpError(
          403,
          "This request must come from Handoff. Refresh the page and try again.",
        ),
      );
    next();
  });
  /**
   * The internal host is the dashboard and nothing else. It needs the session,
   * the config, health and its own sign in, so every other student route
   * answers 404 there. The app host is untouched.
   */
  const internalApiPath = (path) =>
    ["/health", "/config", "/session", "/auth/login", "/auth/logout"].includes(
      path,
    ) ||
    path === "/admin" ||
    path.startsWith("/admin/");
  app.use("/api", (req, res, next) =>
    req.surface !== "internal" || internalApiPath(req.path)
      ? next()
      : next(new HttpError(404, "Endpoint not found.")),
  );
  app.use(express.json({ limit: "96kb", strict: true }));
  app.use((req, res, next) => {
    const sessionToken = cookies(req.get("Cookie"))[cookieName];
    if (sessionToken && /^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
      req.user = db
        .prepare(
          "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
        )
        .get(hashToken(sessionToken), Date.now());
      req.sessionHash = hashToken(sessionToken);
    }
    next();
  });
  // Any signed in student, verified or not. Browsing, saving, drafts, profile.
  const requireUser = (req, res, next) =>
    req.user
      ? next(disabledError(req.user))
      : next(new HttpError(401, "Sign in with your student account to continue."));
  // Verified students only. Publishing, requesting a handoff, reporting.
  const requireVerified = (req, res, next) =>
    !req.user
      ? next(new HttpError(401, "Sign in with your student account to continue."))
      : disabledError(req.user)
        ? next(disabledError(req.user))
        : req.user.verified_at
          ? next()
          : next(
            new HttpError(
              403,
              "Verify your student email to do this. Check your inbox for the link, or resend it from your profile.",
            ),
          );
  const requireMail = (req, res, next) =>
    emailReady
      ? next()
      : next(
          new HttpError(
            503,
            "Student email delivery is not available yet. Please try again later.",
          ),
        );
  const accountIdentity = (req) =>
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : req.ip;
  /**
   * campusId is the live campus this student may post at, null when Handoff
   * has not opened at their school. school is always present so the app can
   * name the school in full.
   */
  const serializeUser = (user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    campusId: user.campus_id || null,
    school: {
      name: user.school_name || schoolForEmail(user.email)?.name || "",
      domain: user.school_domain || schoolForEmail(user.email)?.domain || "",
      live: Boolean(user.campus_id),
    },
    verified: Boolean(user.verified_at),
    termsAccepted: Boolean(user.terms_accepted_at),
    bio: user.bio,
    gender: user.gender || "unspecified",
    /** Optional profile photo, a public path like a listing photo, or null. */
    avatar: user.avatar || null,
    // The allow list decides, so the client never offers a dashboard that the
    // API would answer 404 for.
    isAdmin: isAllowedAdmin(user),
  });
  /**
   * Listing is the one thing a live campus unlocks. Browsing, saving and
   * requesting stay open to every student, wherever they study.
   */
  const requirePostingCampus = (req) => {
    if (req.user?.campus_id) return req.user.campus_id;
    const school = req.user?.school_name || "your school";
    throw new HttpError(
      403,
      `Listing is not open at ${school} yet. You can still browse, save and request anywhere Handoff is live.`,
      "school_not_live",
    );
  };
  const setSession = (res, userId) => {
    const value = randomToken();
    db.prepare(
      "INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
    ).run(hashToken(value), userId, Date.now(), Date.now() + SESSION_AGE);
    res.cookie(cookieName, value, {
      httpOnly: true,
      secure: useSecureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_AGE,
    });
  };
  const clearSession = (res) =>
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: useSecureCookies,
      sameSite: "lax",
      path: "/",
    });
  const invalidateTokens = (userId, kind) =>
    db
      .prepare(
        "UPDATE auth_tokens SET consumed_at=? WHERE user_id=? AND kind=? AND consumed_at IS NULL",
      )
      .run(Date.now(), userId, kind);
  const validToken = (value, kind) => {
    const found = db
      .prepare(
        "SELECT * FROM auth_tokens WHERE token_hash=? AND kind=? AND consumed_at IS NULL AND expires_at>?",
      )
      .get(hashToken(value), kind, Date.now());
    if (!found)
      throw new HttpError(
        400,
        "This link has expired or already been used. Request a new one.",
      );
    return found;
  };
  const sendMail = async (to, subject, text, html) => {
    if (!emailReady) throw new Error("Email delivery is not configured.");
    const delivery = await transport.sendMail({
      from: mailFrom,
      to,
      subject,
      text,
      html,
    });
    if (delivery?.rejected?.length)
      throw new Error("Email provider rejected recipient.");
  };
  const emailShell = (title, bodyHtml) => `<!doctype html><html lang="en"><body style="margin:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1b2330;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fa;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border-radius:16px;box-shadow:0 1px 2px rgba(16,24,40,.06),0 8px 24px rgba(16,24,40,.06);">
<tr><td style="padding:28px 32px 0;font-size:22px;font-weight:700;letter-spacing:-0.03em;color:#1b2330;">Handoff</td></tr>
<tr><td style="padding:20px 32px 0;font-size:20px;font-weight:600;letter-spacing:-0.02em;line-height:1.3;">${escapeHtml(title)}</td></tr>
${bodyHtml}
<tr><td style="padding:24px 32px 28px;font-size:12px;line-height:1.6;color:#667281;border-top:1px solid #e6e9ee;">Handoff is the student to student sublease marketplace. If you did not ask for this email, you can ignore it and nothing will change.</td></tr>
</table>
<div style="max-width:480px;padding:16px 8px 0;font-size:11px;color:#8a94a1;">Sent by Handoff, handofflease.com</div>
</td></tr></table></body></html>`;
  const otpHash = (userId, code) => hashToken(`otp:${userId}:${code}`);
  const sendToken = async (user, kind) => {
    const value = randomToken();
    const key = hashToken(value);
    const expiry = kind === "verify" ? 24 * HOUR : HOUR;
    const code =
      kind === "verify" ? String(randomInt(0, 1_000_000)).padStart(6, "0") : null;
    // Persist before delivery. A failed send invalidates only this token, preserving earlier valid links.
    db.transaction(() => {
      db.prepare(
        "INSERT INTO auth_tokens(token_hash,user_id,kind,expires_at,created_at) VALUES(?,?,?,?,?)",
      ).run(key, user.id, kind, Date.now() + expiry, Date.now());
      if (code) {
        // One live code at a time. The code shares the verify kind and expires in 15 minutes.
        db.prepare(
          "UPDATE auth_tokens SET consumed_at=? WHERE user_id=? AND kind='verify' AND consumed_at IS NULL AND token_hash LIKE 'otp%'",
        ).run(Date.now(), user.id);
        db.prepare(
          "INSERT INTO auth_tokens(token_hash,user_id,kind,expires_at,created_at) VALUES(?,?,?,?,?)",
        ).run(`otp${otpHash(user.id, code)}`, user.id, "verify", Date.now() + 15 * 60 * 1000, Date.now());
      }
    })();
    const link = `${origin}/${kind === "verify" ? "verify" : "reset-password"}?token=${encodeURIComponent(value)}`;
    const action =
      kind === "verify" ? "Verify your student email" : "Reset your password";
    const expiryText = kind === "verify" ? "24 hours" : "1 hour";
    const firstName = escapeHtml((user.name || "").split(" ")[0] || "there");
    const text =
      kind === "verify"
        ? `Hi ${firstName},\n\nYour Handoff verification code is ${code}. Enter it in the app, or open this link:\n\n${link}\n\nThe code works for 15 minutes and the link for 24 hours. Each works once. If you did not sign up for Handoff, ignore this email.`
        : `${action}\n\n${link}\n\nThis link expires in ${expiryText} and works once. If you did not request this, ignore this email.`;
    const button = `<tr><td style="padding:20px 32px 0;"><a href="${link}" style="display:inline-block;background:#3b78d7;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">${escapeHtml(action)}</a></td></tr>`;
    const html =
      kind === "verify"
        ? emailShell(`Hi ${firstName}, confirm it is really you.`, `
<tr><td style="padding:10px 32px 0;font-size:15px;line-height:1.6;color:#3a4553;">Enter this code in Handoff to verify your student email. It works for 15 minutes.</td></tr>
<tr><td style="padding:18px 32px 0;"><div style="display:inline-block;font-size:34px;font-weight:700;letter-spacing:0.28em;padding:14px 22px 14px 26px;border-radius:12px;background:#edf3fd;color:#24519b;font-variant-numeric:tabular-nums;">${code}</div></td></tr>
<tr><td style="padding:22px 32px 0;font-size:14px;line-height:1.6;color:#3a4553;">Prefer one tap? Use the button instead. The link works once and expires in 24 hours.</td></tr>
${button}
<tr><td style="padding:22px 32px 0;font-size:13px;line-height:1.6;color:#667281;">You can keep browsing without verifying. Verification is needed to publish a listing or request a handoff, which keeps every conversation student to student.</td></tr>
<tr><td style="padding:12px 32px 0;font-size:12px;line-height:1.6;color:#8a94a1;word-break:break-all;">Or paste this address into your browser<br>${escapeHtml(link)}</td></tr>`)
        : emailShell(action, `
<tr><td style="padding:10px 32px 0;font-size:15px;line-height:1.6;color:#3a4553;">Choose a new password with the button below. The link works once and expires in ${expiryText}.</td></tr>
${button}
<tr><td style="padding:22px 32px 0;font-size:12px;line-height:1.6;color:#8a94a1;word-break:break-all;">Or paste this address into your browser<br>${escapeHtml(link)}</td></tr>`);
    try {
      await sendMail(user.email, `${action} for Handoff`, text, html);
    } catch {
      db.prepare(
        "UPDATE auth_tokens SET consumed_at=? WHERE token_hash=? OR (user_id=? AND kind='verify' AND token_hash LIKE 'otp%' AND consumed_at IS NULL)",
      ).run(Date.now(), key, user.id);
      throw new HttpError(
        503,
        "We could not deliver your email. Please try again shortly.",
      );
    }
  };

  // Publishing and requesting need the marketplace terms accepted once.
  app.post("/api/auth/accept-terms", requireUser, (req, res) => {
    db.prepare(
      "UPDATE users SET terms_accepted_at=COALESCE(terms_accepted_at,?),updated_at=? WHERE id=?",
    ).run(iso(), iso(), req.user.id);
    res.json({
      user: serializeUser(
        db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id),
      ),
    });
  });
  const requireTerms = (req, res, next) =>
    req.user?.terms_accepted_at
      ? next()
      : next(
          new HttpError(
            403,
            "Please accept the Terms of Service and Privacy Policy first.",
          ),
        );
  // Students at campuses Handoff has not opened yet leave an email.
  app.post(
    "/api/waitlist",
    limit("waitlist-ip", 20, HOUR),
    limit("waitlist-email", 5, HOUR, accountIdentity),
    (req, res) => {
      const input = parse(
        z
          .object({
            email: z.string().trim().toLowerCase().email().max(254),
            school: z.string().trim().min(2).max(160),
            domain: z.string().trim().toLowerCase().max(100).default(""),
          })
          .strict(),
        req.body,
      );
      db.prepare(
        "INSERT OR IGNORE INTO waitlist(id,email,school,domain,created_at) VALUES(?,?,?,?,?)",
      ).run(randomUUID(), input.email, input.school, input.domain, iso());
      res.status(202).json({
        message: `Thanks. We will email ${input.email} when Handoff opens at ${input.school}.`,
      });
    },
  );
  // Address suggestions for the listing editor. Any session may ask, the
  // lister is typing their own street, and the answer places the pin.
  app.get(
    "/api/geocode",
    requireUser,
    limit("geocode-ip", 120, 15 * 60 * 1000),
    async (req, res, next) => {
      try {
        const input = parse(
          z.object({
            q: z.string().trim().min(3).max(200),
            campusId: z.string().max(40).optional(),
          }),
          req.query,
        );
        const campus =
          CAMPUSES.find(
            (c) => c.id === (input.campusId || req.user.campus_id),
          ) || firstLiveCampus();
        res.json({ results: await geocode(input.q, campus) });
      } catch (error) {
        if (error?.name === "TimeoutError" || error?.message?.startsWith("geocoder"))
          return res.status(503).json({ error: "Address lookup is unavailable right now. Place the pin by hand." });
        next(error);
      }
    },
  );
  app.get("/api/health", (req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ ok: true, version: "1.0.0" });
  });
  // School logos for the campus picker. Public, cached on disk for 30 days so
  // the icon services see one request per school, and 404 when nothing usable
  // comes back so the client can draw its own fallback mark.
  app.get(
    "/api/logo/:domain",
    limit("logo-ip", 300, 15 * 60 * 1000),
    async (req, res, next) => {
      try {
        const domain = String(req.params.domain || "").toLowerCase();
        if (!LOGO_HOSTNAME.test(domain))
          throw new HttpError(404, "Logo not found.");
        const cached = await readLogoCache(logoDir, domain);
        if (cached === "missing") throw new HttpError(404, "Logo not found.");
        if (cached) return sendLogo(res, cached.ext, cached.body);
        const fetched = await fetchLogo(domain);
        if (!fetched) {
          await writeLogoCache(logoDir, domain, "none", Buffer.alloc(0));
          throw new HttpError(404, "Logo not found.");
        }
        await writeLogoCache(logoDir, domain, fetched.ext, fetched.body);
        sendLogo(res, fetched.ext, fetched.body);
      } catch (error) {
        next(error);
      }
    },
  );
  app.get("/api/config", (req, res) =>
    res.json({ emailReady, aiReady: aiReady(), campuses: CAMPUSES }),
  );
  app.get("/api/session", (req, res) =>
    res.json({ user: req.user ? serializeUser(req.user) : null }),
  );
  const ABANDONED_AFTER = 24 * HOUR;
  /**
   * A registration nobody ever came back to: never verified, never signed in
   * since, and older than a day. Only these may be taken over by a fresh
   * signup, so a live account is never overwritten by whoever types the
   * address next.
   */
  const abandonedRegistration = (row) => {
    if (!row || row.verified_at) return false;
    const created = Date.parse(row.created_at);
    if (!Number.isFinite(created) || Date.now() - created < ABANDONED_AFTER)
      return false;
    return !db
      .prepare("SELECT 1 FROM sessions WHERE user_id=? LIMIT 1")
      .get(row.id);
  };
  // Step one of signup asks whether the email is free before any other step.
  app.post(
    "/api/auth/check-email",
    limit("check-email-ip", 60, HOUR),
    (req, res) => {
      const input = parse(
        z.object({ email: z.string().trim().toLowerCase().email().max(254) }),
        req.body,
      );
      const school = schoolForEmail(input.email);
      if (!school)
        throw new HttpError(
          400,
          "Use your school email. We could not find that school yet.",
          "school_unknown",
        );
      const claimed = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(input.email);
      const exists = Boolean(claimed && !abandonedRegistration(claimed));
      res.json({
        exists,
        school: {
          name: school.name,
          domain: school.domain,
          live: Boolean(liveCampusForEmail(input.email)),
        },
      });
    },
  );
  app.post(
    "/api/auth/signup",
    limit("signup-ip", 10, HOUR),
    // Mail is checked inside, after the account check. Telling a returning
    // student their account already exists needs no email at all.
    async (req, res) => {
      const input = parse(signupSchema, req.body);
      const school = schoolForEmail(input.email);
      if (!school)
        throw new HttpError(
          400,
          "Use your school email. We could not find that school yet.",
          "school_unknown",
        );
      // The campus is derived, never chosen. Null means browse only for now.
      const campusId = liveCampusForEmail(input.email)?.id || null;
      // One account per email. A student who already registered is sent to
      // sign in instead of quietly signing up again. The only exception is an
      // abandoned registration, unverified, older than a day, never used.
      const claimed = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(input.email);
      if (claimed && !abandonedRegistration(claimed))
        throw new HttpError(
          409,
          "This email already has an account. Sign in instead.",
          "account_exists",
        );
      if (!emailReady)
        throw new HttpError(
          503,
          "Student email delivery is not available yet. Please try again later.",
        );
      const passwordHash = await hashPassword(input.password);
      const user = db.transaction(() => {
        let existing = db
          .prepare("SELECT * FROM users WHERE email=?")
          .get(input.email);
        if (existing && !abandonedRegistration(existing)) return existing;
        const timestamp = iso();
        if (existing) {
          // A legitimate signup must never activate a password chosen by a prior unverified registrant.
          db.prepare(
            "UPDATE users SET name=?,campus_id=?,school_domain=?,school_name=?,password_hash=?,gender=?,updated_at=? WHERE id=? AND verified_at IS NULL",
          ).run(
            input.name,
            campusId,
            school.domain,
            school.name,
            passwordHash,
            input.gender,
            timestamp,
            existing.id,
          );
          invalidateTokens(existing.id, "verify");
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(existing.id);
        } else {
          const id = randomUUID();
          db.prepare(
            "INSERT INTO users(id,name,email,campus_id,school_domain,school_name,password_hash,gender,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
          ).run(
            id,
            input.name,
            input.email,
            campusId,
            school.domain,
            school.name,
            passwordHash,
            input.gender,
            timestamp,
            timestamp,
          );
        }
        return db.prepare("SELECT * FROM users WHERE email=?").get(input.email);
      })();
      if (user.verified_at || user.password_hash !== passwordHash) {
        // The row was claimed between the check and the write. Same answer.
        throw new HttpError(
          409,
          "This email already has an account. Sign in instead.",
          "account_exists",
        );
      }
      await sendToken(user, "verify");
      if (req.sessionHash)
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
          req.sessionHash,
        );
      setSession(res, user.id);
      res.status(201).json({ message: GENERIC_EMAIL_MESSAGE, user: serializeUser(user) });
    },
  );
  app.post(
    "/api/auth/login",
    limit("login-ip", 40, 15 * 60 * 1000),
    limit("login-email", 12, 15 * 60 * 1000, accountIdentity),
    async (req, res) => {
      const input = parse(loginSchema, req.body);
      const user = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(input.email);
      const matches = await checkPassword(input.password, user?.password_hash);
      const currentUser =
        user && db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
      // A reset may complete while scrypt yields. Never create a session using stale credentials.
      if (
        !matches ||
        !currentUser ||
        currentUser.password_hash !== user.password_hash
      )
        throw new HttpError(401, "Email or password is incorrect.");
      if (currentUser.disabled_at) throw disabledError(currentUser);
      // The internal host signs in the Handoff team only, and never opens a
      // session for anybody else.
      if (req.surface === "internal" && !isAllowedAdmin(currentUser))
        throw new HttpError(403, "This sign in is for the Handoff team.");
      if (req.sessionHash)
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
          req.sessionHash,
        );
      setSession(res, currentUser.id);
      res.json({ user: serializeUser(currentUser) });
    },
  );
  app.post("/api/auth/logout", (req, res) => {
    if (req.sessionHash)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        req.sessionHash,
      );
    clearSession(res);
    res.json({ ok: true });
  });
  app.post("/api/auth/verify", limit("verify-ip", 30, HOUR), (req, res) => {
    const input = parse(z.object({ token }).strict(), req.body);
    const user = db.transaction(() => {
      const found = validToken(input.token, "verify");
      db.prepare(
        "UPDATE users SET verified_at=COALESCE(verified_at,?),updated_at=? WHERE id=?",
      ).run(iso(), iso(), found.user_id);
      invalidateTokens(found.user_id, "verify");
      // Any session opened before verification, including a stranger's, ends here.
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(found.user_id);
      setSession(res, found.user_id);
      return db.prepare("SELECT * FROM users WHERE id=?").get(found.user_id);
    })();
    res.json({ user: serializeUser(user) });
  });
  app.post(
    "/api/auth/verify-code",
    limit("verify-code-ip", 30, HOUR),
    limit("verify-code-user", 8, 15 * 60 * 1000, (req) => req.user?.id || req.ip),
    (req, res) => {
      if (!req.user)
        throw new HttpError(401, "Sign in first, then enter your code.");
      const input = parse(
        z.object({ code: z.string().regex(/^\d{6}$/) }).strict(),
        req.body,
      );
      if (req.user.verified_at) {
        res.json({ user: serializeUser(req.user) });
        return;
      }
      const user = db.transaction(() => {
        const found = db
          .prepare(
            "SELECT * FROM auth_tokens WHERE token_hash=? AND kind='verify' AND consumed_at IS NULL AND expires_at>?",
          )
          .get(`otp${otpHash(req.user.id, input.code)}`, Date.now());
        if (!found)
          throw new HttpError(
            400,
            "That code is not right or has expired. Request a new one.",
          );
        db.prepare(
          "UPDATE users SET verified_at=COALESCE(verified_at,?),updated_at=? WHERE id=?",
        ).run(iso(), iso(), req.user.id);
        invalidateTokens(req.user.id, "verify");
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
        setSession(res, req.user.id);
        return db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
      })();
      res.json({ user: serializeUser(user) });
    },
  );
  for (const [route, kind] of [
    ["resend", "verify"],
    ["forgot", "reset"],
  ]) {
    app.post(
      `/api/auth/${route}`,
      limit(`${route}-ip`, 12, HOUR),
      limit(`${route}-email`, 4, HOUR, accountIdentity),
      requireMail,
      async (req, res) => {
        const input = parse(z.object({ email }).strict(), req.body);
        const user = db
          .prepare("SELECT * FROM users WHERE email=?")
          .get(input.email);
        if (
          user &&
          (kind === "verify" ? !user.verified_at : Boolean(user.verified_at))
        )
          await sendToken(user, kind);
        res.status(202).json({ message: GENERIC_EMAIL_MESSAGE });
      },
    );
  }
  app.post("/api/auth/reset", limit("reset-ip", 20, HOUR), async (req, res) => {
    const input = parse(z.object({ token, password }).strict(), req.body);
    const holder = validToken(input.token, "reset");
    // The same rules as signup, now that the token names the account.
    const account = db
      .prepare("SELECT name,email FROM users WHERE id=?")
      .get(holder.user_id);
    const problem = passwordProblem(input.password, {
      email: account?.email || "",
      name: account?.name || "",
    });
    if (problem) throw new HttpError(400, problem);
    const passwordHash = await hashPassword(input.password);
    db.transaction(() => {
      const found = validToken(input.token, "reset");
      db.prepare(
        "UPDATE users SET password_hash=?,updated_at=? WHERE id=?",
      ).run(passwordHash, iso(), found.user_id);
      invalidateTokens(found.user_id, "reset");
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(found.user_id);
    })();
    clearSession(res);
    res.json({
      message: "Your password has been reset. Sign in with your new password.",
    });
  });
  app.patch(
    "/api/profile",
    requireUser,
    limit("profile", 30, HOUR, (req) => req.user.id),
    (req, res) => {
      const input = parse(profileSchema, req.body);
      db.prepare(
        "UPDATE users SET name=?,bio=?,gender=?,updated_at=? WHERE id=?",
      ).run(
        input.name,
        input.bio,
        input.gender ?? req.user.gender ?? "unspecified",
        iso(),
        req.user.id,
      );
      res.json({
        user: serializeUser(
          db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id),
        ),
      });
    },
  );

  /**
   * A signed out visitor gets the place, never the address. The point is moved
   * by up to 250 metres in a direction taken from the listing id, so the same
   * listing always lands on the same spot and the pin never wanders between
   * loads. Signing in returns the real coordinates.
   */
  const FUZZ_METRES = 250;
  const approximatePoint = (id, lat, lng) => {
    const digest = createHash("sha256").update(`approx:${id}`).digest();
    const angle = (digest.readUInt32BE(0) / 0xffffffff) * Math.PI * 2;
    // Square root keeps the offsets spread evenly over the disc.
    const radius = Math.sqrt(digest.readUInt32BE(4) / 0xffffffff) * FUZZ_METRES;
    const north = (radius * Math.cos(angle)) / 111320;
    const east =
      (radius * Math.sin(angle)) /
      (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
    return {
      lat: Number((lat + north).toFixed(6)),
      lng: Number((lng + east).toFixed(6)),
    };
  };
  const serializeListing = (row, userId) => {
    const locked = !userId;
    const point = locked
      ? approximatePoint(row.id, row.lat, row.lng)
      : { lat: row.lat, lng: row.lng };
    return {
      id: row.id,
      ownerId: row.owner_id,
      ownerName: locked ? null : row.owner_name,
      ownerAvatar: locked ? null : row.owner_avatar || null,
      campusId: row.campus_id,
      title: row.title,
      description: locked ? null : row.description,
      address: locked ? null : row.address,
      lat: point.lat,
      lng: point.lng,
      price: row.price,
      deposit: row.deposit,
      originalPrice: row.original_price ?? null,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      roomType: row.room_type,
      genderPreference: row.gender_preference || "any",
      availableFrom: row.available_from,
      availableTo: row.available_to,
      amenities: JSON.parse(row.amenities),
      photos: JSON.parse(row.photos),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      boostUntil: row.boost_until ?? null,
      boosted: Boolean(row.boost_until && row.boost_until > iso()),
      saved: userId
        ? Boolean(
            db
              .prepare(
                "SELECT 1 FROM saved_listings WHERE user_id=? AND listing_id=?",
              )
              .get(userId, row.id),
          )
        : false,
      /** Sensitive fields are held back until the visitor confirms they study. */
      locked,
    };
  };
  const getListing = (id) =>
    db
      .prepare(`SELECT ${listingFields} FROM ${listingJoin} WHERE l.id=?`)
      .get(id);
  const isPublic = (row) =>
    row?.status === "active" && row.available_to >= today();
  const assertPublic = (row) => {
    if (!isPublic(row))
      throw new HttpError(404, "This listing is no longer available.");
  };
  const assertOwner = (row, user) => {
    if (!row || row.owner_id !== user.id)
      throw new HttpError(404, "Listing not found.");
  };
  const validatePhotos = (photos, userId) => {
    for (const photo of photos) {
      const upload = db
        .prepare("SELECT * FROM uploads WHERE filename=? AND owner_id=?")
        .get(photo.slice("/uploads/".length), userId);
      if (!upload || !existsSync(join(uploadDir, upload.filename)))
        throw new HttpError(
          400,
          "A photo is missing or belongs to another account. Upload your own photos.",
        );
    }
  };
  app.get("/api/listings", (req, res) => {
    const query = parse(
      listingQuerySchema,
      Object.fromEntries(
        Object.entries(req.query).filter(([, value]) => value !== ""),
      ),
    );
    const clauses = ["l.status='active'", "l.available_to>=?"];
    const parameters = [today()];
    if (query.campusId) {
      clauses.push("l.campus_id=?");
      parameters.push(query.campusId);
    }
    if (query.query) {
      clauses.push(
        "(l.title LIKE ? ESCAPE '\\' OR l.description LIKE ? ESCAPE '\\' OR l.address LIKE ? ESCAPE '\\')",
      );
      const term = `%${query.query.replace(/[\\%_]/g, "\\$&")}%`;
      parameters.push(term, term, term);
    }
    if (query.minPrice !== undefined) {
      clauses.push("l.price>=?");
      parameters.push(query.minPrice);
    }
    if (query.maxPrice !== undefined) {
      clauses.push("l.price<=?");
      parameters.push(query.maxPrice);
    }
    if (query.from) {
      clauses.push("l.available_from<=?", "l.available_to>=?");
      parameters.push(query.from, query.from);
    }
    if (query.to) {
      clauses.push("l.available_to>=?", "l.available_from<=?");
      parameters.push(query.to, query.to);
    }
    if (query.roomType) {
      clauses.push("l.room_type=?");
      parameters.push(query.roomType);
    }
    // "Open to women" keeps listings with no preference, women only and women
    // preferred. The only-* values narrow to exactly that preference.
    if (query.gender) {
      const allowed = {
        women: ["any", "women_only", "women_preferred"],
        men: ["any", "men_only", "men_preferred"],
        women_only: ["women_only"],
        men_only: ["men_only"],
      }[query.gender];
      clauses.push(
        `l.gender_preference IN (${allowed.map(() => "?").join(",")})`,
      );
      parameters.push(...allowed);
    }
    if (query.bedrooms !== undefined) {
      clauses.push("l.bedrooms>=?");
      parameters.push(query.bedrooms);
    }
    if (query.amenities) {
      const amenities = [
        ...new Set(
          query.amenities
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ];
      if (amenities.length > 20)
        throw new HttpError(400, "Choose up to 20 amenities.");
      for (const amenity of amenities) {
        clauses.push(
          "EXISTS(SELECT 1 FROM json_each(l.amenities) WHERE value=?)",
        );
        parameters.push(amenity);
      }
    }
    const order = {
      newest: "l.created_at DESC",
      price_asc: "l.price ASC,l.created_at DESC",
      price_desc: "l.price DESC,l.created_at DESC",
      savings:
        "CASE WHEN l.original_price IS NOT NULL AND l.original_price>l.price THEN l.original_price-l.price ELSE 0 END DESC,l.created_at DESC",
    }[query.sort];
    // A boost lifts the listing above the rest inside whichever sort is asked for.
    parameters.push(iso());
    const rows = db
      .prepare(
        `SELECT ${listingFields} FROM ${listingJoin} WHERE ${clauses.join(" AND ")} ORDER BY CASE WHEN l.boost_until > ? THEN 0 ELSE 1 END,${order} LIMIT 500`,
      )
      .all(...parameters);
    res.json({
      listings: rows.map((row) => serializeListing(row, req.user?.id)),
    });
  });
  app.get("/api/my-listings", requireUser, (req, res) => {
    const rows = db
      .prepare(
        `SELECT ${listingFields} FROM ${listingJoin} WHERE l.owner_id=? ORDER BY l.updated_at DESC`,
      )
      .all(req.user.id);
    res.json({
      listings: rows.map((row) => serializeListing(row, req.user.id)),
    });
  });
  app.get("/api/listings/:id", (req, res) => {
    const row = getListing(req.params.id);
    if (!row || (!isPublic(row) && row.owner_id !== req.user?.id))
      throw new HttpError(404, "This listing is no longer available.");
    countView(row, req);
    res.json({ listing: serializeListing(row, req.user?.id) });
  });
  app.post(
    "/api/listings",
    requireUser,
    limit("listing-create", 20, HOUR, (req) => req.user.id),
    (req, res) => {
      const input = enforceGenderPreference(parse(createListingSchema, req.body));
      const campusId = requirePostingCampus(req);
      if (input.status === "active" && !req.user.verified_at)
        throw new HttpError(
          403,
          "Verify your student email to publish. Your draft is safe until then.",
        );
      if (input.status === "active" && !req.user.terms_accepted_at)
        throw new HttpError(
          403,
          "Please accept the Terms of Service and Privacy Policy before publishing.",
        );
      validateListing(input);
      validatePhotos(input.photos, req.user.id);
      const id = randomUUID();
      const timestamp = iso();
      db.prepare(
        `INSERT INTO listings(id,owner_id,campus_id,title,description,address,lat,lng,price,deposit,original_price,bedrooms,bathrooms,room_type,gender_preference,available_from,available_to,amenities,photos,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        req.user.id,
        campusId,
        input.title,
        input.description,
        input.address,
        input.lat,
        input.lng,
        input.price,
        input.deposit,
        input.originalPrice,
        input.bedrooms,
        input.bathrooms,
        input.roomType,
        input.genderPreference,
        input.availableFrom,
        input.availableTo,
        JSON.stringify(input.amenities),
        JSON.stringify(input.photos),
        input.status,
        timestamp,
        timestamp,
      );
      res
        .status(201)
        .json({ listing: serializeListing(getListing(id), req.user.id) });
    },
  );
  app.patch(
    "/api/listings/:id",
    requireUser,
    limit("listing-update", 60, HOUR, (req) => req.user.id),
    (req, res) => {
      const row = getListing(req.params.id);
      assertOwner(row, req.user);
      const patch = parse(patchListingSchema, req.body);
      if (!Object.keys(patch).length)
        throw new HttpError(400, "Choose a change to save.");
      const old = serializeListing(row, req.user.id);
      const input = parse(listingSchema, {
        title: old.title,
        description: old.description,
        address: old.address,
        lat: old.lat,
        lng: old.lng,
        price: old.price,
        deposit: old.deposit,
        originalPrice: old.originalPrice,
        bedrooms: old.bedrooms,
        bathrooms: old.bathrooms,
        roomType: old.roomType,
        genderPreference: old.genderPreference,
        availableFrom: old.availableFrom,
        availableTo: old.availableTo,
        amenities: old.amenities,
        photos: old.photos,
        status: old.status,
        ...patch,
      });
      enforceGenderPreference(input);
      if (input.status === "active" && row.status !== "active")
        requirePostingCampus(req);
      if (
        input.status === "active" &&
        row.status !== "active" &&
        !req.user.verified_at
      )
        throw new HttpError(
          403,
          "Verify your student email to publish. Your draft is safe until then.",
        );
      if (
        input.status === "active" &&
        row.status !== "active" &&
        !req.user.terms_accepted_at
      )
        throw new HttpError(
          403,
          "Please accept the Terms of Service and Privacy Policy before publishing.",
        );
      if (row.moderation_locked && input.status === "active")
        throw new HttpError(
          403,
          "Handoff has paused this listing after review. Contact support before publishing it again.",
        );
      validateListing(input);
      validatePhotos(input.photos, req.user.id);
      db.transaction(() => {
        db.prepare(
          `UPDATE listings SET title=?,description=?,address=?,lat=?,lng=?,price=?,deposit=?,original_price=?,bedrooms=?,bathrooms=?,room_type=?,gender_preference=?,available_from=?,available_to=?,amenities=?,photos=?,status=?,updated_at=? WHERE id=? AND owner_id=?`,
        ).run(
          input.title,
          input.description,
          input.address,
          input.lat,
          input.lng,
          input.price,
          input.deposit,
          input.originalPrice,
          input.bedrooms,
          input.bathrooms,
          input.roomType,
          input.genderPreference,
          input.availableFrom,
          input.availableTo,
          JSON.stringify(input.amenities),
          JSON.stringify(input.photos),
          input.status,
          iso(),
          row.id,
          req.user.id,
        );
        if (input.status !== "active" && input.status !== "draft") {
          db.prepare(
            "UPDATE handoff_requests SET status='declined',updated_at=? WHERE listing_id=? AND status='pending'",
          ).run(iso(), row.id);
        }
      })();
      res.json({ listing: serializeListing(getListing(row.id), req.user.id) });
    },
  );

  /* ------------------------------------------------------------- boost */

  const BOOST_DAYS = 7;
  /** One view per listing per student (or per address when signed out) per hour. */
  const countView = (row, req) => {
    if (!row || row.owner_id === req.user?.id) return;
    const viewerKey = req.user?.id || `ip:${req.ip || "unknown"}`;
    const now = iso();
    db.prepare(
      "INSERT OR IGNORE INTO listing_views(listing_id,viewer_key,hour,created_at) VALUES(?,?,?,?)",
    ).run(row.id, viewerKey, now.slice(0, 13), now);
  };
  const latestBoost = (listingId) =>
    db
      .prepare(
        "SELECT * FROM boosts WHERE listing_id=? ORDER BY starts_at DESC LIMIT 1",
      )
      .get(listingId);
  app.post(
    "/api/listings/:id/boost",
    requireVerified,
    limit("listing-boost", 20, HOUR, (req) => req.user.id),
    (req, res) => {
      const input = parse(boostSchema, req.body);
      const row = getListing(req.params.id);
      requirePostingCampus(req);
      assertOwner(row, req.user);
      if (input.kind === "paid")
        throw new HttpError(402, "Payments open soon.");
      if (row.status !== "active")
        throw new HttpError(
          400,
          "Publish this listing before you boost it, so students can see it.",
        );
      const now = iso();
      if (row.boost_until && row.boost_until > now)
        throw new HttpError(
          409,
          `This listing is already boosted until ${new Date(row.boost_until).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}.`,
        );
      if (
        db
          .prepare(
            "SELECT 1 FROM boosts WHERE listing_id=? AND kind='launch'",
          )
          .get(row.id)
      )
        throw new HttpError(
          409,
          "The free launch boost was already used on this listing.",
        );
      const endsAt = new Date(
        Date.now() + BOOST_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      db.transaction(() => {
        db.prepare(
          "INSERT INTO boosts(id,listing_id,user_id,kind,price_cents,starts_at,ends_at,created_at) VALUES(?,?,?,'launch',0,?,?,?)",
        ).run(randomUUID(), row.id, req.user.id, now, endsAt, now);
        db.prepare("UPDATE listings SET boost_until=? WHERE id=? AND owner_id=?").run(
          endsAt,
          row.id,
          req.user.id,
        );
      })();
      res.json({ listing: serializeListing(getListing(row.id), req.user.id) });
    },
  );
  app.get("/api/listings/:id/boost-stats", requireUser, (req, res) => {
    const row = getListing(req.params.id);
    assertOwner(row, req.user);
    const boost = latestBoost(row.id);
    const since = boost?.starts_at;
    const count = (sql, ...values) =>
      db.prepare(sql).get(...values)?.n || 0;
    res.json({
      views: since
        ? count(
            "SELECT COUNT(*) AS n FROM listing_views WHERE listing_id=? AND created_at>=?",
            row.id,
            since,
          )
        : 0,
      requests: since
        ? count(
            "SELECT COUNT(*) AS n FROM handoff_requests WHERE listing_id=? AND created_at>=?",
            row.id,
            since,
          )
        : 0,
      boostUntil: row.boost_until ?? null,
    });
  });

  const uploadAccounts = new Set();
  let uploadsInFlight = 0;
  const admitUpload = (req, res, next) => {
    if (uploadsInFlight >= 2 || uploadAccounts.has(req.user.id)) {
      res.set("Retry-After", "5");
      return next(
        new HttpError(
          429,
          "Photos are still uploading. Wait a moment and try again.",
        ),
      );
    }
    uploadsInFlight++;
    uploadAccounts.add(req.user.id);
    let released = false;
    req.releaseUpload = () => {
      if (released) return;
      released = true;
      uploadsInFlight--;
      uploadAccounts.delete(req.user.id);
    };
    // Once decoding starts, its finally block retains the slot even if the browser disconnects.
    req.once("aborted", () => {
      if (!req.uploadProcessing) req.releaseUpload();
    });
    res.once("finish", req.releaseUpload);
    res.once("close", () => {
      if (!req.uploadProcessing) req.releaseUpload();
    });
    next();
  };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 8, fileSize: 8 * 1024 * 1024, fields: 0, parts: 8 },
    fileFilter: (req, file, cb) => cb(null, true),
  });
  app.post(
    "/api/uploads",
    requireUser,
    limit("upload-hour", 20, HOUR, (req) => req.user.id),
    limit("upload-day", 80, 24 * HOUR, (req) => req.user.id),
    admitUpload,
    upload.array("photos", 8),
    async (req, res) => {
      req.uploadProcessing = true;
      try {
        if (!req.files?.length)
          throw new HttpError(400, "Choose at least one image.");
        const totalStored = db
          .prepare(
            "SELECT COALESCE(SUM(bytes),0) AS bytes FROM uploads WHERE owner_id=?",
          )
          .get(req.user.id).bytes;
        if (totalStored > 250 * 1024 * 1024)
          throw new HttpError(
            413,
            "Your photo storage is full. Contact Handoff for help.",
          );
        const images = [];
        for (const file of req.files) {
          let buffer;
          try {
            const decoder = sharp(file.buffer, {
              limitInputPixels: 24_000_000,
              animated: false,
              failOn: "warning",
            });
            const metadata = await decoder.metadata();
            if (
              !["jpeg", "png", "webp", "heif", "avif"].includes(
                metadata.format,
              ) ||
              (metadata.pages && metadata.pages > 1)
            )
              throw new Error("Unsupported image.");
            if (
              !metadata.width ||
              !metadata.height ||
              metadata.width < 100 ||
              metadata.height < 100
            )
              throw new Error("Image too small.");
            buffer = await decoder
              .rotate()
              .resize({
                width: 1800,
                height: 1800,
                fit: "inside",
                withoutEnlargement: true,
              })
              .webp({ quality: 84 })
              .toBuffer();
          } catch {
            throw new HttpError(
              400,
              "Use a valid JPG, PNG, WebP, or supported HEIC image between 100 by 100 pixels and 24 megapixels.",
            );
          }
          images.push({ id: randomUUID(), buffer });
        }
        const photos = images.map((item) => `/uploads/${item.id}.webp`);
        db.transaction(() => {
          const used = db
            .prepare(
              "SELECT COALESCE(SUM(bytes),0) AS bytes FROM uploads WHERE owner_id=?",
            )
            .get(req.user.id).bytes;
          if (
            used + images.reduce((sum, item) => sum + item.buffer.length, 0) >
            250 * 1024 * 1024
          )
            throw new HttpError(
              413,
              "Your photo storage is full. Contact Handoff for help.",
            );
          for (const item of images)
            db.prepare(
              "INSERT INTO uploads(id,owner_id,filename,bytes,created_at) VALUES(?,?,?,?,?)",
            ).run(
              item.id,
              req.user.id,
              `${item.id}.webp`,
              item.buffer.length,
              iso(),
            );
        })();
        // Reserve the quota before filesystem writes, so rejected uploads cannot accumulate untracked files.
        for (const item of images) {
          await writeFile(join(uploadDir, `${item.id}.webp`), item.buffer, {
            flag: "wx",
            mode: 0o600,
          });
        }
        res.status(201).json({ photos });
      } finally {
        req.releaseUpload();
      }
    },
  );
  /* ------------------------------------------------------- profile photo */
  /**
   * One optional square photo per student. It is stored beside the listing
   * photos, always re-encoded, and the previous file is removed as soon as a
   * new one is in place. Nothing about it is required.
   */
  const AVATAR_PATH = /^\/avatars\/[a-f0-9-]{36}\.jpg$/;
  const dropAvatarFile = async (path) => {
    if (!path || !AVATAR_PATH.test(path)) return;
    try {
      await unlink(join(uploadDir, path.slice("/avatars/".length)));
    } catch {
      /* Already gone. The row is what matters. */
    }
  };
  const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: 8 * 1024 * 1024, fields: 0, parts: 2 },
  });
  app.post(
    "/api/profile/avatar",
    requireUser,
    limit("avatar-hour", 20, HOUR, (req) => req.user.id),
    avatarUpload.single("avatar"),
    async (req, res) => {
      if (!req.file) throw new HttpError(400, "Choose a photo.");
      let buffer;
      try {
        const decoder = sharp(req.file.buffer, {
          limitInputPixels: 24_000_000,
          animated: false,
          failOn: "warning",
        });
        const metadata = await decoder.metadata();
        if (
          !["jpeg", "png", "webp"].includes(metadata.format) ||
          (metadata.pages && metadata.pages > 1)
        )
          throw new Error("Unsupported image.");
        if (
          !metadata.width ||
          !metadata.height ||
          metadata.width < 80 ||
          metadata.height < 80
        )
          throw new Error("Image too small.");
        buffer = await decoder
          .rotate()
          .resize({ width: 320, height: 320, fit: "cover", position: "centre" })
          .jpeg({ quality: 82 })
          .toBuffer();
      } catch {
        throw new HttpError(
          400,
          "Use a JPG, PNG or WebP photo at least 80 by 80 pixels.",
        );
      }
      const filename = `${randomUUID()}.jpg`;
      await writeFile(join(uploadDir, filename), buffer, {
        flag: "wx",
        mode: 0o600,
      });
      const previous = req.user.avatar;
      db.prepare("UPDATE users SET avatar=?,updated_at=? WHERE id=?").run(
        `/avatars/${filename}`,
        iso(),
        req.user.id,
      );
      await dropAvatarFile(previous);
      res.status(201).json({
        user: serializeUser(
          db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id),
        ),
      });
    },
  );
  app.delete("/api/profile/avatar", requireUser, async (req, res) => {
    const previous = req.user.avatar;
    db.prepare("UPDATE users SET avatar=NULL,updated_at=? WHERE id=?").run(
      iso(),
      req.user.id,
    );
    await dropAvatarFile(previous);
    res.json({
      user: serializeUser(
        db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id),
      ),
    });
  });
  app.get("/avatars/:filename", (req, res) => {
    if (!/^[a-f0-9-]{36}\.jpg$/.test(req.params.filename))
      throw new HttpError(404, "Photo not found.");
    const path = `/avatars/${req.params.filename}`;
    const owner = db.prepare("SELECT 1 FROM users WHERE avatar=?").get(path);
    if (!owner) throw new HttpError(404, "Photo not found.");
    // A profile photo only ever appears beside a name that is already shown,
    // and the name is unguessable, so it caches like a listing photo.
    res.set("Cache-Control", "public, max-age=3600");
    res.type("image/jpeg").sendFile(join(uploadDir, req.params.filename));
  });

  // Smart import. The model reads a pasted post, screenshots or a PDF and
  // fills the wizard for the lister. Nothing here publishes anything: the
  // answer is a draft the student reviews step by step, and the usual listing
  // validation still runs when they save.
  const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 5, fileSize: 8 * 1024 * 1024, fields: 4, parts: 9 },
  });
  // Listing is the thing a live campus unlocks, and a missing key is a normal
  // state, so both are answered before any file is buffered.
  const requireAi = async (req, res, next) => {
    try {
      requirePostingCampus(req);
      req.aiClient = await aiClient();
      if (!req.aiClient && !mockEnabled())
        return res
          .status(503)
          .json({
            error: "Smart import is being set up.",
            code: "ai_unavailable",
          });
      next();
    } catch (error) {
      next(error);
    }
  };
  const aiRoute = (handler) => async (req, res, next) => {
    try {
      const campus = CAMPUSES.find((c) => c.id === req.user.campus_id);
      await handler(req, res, { client: req.aiClient, campus });
    } catch (error) {
      if (error instanceof AiInputError)
        return next(new HttpError(400, error.message));
      if (error instanceof AiUnavailableError)
        return next(
          new HttpError(
            502,
            "Smart import could not read that. Try again, or fill the form in yourself.",
          ),
        );
      next(error);
    }
  };
  const recordUsage = (userId, kind, usage) => {
    try {
      db.prepare(
        "INSERT INTO ai_usage(id,user_id,kind,input_tokens,output_tokens,model,created_at) VALUES(?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        userId,
        kind,
        Number(usage?.inputTokens || 0),
        Number(usage?.outputTokens || 0),
        String(usage?.model || ""),
        iso(),
      );
    } catch {
      // Accounting must never fail the student's import.
    }
  };
  app.post(
    "/api/import/parse",
    requireVerified,
    limit("import-user", 20, HOUR, (req) => req.user.id),
    requireAi,
    importUpload.array("files", 5),
    aiRoute(async (req, res, { client, campus }) => {
      const result = await parseListing({
        text: String(req.body?.text || ""),
        files: req.files || [],
        campus,
        client,
      });
      recordUsage(req.user.id, "parse", result.usage);
      res.json({
        draft: result.draft,
        missing: result.missing,
        notes: result.notes,
      });
    }),
  );
  app.post(
    "/api/import/chat",
    requireVerified,
    limit("import-chat-user", 120, HOUR, (req) => req.user.id),
    requireAi,
    aiRoute(async (req, res, { client, campus }) => {
      const input = parse(importChatSchema, req.body ?? {});
      const result = await chatListing({
        messages: input.messages,
        draft: input.draft,
        campus,
        client,
      });
      recordUsage(req.user.id, "chat", result.usage);
      res.json({
        reply: result.reply,
        draft: result.draft,
        missing: result.missing,
        done: result.done,
      });
    }),
  );
  app.get("/uploads/:filename", (req, res) => {
    if (!/^[a-f0-9-]{36}\.webp$/.test(req.params.filename))
      throw new HttpError(404, "Photo not found.");
    const found = db
      .prepare("SELECT * FROM uploads WHERE filename=?")
      .get(req.params.filename);
    if (!found) throw new HttpError(404, "Photo not found.");
    const publicPhoto = db
      .prepare(
        "SELECT 1 FROM listings l, json_each(l.photos) p WHERE p.value=? AND l.status='active' AND l.available_to>=? LIMIT 1",
      )
      .get(`/uploads/${found.filename}`, today());
    const participant =
      req.user &&
      db
        .prepare(
          "SELECT 1 FROM handoff_requests r JOIN listings l ON l.id=r.listing_id, json_each(l.photos) p WHERE p.value=? AND r.requester_id=? AND r.status='accepted' LIMIT 1",
        )
        .get(`/uploads/${found.filename}`, req.user.id);
    if (found.owner_id !== req.user?.id && !publicPhoto && !participant)
      throw new HttpError(404, "Photo not found.");
    res.set(
      "Cache-Control",
      publicPhoto ? "public, max-age=3600" : "private, no-store",
    );
    res.type("image/webp").sendFile(join(uploadDir, found.filename));
  });

  app.get("/api/saved", requireUser, (req, res) => {
    const rows = db
      .prepare(
        `SELECT ${listingFields} FROM ${listingJoin} JOIN saved_listings s ON s.listing_id=l.id WHERE s.user_id=? AND l.status='active' AND l.available_to>=? ORDER BY s.created_at DESC`,
      )
      .all(req.user.id, today());
    res.json({
      listings: rows.map((row) => serializeListing(row, req.user.id)),
    });
  });
  app.post(
    "/api/saved/:listingId",
    requireUser,
    limit("saved", 120, HOUR, (req) => req.user.id),
    (req, res) => {
      assertPublic(getListing(req.params.listingId));
      db.prepare(
        "INSERT OR IGNORE INTO saved_listings(user_id,listing_id,created_at) VALUES(?,?,?)",
      ).run(req.user.id, req.params.listingId, iso());
      res.json({ saved: true });
    },
  );
  app.delete("/api/saved/:listingId", requireUser, (req, res) => {
    db.prepare(
      "DELETE FROM saved_listings WHERE user_id=? AND listing_id=?",
    ).run(req.user.id, req.params.listingId);
    res.json({ saved: false });
  });

  // This query intentionally excludes email. Contacts are fetched only after authorization and acceptance.
  const requestSelect = `SELECT r.*,l.title AS listing_title,l.photos AS listing_photos,l.owner_id,l.status AS listing_status,l.available_to,requester.name AS requester_name,requester.avatar AS requester_avatar,requester.gender AS requester_gender,owner.name AS owner_name,owner.avatar AS owner_avatar FROM handoff_requests r JOIN listings l ON l.id=r.listing_id JOIN users requester ON requester.id=r.requester_id JOIN users owner ON owner.id=l.owner_id`;
  const getRequest = (id) =>
    db.prepare(`${requestSelect} WHERE r.id=?`).get(id);
  const serializeRequest = (row, viewerId) => {
    if (![row.owner_id, row.requester_id].includes(viewerId))
      throw new HttpError(404, "Request not found.");
    const result = {
      id: row.id,
      listingId: row.listing_id,
      listingTitle: row.listing_title,
      listingPhoto: JSON.parse(row.listing_photos)[0] || "",
      requesterId: row.requester_id,
      requesterName: row.requester_name,
      requesterAvatar: row.requester_avatar || null,
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      ownerAvatar: row.owner_avatar || null,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    // The lister sees how the requester described themselves, but only when
    // the student chose to share it.
    if (
      viewerId === row.owner_id &&
      row.requester_gender &&
      row.requester_gender !== "unspecified"
    )
      result.requesterGender = row.requester_gender;
    if (row.status === "accepted") {
      const person = db
        .prepare("SELECT name,email FROM users WHERE id=?")
        .get(viewerId === row.owner_id ? row.requester_id : row.owner_id);
      result.contact = { name: person.name, email: person.email };
    }
    return result;
  };
  const notifyRequest = async (row, event, actorId) => {
    const recipientId =
      event === "created"
        ? row.owner_id
        : actorId === row.owner_id
          ? row.requester_id
          : row.owner_id;
    const recipient = db
      .prepare("SELECT email FROM users WHERE id=?")
      .get(recipientId);
    const title =
      event === "created"
        ? "A student is interested in your place"
        : `Your Handoff request was ${event}`;
    const link = `${origin}/requests`;
    try {
      await sendMail(
        recipient.email,
        title,
        `${title}\n\n${row.listing_title}\n\nOpen Handoff to see the request and next steps: ${link}`,
        `<p>${escapeHtml(title)}</p><p>${escapeHtml(row.listing_title)}</p><p><a href="${link}">View request and next steps</a></p>`,
      );
      return { emailSent: true };
    } catch {
      // Durable requests remain visible in the app even when SMTP is unavailable.
      return { emailSent: false };
    }
  };
  app.get("/api/requests", requireUser, (req, res) => {
    const rows = db
      .prepare(
        `${requestSelect} WHERE l.owner_id=? OR r.requester_id=? ORDER BY r.updated_at DESC`,
      )
      .all(req.user.id, req.user.id);
    res.json({
      incoming: rows
        .filter((row) => row.owner_id === req.user.id)
        .map((row) => serializeRequest(row, req.user.id)),
      outgoing: rows
        .filter((row) => row.requester_id === req.user.id)
        .map((row) => serializeRequest(row, req.user.id)),
    });
  });
  app.post(
    "/api/requests",
    requireVerified,
    requireTerms,
    limit("request-create", 15, HOUR, (req) => req.user.id),
    async (req, res) => {
      const input = parse(requestSchema, req.body);
      const listing = getListing(input.listingId);
      assertPublic(listing);
      if (listing.owner_id === req.user.id)
        throw new HttpError(400, "You cannot request your own listing.");
      const id = randomUUID();
      const timestamp = iso();
      try {
        db.prepare(
          "INSERT INTO handoff_requests(id,listing_id,requester_id,message,status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?)",
        ).run(id, listing.id, req.user.id, input.message, timestamp, timestamp);
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE")
          throw new HttpError(
            409,
            "You already have an active request for this listing.",
          );
        throw error;
      }
      const row = getRequest(id);
      const notification = await notifyRequest(row, "created", req.user.id);
      res
        .status(201)
        .json({ request: serializeRequest(row, req.user.id), notification });
    },
  );
  app.patch(
    "/api/requests/:id",
    requireVerified,
    limit("request-update", 60, HOUR, (req) => req.user.id),
    async (req, res) => {
      const input = parse(requestUpdateSchema, req.body);
      const updated = db.transaction(() => {
        const row = getRequest(req.params.id);
        if (!row || ![row.owner_id, row.requester_id].includes(req.user.id))
          throw new HttpError(404, "Request not found.");
        if (row.status !== "pending")
          throw new HttpError(409, "This request has already been resolved.");
        if (
          input.status === "withdrawn"
            ? req.user.id !== row.requester_id
            : req.user.id !== row.owner_id
        )
          throw new HttpError(
            403,
            "You cannot make this change to the request.",
          );
        if (
          input.status === "accepted" &&
          (row.listing_status !== "active" || row.available_to < today())
        )
          throw new HttpError(
            409,
            "This listing is no longer available. Update the listing before accepting.",
          );
        db.prepare(
          "UPDATE handoff_requests SET status=?,updated_at=? WHERE id=?",
        ).run(input.status, iso(), row.id);
        return getRequest(row.id);
      })();
      const notification = await notifyRequest(
        updated,
        input.status,
        req.user.id,
      );
      res.json({
        request: serializeRequest(updated, req.user.id),
        notification,
      });
    },
  );
  app.post(
    "/api/reports",
    requireVerified,
    limit("reports", 10, 24 * HOUR, (req) => req.user.id),
    (req, res) => {
      const input = parse(reportSchema, req.body);
      assertPublic(getListing(input.listingId));
      const recent = db
        .prepare(
          "SELECT 1 FROM reports WHERE listing_id=? AND reporter_id=? AND created_at>?",
        )
        .get(
          input.listingId,
          req.user.id,
          new Date(Date.now() - 24 * HOUR).toISOString(),
        );
      if (recent)
        throw new HttpError(
          409,
          "You have already reported this listing. Our team can review your report.",
        );
      db.prepare(
        "INSERT INTO reports(id,listing_id,reporter_id,reason,details,created_at) VALUES(?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        input.listingId,
        req.user.id,
        input.reason,
        input.details,
        iso(),
      );
      res.status(201).json({ ok: true });
    },
  );

  // The dashboard lives on the internal host only. On the app host the whole
  // tree answers 404, exactly as it does for a student.
  app.use("/api/admin", (req, res, next) =>
    req.surface === "internal"
      ? next()
      : next(new HttpError(404, "Endpoint not found.")),
  );
  app.use(
    "/api/admin",
    adminRouter({ db, limit, dataDir, staticDir, emailReady, isAllowedAdmin }),
  );

  app.use("/api", (req, res, next) =>
    next(new HttpError(404, "Endpoint not found.")),
  );
  app.get("/robots.txt", (req, res, next) => {
    if (req.surface !== "internal") return next();
    res
      .type("text/plain")
      .set("Cache-Control", "no-cache")
      .send("User-agent: *\nDisallow: /\n");
  });
  if (existsSync(join(staticDir, "index.html"))) {
    app.use(
      express.static(staticDir, {
        index: false,
        maxAge: "1h",
        dotfiles: "deny",
        setHeaders: (res, path) => {
          if (path.includes("/assets/"))
            res.set("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    );
    // The internal host gets the same bundle with one extra meta tag. That tag
    // is what the SPA reads to mount the dashboard at / instead of the app.
    let internalDocument;
    const internalIndex = () => {
      if (internalDocument === undefined)
        internalDocument = readFileSync(
          join(staticDir, "index.html"),
          "utf8",
        ).replace(
          /<head>/i,
          '<head><meta name="handoff-surface" content="internal"/>',
        );
      return internalDocument;
    };
    app.get("/{*path}", (req, res) => {
      if (req.path.startsWith("/uploads/") || /\.[a-z0-9]+$/i.test(req.path))
        return res.status(404).send("Not found");
      res.set("Cache-Control", "no-cache");
      if (req.surface === "internal")
        return res.type("html").send(internalIndex());
      res.sendFile(join(staticDir, "index.html"));
    });
  }
  app.use((err, req, res, next) => {
    if (req.aborted) return;
    if (res.headersSent) return next(err);
    if (err instanceof multer.MulterError)
      return res
        .status(400)
        .json({
          error:
            err.code === "LIMIT_FILE_SIZE"
              ? "Each photo must be 8 MB or smaller."
              : "Upload up to eight photos using the photos field.",
        });
    if (err instanceof HttpError)
      return res
        .status(err.status)
        .json(
          err.code
            ? { error: err.message, code: err.code }
            : { error: err.message },
        );
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "This request is too large." });
    if (err instanceof SyntaxError && err.status === 400)
      return res.status(400).json({ error: "Invalid JSON request." });
    if (err.code === "ENOENT")
      return res.status(404).json({ error: "File not found." });
    console.error("Handoff request failed", {
      code: err.code || "internal",
      method: req.method,
      path: req.route?.path || "unknown",
    });
    res
      .status(500)
      .json({
        error: "Handoff could not complete this action. Please try again.",
      });
  });
  // Bound expired authentication housekeeping; live sessions and unconsumed links are never removed.
  db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
  db.prepare("DELETE FROM rate_limits WHERE expires_at<=?").run(Date.now());
  return app;
}
