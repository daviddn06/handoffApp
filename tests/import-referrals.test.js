import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import { importReferrals } from "../scripts/import-referrals.js";

const ORIGIN = "https://app.handofflease.com";
const INTERNAL = "https://internal.handofflease.com";
const EMAIL = "operator@usc.edu";
process.env.HANDOFF_ADMIN_EMAILS = EMAIL;
const referral = (patch = {}) => ({
  sourceUrl: "https://www.facebook.com/groups/usc-housing/posts/123456789/",
  sourceName: "Reviewed source fixture", authorName: "Test Source", authorProfileUrl: "https://www.facebook.com/source.fixture",
  sourceText: "I am a USC student subleasing my furnished room near campus for the semester.",
  evidence: { student: "USC student", usc: "USC", sublease: "subleasing my furnished room" },
  listing: { title: "Furnished room near campus", price: 1200 },
  outreachStatus: "draft", outreachNotes: "Test fixture only", outreachDraft: "Private draft review link: {{link}}", photos: ["actual-photo.jpg"], ...patch,
});

async function fixture(t, userPatch = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "handoff-operator-test-"));
  const batchDir = join(dataDir, "batch");
  await mkdir(batchDir);
  const batchPath = join(batchDir, "reviewed.json");
  const messages = [];
  const app = createApp({ dataDir, origin: ORIGIN, mailTransport: { sendMail: async (message) => { messages.push(message); return { accepted: [message.to] }; } } });
  const db = app.locals.db;
  const id = randomUUID(), timestamp = new Date().toISOString();
  const values = { email: EMAIL, campus: "usc", verified: timestamp, disabled: null, admin: 1, ...userPatch };
  db.prepare("INSERT INTO users(id,name,email,campus_id,school_domain,school_name,password_hash,verified_at,is_admin,disabled_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id, "Existing Operator", values.email, values.campus, values.email.split("@")[1], "USC", "Unchanged fixture password", values.verified, values.admin, values.disabled, timestamp, timestamp);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); app.locals.close(); await rm(dataDir, { recursive: true, force: true }); });
  const photo = await sharp({ create: { width: 300, height: 240, channels: 3, background: "#6497bb" } }).jpeg().withMetadata({ exif: { IFD0: { Artist: "Private fixture metadata" } } }).toBuffer();
  await writeFile(join(batchDir, "actual-photo.jpg"), photo);
  const batch = async (entries = [referral()], reviewed = true) => writeFile(batchPath, JSON.stringify({ reviewed, referrals: entries }));
  await batch();
  const requests = [];
  const env = { HANDOFF_DATA_DIR: dataDir, HANDOFF_ORIGIN: ORIGIN, HANDOFF_INTERNAL_ORIGIN: INTERNAL, HANDOFF_ADMIN_EMAILS: EMAIL };
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, INTERNAL);
    assert.equal(options.redirect, "error");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.headers.Origin, INTERNAL);
    assert.match(options.headers.Cookie, /^__Host-handoff_session=[A-Za-z0-9_-]{43}$/);
    const session = db.prepare("SELECT * FROM sessions").get();
    assert.equal(session.user_id, id);
    assert.equal(session.expires_at - session.created_at, 300_000);
    requests.push({ path: new URL(url).pathname, method: options.method });
    return fetch(local + new URL(url).pathname, { ...options, headers: { ...options.headers, Host: "internal.handofflease.com", "X-Handoff-Surface": "internal" } });
  };
  const run = (extra = {}) => importReferrals({ adminEmail: EMAIL, batchPath, env, fetchImpl, ...extra });
  return { app, db, dataDir, batchDir, batchPath, batch, run, env, fetchImpl, requests, messages, id };
}

test("operator imports through protected API and reruns deduplicate canonical source and exact photos", async (t) => {
  const f = await fixture(t);
  await f.batch([referral({ photos: ["actual-photo.jpg", "actual-photo.jpg"] })]);
  const originalUsers = f.db.prepare("SELECT * FROM users").all();
  const first = await f.run();
  assert.equal(first.length, 1);
  assert.deepEqual(Object.keys(first[0]).sort(), ["id", "link", "outreachStatus", "photoCount"]);
  assert.equal(first[0].photoCount, 1);
  assert.equal(first[0].outreachStatus, "draft");
  assert.match(first[0].link, /^https:\/\/app\.handofflease\.com\/referral\/[A-Za-z0-9_-]{43}$/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
  const stored = f.db.prepare("SELECT * FROM referrals").get();
  assert.equal(stored.status, "pending");
  assert.equal(stored.claimed_by, null);
  assert.deepEqual(JSON.parse(stored.listing_data), { title: "Furnished room near campus", price: 1200 });
  assert.ok(stored.outreach_draft.includes(first[0].link));
  await f.batch([referral({ sourceUrl: "https://m.facebook.com/groups/usc-housing/permalink/123456789/?ref=share", outreachStatus: "ready" })]);
  const second = await f.run();
  assert.deepEqual(second, first, "Reruns preserve the existing link and outreach state");
  assert.equal(f.requests.filter((entry) => entry.path.endsWith("/photos")).length, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM referral_photos").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM referrals").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM listings").get().n, 0);
  assert.deepEqual(f.db.prepare("SELECT * FROM users").all(), originalUsers);
  assert.equal(f.messages.length, 0);
  const photo = f.db.prepare("SELECT filename FROM referral_photos").get();
  const metadata = await sharp(await readFile(join(f.dataDir, "uploads", "referrals", photo.filename))).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  assert.equal((await readdir(f.dataDir)).includes(".referral-import.lock"), false);
});

test("import rejects non-admin, unverified, disabled, unlisted, non-USC and nonexistent operators without creating a session", async (t) => {
  for (const patch of [{ admin: 0 }, { verified: null }, { disabled: new Date().toISOString() }, { campus: null }, { email: "operator@ucla.edu", campus: "usc" }, { email: "unlisted@usc.edu" }]) {
    await t.test(JSON.stringify(patch), async (sub) => {
      const f = await fixture(sub, patch);
      await assert.rejects(f.run({ adminEmail: patch.email || EMAIL }), /already be an active, verified USC admin/);
      assert.equal(f.requests.length, 0);
      assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
      assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM referrals").get().n, 0);
    });
  }
});

test("import pins HTTPS origins, reviewed batch size and local photo boundaries before network access", async (t) => {
  const f = await fixture(t);
  for (const origin of ["http://internal.handofflease.com", "https://internal.handofflease.com/", "https://internal.handofflease.com.attacker.test", "https://attacker.test"]) {
    await assert.rejects(f.run({ env: { ...f.env, HANDOFF_INTERNAL_ORIGIN: origin } }), /only calls the configured/);
  }
  await assert.rejects(f.run({ env: { ...f.env, HANDOFF_ORIGIN: "https://elsewhere.test" } }), /only calls the configured/);
  await f.batch([referral()], false);
  await assert.rejects(f.run(), /reviewed batch/);
  await f.batch(Array.from({ length: 21 }, () => referral()));
  await assert.rejects(f.run(), /1 to 20/);
  const outside = join(f.dataDir, "outside.jpg");
  await writeFile(outside, await readFile(join(f.batchDir, "actual-photo.jpg")));
  await symlink(outside, join(f.batchDir, "escape.jpg"));
  for (const photo of [outside, "../outside.jpg", "escape.jpg"]) {
    await f.batch([referral({ photos: [photo] })]);
    await assert.rejects(f.run(), /relative to the batch folder|outside the batch folder/);
  }
  await f.batch([referral({ photos: ["invalid.svg"] })]);
  await writeFile(join(f.batchDir, "invalid.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"></svg>');
  await assert.rejects(f.run(), /invalid photo/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
});

test("API evidence validation still rejects invented referrals and cleanup also runs after a network failure", async (t) => {
  const f = await fixture(t);
  await f.batch([referral({ evidence: { student: "a student", usc: "USC", sublease: "a normal rental" } })]);
  await assert.rejects(f.run(), /HTTP 400/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM referrals").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
  await f.batch();
  await assert.rejects(f.run({ fetchImpl: async () => { throw new Error("This deliberately sensitive implementation error must not escape."); } }), /internal API request failed/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
  assert.equal((await readdir(f.dataDir)).includes(".referral-import.lock"), false);
});

test("lost upload response is recoverable without duplicate photos and an active import lock blocks a second operator", async (t) => {
  const f = await fixture(t);
  let secondBlocked = false;
  await assert.rejects(f.run({ fetchImpl: async (url, options) => {
    if (!secondBlocked) {
      await assert.rejects(f.run(), /Another import holds the local lock/);
      secondBlocked = true;
    }
    const response = await f.fetchImpl(url, options);
    if (url.endsWith("/photos")) { await response.arrayBuffer(); throw new Error("Simulated loss after durable save"); }
    return response;
  } }), /internal API request failed/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM referral_photos").get().n, 1);
  const results = await f.run();
  assert.equal(results[0].photoCount, 1);
  assert.equal(f.requests.filter((entry) => entry.path.endsWith("/photos")).length, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
});

test("a repeated claimed source keeps its data and cannot receive newly imported photos", async (t) => {
  const f = await fixture(t);
  const [first] = await f.run();
  f.db.prepare("UPDATE referrals SET status='claimed',claimed_by=? WHERE id=?").run(f.id, first.id);
  assert.deepEqual(await f.run(), [first]);
  await writeFile(join(f.batchDir, "new.jpg"), await sharp({ create: { width: 200, height: 200, channels: 3, background: "#b46087" } }).jpeg().toBuffer());
  await f.batch([referral({ photos: ["actual-photo.jpg", "new.jpg"] })]);
  await assert.rejects(f.run(), /claimed or revoked/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM referral_photos").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
});
