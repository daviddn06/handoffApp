#!/usr/bin/env node
/** Filesystem-authorized operator import. All referral writes still pass through the internal admin API. */
import Database from "better-sqlite3";
import { open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { adminAllowList } from "../server/admin.js";
import { canonicalSourceUrl, encodeReferralPhoto } from "../server/referrals.js";
import { hashToken, randomToken } from "../server/security.js";

const APP_ORIGIN = "https://app.handofflease.com";
const INTERNAL_ORIGIN = "https://internal.handofflease.com";
const FIVE_MINUTES = 5 * 60_000;
const MAX_FILE = 8 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
class ImportError extends Error {}
const fail = (message) => { throw new ImportError(message); };
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

async function boundedRead(path, maxBytes) {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) fail("An input file is empty, not regular, or exceeds its size limit.");
    // Reading at most limit + 1 also bounds a file that grows after stat.
    const bytes = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total !== stat.size) fail("An input file changed during the import. Review it and retry.");
    return bytes.subarray(0, total);
  } finally { await handle.close(); }
}

function eligibleAdmin(db, email, allowList) {
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!user || !user.is_admin || user.disabled_at || !user.verified_at || user.campus_id !== "usc" || !/(?:^|\.)usc\.edu$/.test(user.email.split("@")[1] || "") || !allowList.has(user.email.toLowerCase())) {
    fail("The selected account must already be an active, verified USC admin on HANDOFF_ADMIN_EMAILS.");
  }
  return user;
}

async function prepareBatch(batchPath, signal) {
  const location = await realpath(batchPath);
  const base = dirname(location);
  let batch;
  try { batch = JSON.parse((await boundedRead(location, 2 * 1024 * 1024)).toString("utf8")); }
  catch (error) { if (error instanceof ImportError) throw error; fail("The batch must be a readable JSON file."); }
  if (!object(batch) || Object.keys(batch).some((key) => !["reviewed", "referrals"].includes(key)) || batch.reviewed !== true || !Array.isArray(batch.referrals) || batch.referrals.length < 1 || batch.referrals.length > 20) {
    fail("Use a reviewed batch with 1 to 20 referrals. See scripts/README.md.");
  }
  const prepared = [];
  for (const [index, entry] of batch.referrals.entries()) {
    signal.throwIfAborted();
    if (!object(entry) || !Array.isArray(entry.photos) || entry.photos.length > 16) fail(`Entry ${index + 1} must include a photos array with at most sixteen local files.`);
    const { photos, ...payload } = entry;
    // The server remains authoritative for every source, evidence, and listing field.
    try { canonicalSourceUrl(payload.sourceUrl); }
    catch { fail(`Entry ${index + 1} needs a valid public HTTPS source URL.`); }
    if (Buffer.byteLength(JSON.stringify(payload)) > 96 * 1024) fail(`Entry ${index + 1} exceeds the API payload limit.`);
    const sources = [], seen = new Set();
    for (const photo of photos) {
      signal.throwIfAborted();
      if (typeof photo !== "string" || !photo || isAbsolute(photo) || photo.includes("\0")) fail(`Entry ${index + 1} photo paths must be relative to the batch folder.`);
      const path = await realpath(resolve(base, photo));
      const inside = relative(base, path);
      if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) fail(`Entry ${index + 1} has a photo outside the batch folder.`);
      const bytes = await boundedRead(path, MAX_FILE);
      let encoded;
      try { encoded = await encodeReferralPhoto(bytes); }
      catch { fail(`Entry ${index + 1} has an unsupported or invalid photo.`); }
      const hash = hashToken(encoded);
      if (seen.has(hash)) continue;
      seen.add(hash);
      sources.push({ path, inputHash: hashToken(bytes), encodedHash: hash });
    }
    prepared.push({ payload, photos: sources });
  }
  return prepared;
}

/** fetchImpl is a test seam. The CLI always uses native HTTPS fetch with redirects forbidden. */
export async function importReferrals({ adminEmail, batchPath, env = process.env, fetchImpl = fetch, signal = new AbortController().signal }) {
  const email = String(adminEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || !batchPath || !isAbsolute(batchPath)) fail("Provide --admin-email and an absolute --batch path.");
  if ((env.HANDOFF_ORIGIN || APP_ORIGIN) !== APP_ORIGIN || (env.HANDOFF_INTERNAL_ORIGIN || INTERNAL_ORIGIN) !== INTERNAL_ORIGIN) fail("This operator script only calls the configured production Handoff app and internal HTTPS origins.");
  if (!env.HANDOFF_DATA_DIR || !isAbsolute(env.HANDOFF_DATA_DIR)) fail("Set HANDOFF_DATA_DIR to the existing absolute production data directory.");
  const dataDir = await realpath(env.HANDOFF_DATA_DIR);
  const allowList = adminAllowList(env);
  const budgetSignal = AbortSignal.any([signal, AbortSignal.timeout(FIVE_MINUTES)]);
  let db, lock, sessionHash;
  const lockPath = join(dataDir, ".referral-import.lock");
  try {
    db = new Database(join(dataDir, "handoff.sqlite"), { fileMustExist: true });
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    if (db.pragma("user_version", { simple: true }) !== 13) fail("Run this importer only against its matching deployed schema 13 release.");
    eligibleAdmin(db, email, allowList);
    try { lock = await open(lockPath, "wx", 0o600); }
    catch (error) { if (error.code === "EEXIST") fail("Another import holds the local lock. If a previous process was killed, review the stale lock before removing it."); throw error; }
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const batch = await prepareBatch(batchPath, budgetSignal);
    const token = randomToken();
    sessionHash = hashToken(token);
    db.transaction(() => {
      const admin = eligibleAdmin(db, email, allowList);
      db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)").run(sessionHash, admin.id, Date.now(), Date.now() + FIVE_MINUTES);
    })();
    async function request(path, { method = "GET", body, duplicate = false } = {}) {
      budgetSignal.throwIfAborted();
      eligibleAdmin(db, email, allowList);
      if (!/^\/api\/admin\/referrals(?:\/[a-f0-9-]{36}(?:\/photos)?)?$/.test(path)) fail("Refusing an unexpected API route.");
      const form = body instanceof FormData;
      let response;
      try {
        response = await fetchImpl(INTERNAL_ORIGIN + path, {
          method, redirect: "error", referrerPolicy: "no-referrer",
          signal: AbortSignal.any([budgetSignal, AbortSignal.timeout(30_000)]),
          headers: { Cookie: `__Host-handoff_session=${token}`, Origin: INTERNAL_ORIGIN, ...(body && !form ? { "Content-Type": "application/json" } : {}) },
          body: body === undefined ? undefined : form ? body : JSON.stringify(body),
        });
      } catch { fail("The internal API request failed or timed out. Partial imports can be safely retried."); }
      // Errors deliberately omit source details, cookies, environment values, and response bodies.
      if (!response.ok && !(duplicate && response.status === 409)) {
        await response.body?.cancel();
        fail(`The internal API rejected an import request (HTTP ${response.status}). Review the batch and retry.`);
      }
      let payload;
      try { payload = await response.json(); }
      catch { fail("The internal API returned an unexpected response."); }
      return { status: response.status, payload };
    }
    const results = [];
    for (const [index, entry] of batch.entries()) {
      const created = await request("/api/admin/referrals", { method: "POST", body: entry.payload, duplicate: true });
      let referral = created.payload.referral;
      if (created.status === 409) {
        if (!UUID.test(created.payload.referralId || "")) fail(`Entry ${index + 1} could not resolve its existing source.`);
        referral = (await request(`/api/admin/referrals/${created.payload.referralId}`)).payload.referral;
      }
      if (!UUID.test(referral?.id || "")) fail("The internal API returned an invalid referral identifier.");
      // Ensure the API is using this exact database before associating local file hashes with its response.
      const stored = db.prepare("SELECT id,token,source_key,status FROM referrals WHERE id=?").get(referral.id);
      if (!stored || stored.source_key !== hashToken(canonicalSourceUrl(entry.payload.sourceUrl)) || referral.link !== `${APP_ORIGIN}/referral/${stored.token}`) fail("The internal API and local data directory do not match.");
      const existing = db.prepare("SELECT filename FROM referral_photos WHERE referral_id=?").all(referral.id);
      const hashes = new Set();
      for (const photo of existing) {
        if (!/^[a-f0-9-]{36}\.webp$/.test(photo.filename)) fail("The private photo registry contains an unexpected filename.");
        hashes.add(hashToken(await boundedRead(join(dataDir, "uploads", "referrals", photo.filename), MAX_FILE)));
      }
      const missing = entry.photos.filter((photo) => !hashes.has(photo.encodedHash));
      if (missing.length) {
        if (stored.status !== "pending") fail(`Entry ${index + 1} has been claimed or revoked. Its photos were left unchanged.`);
        if (existing.length + missing.length > 16) fail(`Entry ${index + 1} would exceed sixteen photos. Its existing photos were preserved.`);
        const form = new FormData();
        for (const [number, photo] of missing.entries()) {
          const bytes = await boundedRead(photo.path, MAX_FILE);
          if (hashToken(bytes) !== photo.inputHash) fail(`Entry ${index + 1} has a photo that changed after review.`);
          form.append("photos", new Blob([bytes], { type: "application/octet-stream" }), `source-${number + 1}.photo`);
        }
        referral = (await request(`/api/admin/referrals/${referral.id}/photos`, { method: "POST", body: form })).payload.referral;
      }
      if (!Array.isArray(referral.photos) || referral.link !== `${APP_ORIGIN}/referral/${stored.token}` || typeof referral.outreachStatus !== "string") fail("The internal API returned unexpected referral metadata.");
      results.push({ id: referral.id, link: referral.link, photoCount: referral.photos.length, outreachStatus: referral.outreachStatus });
    }
    return results;
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (budgetSignal.aborted) fail("The import was interrupted or reached its five-minute limit. Partial imports can be safely retried.");
    fail("The import could not read its reviewed input or existing Handoff data. Check paths and permissions; partial imports can be retried.");
  } finally {
    try { if (db && sessionHash) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sessionHash); }
    finally {
      db?.close();
      if (lock) { await lock.close(); await unlink(lockPath); }
    }
  }
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (direct) {
  process.umask(0o077);
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || !args.includes("--admin-email") || !args.includes("--batch")) fail("Usage: node --env-file=/etc/handoff/app.env scripts/import-referrals.js --admin-email EXISTING_ADMIN --batch /absolute/reviewed.json");
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      if (!["--admin-email", "--batch"].includes(args[index]) || args[index + 1].startsWith("--")) fail("Provide exactly --admin-email and --batch.");
      options[args[index] === "--admin-email" ? "adminEmail" : "batchPath"] = args[index + 1];
    }
    const results = await importReferrals({ ...options, signal: abort.signal });
    process.stdout.write(`${JSON.stringify(results)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof ImportError ? error.message : "Import cleanup failed. Check the operator session expiry and local import lock before retrying."}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
