import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_SALT = "handoff-constant-time-invalid-account";

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

export async function checkPassword(password, stored) {
  const [algorithm, salt, expected] = (stored || "").split("$");
  const valid =
    algorithm === "scrypt" &&
    /^[a-f0-9]{32}$/.test(salt || "") &&
    /^[a-f0-9]{128}$/.test(expected || "");
  const actual = await scrypt(
    password,
    valid ? salt : DUMMY_SALT,
    64,
    SCRYPT_OPTIONS,
  );
  return valid && timingSafeEqual(actual, Buffer.from(expected, "hex"));
}

export function cookies(header = "") {
  const result = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0) {
      try {
        result[part.slice(0, index).trim()] = decodeURIComponent(
          part.slice(index + 1).trim(),
        );
      } catch {
        /* Ignore malformed cookies. */
      }
    }
  }
  return result;
}

export class HttpError extends Error {
  /** code is an optional stable identifier the client can branch on. */
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

export function rateLimiter(db) {
  const increment = db.transaction((bucket, maximum, milliseconds) => {
    const now = Date.now();
    const row = db
      .prepare("SELECT count, expires_at FROM rate_limits WHERE bucket = ?")
      .get(bucket);
    if (!row || row.expires_at <= now) {
      db.prepare(
        "INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=1,expires_at=excluded.expires_at",
      ).run(bucket, now + milliseconds);
      return { allowed: true, retryAfter: 0 };
    }
    if (row.count >= maximum)
      return {
        allowed: false,
        retryAfter: Math.ceil((row.expires_at - now) / 1000),
      };
    db.prepare("UPDATE rate_limits SET count=count+1 WHERE bucket=?").run(
      bucket,
    );
    return { allowed: true, retryAfter: 0 };
  });
  return (scope, maximum, milliseconds, identity = (req) => req.ip) =>
    (req, res, next) => {
      const bucket = hashToken(`${scope}:${identity(req)}`);
      const result = increment(bucket, maximum, milliseconds);
      if (!result.allowed) {
        res.set("Retry-After", String(result.retryAfter));
        return next(
          new HttpError(429, "Too many attempts. Please wait and try again."),
        );
      }
      next();
    };
}
