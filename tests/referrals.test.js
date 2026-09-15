import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import Database from "better-sqlite3";
import { createApp } from "../server/app.js";
import { encodeReferralPhoto } from "../server/referrals.js";
import { hashToken, randomToken } from "../server/security.js";

process.env.HANDOFF_ADMIN_EMAILS = "operator@usc.edu";
const ORIGIN = "http://127.0.0.1:4741";
const PASSWORD = "Referral test password 759";
const execute = promisify(execFile);
const input = (patch = {}) => ({
  sourceUrl: "https://www.facebook.com/groups/usc-housing/posts/123456789/?utm_source=test",
  sourceName: "USC student housing group", authorName: "Source Student", authorProfileUrl: "https://www.facebook.com/source.student",
  sourceText: "I am a USC student and I am subleasing my furnished room near campus from January to May.",
  evidence: { student: "USC student", usc: "USC", sublease: "subleasing my furnished room" },
  listing: { title: "Furnished room near USC", description: "A private room offered by a USC student, ready for the next semester.", price: 1250 },
  outreachStatus: "draft", outreachNotes: "Source independently reviewed.", outreachDraft: "Hi! Review your draft here: {{link}}", ...patch,
});
const listingBody = (photos, patch = {}) => ({
  title: "Furnished room near USC", description: "A private room offered by a USC student, ready for the next semester.", address: "West 30th Street, Los Angeles",
  lat: 34.026, lng: -118.287, price: 1250, deposit: 500, originalPrice: null, bedrooms: 1, bathrooms: 1,
  roomType: "private", genderPreference: "any", availableFrom: "2099-01-01", availableTo: "2099-05-31", amenities: ["Furnished"], photos, status: "draft", ...patch,
});
async function setup(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "handoff-referral-test-"));
  const staticDir = join(dataDir, "static");
  await mkdir(staticDir);
  await writeFile(join(staticDir, "index.html"), "<!doctype html><html><head></head><body>Test app</body></html>");
  const messages = [];
  const app = createApp({ dataDir, staticDir, origin: ORIGIN, mailTransport: { sendMail: async (message) => { messages.push(message); return { accepted: [message.to] }; } } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); app.locals.close(); await rm(dataDir, { recursive: true, force: true }); });
  function client({ internal = false, session } = {}) {
    const jar = new Map(session ? [["handoff_session", session]] : []);
    return {
      jar,
      async call(path, { method = "GET", body, raw = false, headers = {} } = {}) {
        const multipart = body instanceof FormData;
        const result = await fetch(url + path, { method, headers: { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(!["GET", "HEAD"].includes(method) ? { Origin: ORIGIN } : {}), ...(internal ? { "X-Handoff-Surface": "internal" } : {}), ...(body && !multipart ? { "Content-Type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
        for (const cookie of result.headers.getSetCookie()) { const [pair] = cookie.split(";"); const index = pair.indexOf("="); jar.set(pair.slice(0, index), pair.slice(index + 1)); }
        const data = raw ? Buffer.from(await result.arrayBuffer()) : await result.json();
        return { status: result.status, body: data, headers: result.headers };
      },
    };
  }
  function account(email, { verified = true, admin = false, disabled = false } = {}) {
    const id = randomUUID(), session = randomToken(), timestamp = new Date().toISOString();
    app.locals.db.prepare("INSERT INTO users(id,name,email,campus_id,school_domain,school_name,password_hash,verified_at,is_admin,disabled_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id, admin ? "Operator" : "Fixture Student", email, email.endsWith("@usc.edu") ? "usc" : null, email.split("@")[1], "Fixture school", "test fixture", verified ? timestamp : null, admin ? 1 : 0, disabled ? timestamp : null, timestamp, timestamp);
    app.locals.db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)").run(hashToken(session), id, Date.now(), Date.now() + 3600000);
    return { id, user: client({ internal: admin, session }), session };
  }
  const administrator = account("operator@usc.edu", { admin: true });
  const create = async (patch = {}) => {
    const response = await administrator.user.call("/api/admin/referrals", { method: "POST", body: input(patch) });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const referral = response.body.referral;
    return { referral, token: referral.link.split("/").at(-1), path: `/api/referrals/${referral.link.split("/").at(-1)}` };
  };
  const upload = async (referralId) => {
    const bytes = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#98b7db" } }).jpeg().withMetadata({ exif: { IFD0: { Artist: "Private source name" } } }).toBuffer();
    const form = new FormData(); form.append("photos", new Blob([bytes], { type: "image/jpeg" }), "source-photo.jpg");
    const result = await administrator.user.call(`/api/admin/referrals/${referralId}/photos`, { method: "POST", body: form });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.referral.photos;
  };
  const signup = async (student, email) => {
    const result = await student.call("/api/auth/signup", { method: "POST", body: { name: "Actual Student", email, password: PASSWORD } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.user;
  };
  const verify = async (student, email) => {
    const message = messages.filter((message) => message.to === email).at(-1);
    const verification = message.text.match(/https?:\/\/[^\s]+\/verify\?token=([^\s]+)/)[1];
    const result = await student.call("/api/auth/verify", { method: "POST", body: { token: verification } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result;
  };
  return { dataDir, app, client, account, admin: administrator.user, administrator, create, upload, signup, verify, messages };
}

test("referral administration is internal-only, deduplicates sources and preserves exact links and history", async (t) => {
  const f = await setup(t);
  assert.equal((await f.client().call("/api/admin/referrals")).status, 404);
  const unlistedAdmin = f.account("unlisted@usc.edu", { admin: true });
  assert.equal((await unlistedAdmin.user.call("/api/admin/referrals")).status, 404);
  const appAdmin = f.client({ session: f.administrator.session });
  assert.equal((await appAdmin.call("/api/admin/referrals")).status, 404);
  const { referral, token } = await f.create();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(referral.outreachDraft.includes(referral.link));
  const duplicate = await f.admin.call("/api/admin/referrals", { method: "POST", body: input({ sourceUrl: "https://m.facebook.com/groups/usc-housing/permalink/123456789/?ref=share" }) });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.referralId, referral.id);
  assert.equal((await f.admin.call(`/api/admin/referrals/${referral.id}`)).body.referral.link, referral.link);
  const updated = await f.admin.call(`/api/admin/referrals/${referral.id}`, { method: "PATCH", body: { outreachStatus: "ready", outreachNotes: "Ready for David to review.", outreachDraft: "Hello, here is your private preview.", note: "Checked current availability in the source." } });
  assert.equal(updated.status, 200);
  assert.ok(updated.body.referral.outreachDraft.endsWith(referral.link));
  const detail = await f.admin.call(`/api/admin/referrals/${referral.id}`);
  assert.ok(detail.body.events.some((event) => event.type === "outreach_updated" && event.details.note === "Checked current availability in the source."));
  assert.equal((await f.admin.call("/api/admin/referrals?outreachStatus=ready")).body.referrals.length, 1);
  assert.equal(f.messages.length, 0, "Referral administration never sends messages");
  assert.equal(f.app.locals.db.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 0);
});

test("source evidence is explicit, captured in source text and missing factual fields remain absent", async (t) => {
  const f = await setup(t);
  for (const patch of [{ evidence: { student: "a student", usc: "UCLA", sublease: "rental" } }, { sourceUrl: "http://example.com/post" }, { listing: { status: "active" } }, { listing: { photos: ["https://external.example/a.jpg"] } }]) {
    assert.equal((await f.admin.call("/api/admin/referrals", { method: "POST", body: input(patch) })).status, 400);
  }
  const created = await f.create();
  const result = await f.client().call(created.path);
  assert.equal(result.status, 200);
  assert.equal(result.body.referral.listing.deposit, undefined);
  assert.equal(result.body.referral.listing.availableFrom, undefined);
  assert.equal(result.body.referral.listing.lat, undefined);
  assert.ok(result.body.referral.missing.includes("deposit"));
  assert.equal(result.body.referral.sourceText, undefined);
  assert.equal(result.body.referral.evidence, undefined);
  assert.equal(result.body.referral.authorProfileUrl, undefined);
  assert.equal(result.body.referral.link, undefined);
  assert.equal(result.body.referral.outreachDraft, undefined);
});

test("current studies wording is accepted with recorded profile evidence, while past studied wording is rejected", async (t) => {
  const f = await setup(t);
  for (const [index, wording] of ["Studies Business Administration at University of Southern California", "Studying at USC"].entries()) {
    const result = await f.admin.call("/api/admin/referrals", { method: "POST", body: input({ sourceUrl: `https://www.facebook.com/posts/profile-evidence-${index}`, evidence: { student: wording, usc: "University of Southern California", sublease: "subleasing my furnished room" } }) });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.referral.evidence.student, wording);
  }
  const past = await f.admin.call("/api/admin/referrals", { method: "POST", body: input({ evidence: { student: "Studied at USC", usc: "USC", sublease: "subleasing my furnished room" } }) });
  assert.equal(past.status, 400);
});

test("nine source photos and exact cents survive owner claim and publication, while photo and money limits remain enforced", async (t) => {
  const f = await setup(t);
  const created = await f.create({ listing: { price: 1497.50, deposit: 99.01, originalPrice: 1600.25 } });
  const buffers = [];
  for (let index = 0; index < 9; index++) buffers.push(await sharp({ create: { width: 120, height: 100, channels: 3, background: { r: 30 + index * 20, g: 110, b: 200 } } }).jpeg().toBuffer());
  const multipart = (bytes) => {
    const body = new FormData();
    for (const [index, photo] of bytes.entries()) body.append("photos", new Blob([photo], { type: "image/jpeg" }), `source-${index}.jpg`);
    return body;
  };
  const uploaded = await f.admin.call(`/api/admin/referrals/${created.referral.id}/photos`, { method: "POST", body: multipart(buffers) });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.referral.photos.length, 9);
  for (const [index, photo] of uploaded.body.referral.photos.entries()) {
    assert.deepEqual(await readFile(join(f.dataDir, "uploads", "referrals", `${photo.id}.webp`)), await encodeReferralPhoto(buffers[index]), "Gallery and cover retain source upload order");
  }
  const over = await f.admin.call(`/api/admin/referrals/${created.referral.id}/photos`, { method: "POST", body: multipart(buffers.slice(0, 8)) });
  assert.equal(over.status, 400, "Nine existing plus eight new would exceed sixteen");
  assert.equal(f.app.locals.db.prepare("SELECT COUNT(*) AS n FROM referral_photos WHERE referral_id=?").get(created.referral.id).n, 9);
  const owner = f.account("nine-photos@usc.edu");
  const claim = await owner.user.call(created.path + "/claim", { method: "POST", body: { ownershipConfirmed: true, termsAccepted: true } });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.referral.listing.photos.length, 9);
  assert.equal(claim.body.referral.listing.price, 1497.50);
  const attested = JSON.parse(f.app.locals.db.prepare("SELECT details FROM referral_events WHERE referral_id=? AND type='claimed'").get(created.referral.id).details);
  assert.match(attested.attestation, /currently a USC student/);
  assert.match(attested.attestation, /right to list it and use these photos/);
  const photos = claim.body.referral.listing.photos;
  for (const [index, path] of photos.entries()) assert.deepEqual(await readFile(join(f.dataDir, path)), await encodeReferralPhoto(buffers[index]), "Claimed copies retain the same source order");
  const published = await owner.user.call(created.path + "/listing", { method: "POST", body: listingBody(photos, { status: "active", price: 1497.50, deposit: 99.01, originalPrice: 1600.25 }) });
  assert.equal(published.status, 201, JSON.stringify(published.body));
  assert.equal(published.body.listing.price, 1497.50);
  assert.equal(published.body.listing.deposit, 99.01);
  assert.equal(published.body.listing.originalPrice, 1600.25);
  assert.equal(published.body.listing.photos.length, 9);
  const id = published.body.listing.id;
  const stored = f.app.locals.db.prepare("SELECT price,deposit,original_price FROM listings WHERE id=?").get(id);
  assert.deepEqual(stored, { price: 1497.50, deposit: 99.01, original_price: 1600.25 });
  for (const field of ["price", "deposit", "originalPrice"]) {
    assert.equal((await owner.user.call(`/api/listings/${id}`, { method: "PATCH", body: { [field]: 1497.501 } })).status, 400);
    assert.equal((await owner.user.call("/api/listings", { method: "POST", body: listingBody(photos, { [field]: 1497.501 }) })).status, 400);
    assert.equal((await f.admin.call("/api/admin/referrals", { method: "POST", body: input({ sourceUrl: `https://www.facebook.com/posts/decimal-${field}`, listing: { [field]: 1497.501 } }) })).status, 400);
  }
  assert.equal((await owner.user.call(`/api/listings/${id}`, { method: "PATCH", body: { price: 1497.51 } })).body.listing.price, 1497.51);
  const normal = await owner.user.call("/api/listings", { method: "POST", body: listingBody(photos, { price: 1497.50 }) });
  assert.equal(normal.status, 201);
  assert.equal(normal.body.listing.price, 1497.50);
  const sixteen = await owner.user.call("/api/uploads", { method: "POST", body: multipart([...buffers, ...buffers.slice(0, 7)]) });
  assert.equal(sixteen.status, 201, JSON.stringify(sixteen.body));
  assert.equal(sixteen.body.photos.length, 16);
  const tooMany = await owner.user.call("/api/uploads", { method: "POST", body: multipart([...buffers, ...buffers.slice(0, 8)]) });
  assert.equal(tooMany.status, 400);
  const maxListing = await owner.user.call("/api/listings", { method: "POST", body: listingBody(sixteen.body.photos) });
  assert.equal(maxListing.status, 201);
  assert.equal(maxListing.body.listing.photos.length, 16);
  assert.equal((await owner.user.call(`/api/listings/${id}`, { method: "PATCH", body: { photos: [...sixteen.body.photos, photos[0]] } })).status, 400);
});

test("opens and unique cookie visits are separate; signup and verification attribution uses actual accounts", async (t) => {
  const f = await setup(t);
  const { referral, path, token } = await f.create();
  const visitor = f.client();
  assert.equal((await visitor.call(path)).status, 200);
  await visitor.call(path);
  await f.client().call(path);
  let details = (await f.admin.call(`/api/admin/referrals/${referral.id}`)).body;
  assert.equal(details.referral.metrics.opens, 3);
  assert.equal(details.referral.metrics.uniqueVisits, 2);
  assert.equal(details.referral.metrics.accountCreated, 0);
  const user = await f.signup(visitor, "actual.owner@usc.edu");
  assert.equal((await visitor.call(path + "/claim", { method: "POST", body: { ownershipConfirmed: true, termsAccepted: true } })).status, 403);
  await f.verify(visitor, "actual.owner@usc.edu");
  details = (await f.admin.call(`/api/admin/referrals/${referral.id}`)).body;
  assert.equal(details.referral.metrics.accountCreated, 1);
  assert.equal(details.referral.metrics.verified, 1);
  assert.equal(details.referral.metrics.claimed, 0);
  assert.ok(details.events.some((event) => event.type === "account_created" && event.actorId === user.id && event.actorName === "Actual Student" && event.details.claimedOwner === false));
  assert.equal(details.referral.authorName, "Source Student");
  const persisted = f.app.locals.db.prepare("SELECT * FROM referral_visits").all();
  assert.ok(persisted.every((visit) => /^[a-f0-9]{64}$/.test(visit.visitor_hash)));
  assert.ok(!JSON.stringify(persisted).includes("127.0.0.1"));
  const page = await visitor.call(`/referral/${token}`, { raw: true });
  assert.match(page.headers.get("cache-control"), /no-store/);
  assert.match(page.headers.get("x-robots-tag"), /noindex/);
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
});

test("nontracking initial reads cannot replace a concurrent tracked visit's browser identity", async (t) => {
  const f = await setup(t);
  const created = await f.create();
  const untracked = await f.client().call(created.path + "?track=0");
  assert.ok(!untracked.headers.getSetCookie().some((value) => value.startsWith("handoff_visitor=")));
  const tracked = await f.client().call(created.path);
  assert.ok(tracked.headers.getSetCookie().some((value) => value.startsWith("handoff_visitor=")));
  assert.equal(f.app.locals.db.prepare("SELECT COUNT(*) AS n FROM referral_visits").get().n, 1);
});

test("private photos require the capability, strip metadata, transfer to owner only on attested USC claim", async (t) => {
  const f = await setup(t);
  const created = await f.create();
  const importedPhotos = await f.upload(created.referral.id);
  const guest = f.client();
  const preview = await guest.call(created.path);
  const privatePhoto = preview.body.referral.photos[0];
  assert.equal((await guest.call(privatePhoto.url, { raw: true })).status, 200);
  assert.equal((await guest.call(importedPhotos[0].url, { raw: true })).status, 404);
  assert.equal((await guest.call(`/uploads/referrals/${privatePhoto.id}.webp`, { raw: true })).status, 404);
  const privateBytes = await readFile(join(f.dataDir, "uploads/referrals", `${privatePhoto.id}.webp`));
  assert.equal((await sharp(privateBytes).metadata()).exif, undefined);
  const ucla = f.account("student@ucla.edu");
  assert.equal((await ucla.user.call(created.path + "/claim", { method: "POST", body: { ownershipConfirmed: true, termsAccepted: true } })).status, 403);
  const owner = f.account("owner@usc.edu");
  assert.equal((await owner.user.call(created.path + "/claim", { method: "POST", body: { ownershipConfirmed: false, termsAccepted: true } })).status, 400);
  const claimed = await owner.user.call(created.path + "/claim", { method: "POST", body: { ownershipConfirmed: true, termsAccepted: true } });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assert.equal(claimed.body.referral.claimedByMe, true);
  assert.equal(claimed.body.referral.listingId, null);
  assert.equal(claimed.body.referral.listing.deposit, undefined);
  assert.match(claimed.body.editUrl, /mode=manual&referral=/);
  const photo = claimed.body.referral.listing.photos[0];
  assert.match(photo, /^\/uploads\/[a-f0-9-]{36}\.webp$/);
  assert.equal((await owner.user.call(photo, { raw: true })).status, 200);
  assert.equal((await guest.call(photo, { raw: true })).status, 404);
  assert.equal((await guest.call(created.path)).status, 404);
  assert.equal((await guest.call(privatePhoto.url, { raw: true })).status, 404);
  assert.equal((await f.account("another@usc.edu").user.call(created.path)).status, 404);
  const repeated = await owner.user.call(created.path + "/claim", { method: "POST", body: { ownershipConfirmed: true, termsAccepted: true } });
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body.referral.listing.photos, [photo]);
  assert.equal(f.app.locals.db.prepare("SELECT COUNT(*) AS count FROM uploads").get().count, 1);
  assert.equal(f.app.locals.db.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 0);
  assert.equal((await f.admin.call(`/api/admin/referrals/${created.referral.id}`, { method: "PATCH", body: { listing: { price: 900 } } })).status, 409);
});

test("owner-reviewed creation is validated and idempotent, with durable claim and publication timeline", async (t) => {
  const f = await setup(t);
  const created = await f.create();
  await f.upload(created.referral.id);
  const owner = f.account("publisher@usc.edu");
  const claimed = await owner.user.call(created.path + "/claim", { method: "POST", body: { ownershipConfirmed: true, termsAccepted: true } });
  const photos = claimed.body.referral.listing.photos;
  assert.equal((await owner.user.call(created.path + "/listing", { method: "POST", body: listingBody([], { status: "active" }) })).status, 400);
  assert.equal((await owner.user.call(created.path + "/listing", { method: "POST", body: listingBody(photos, { price: -1 }) })).status, 400);
  const draft = await owner.user.call(created.path + "/listing", { method: "POST", body: listingBody(photos) });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.listing.status, "draft");
  const id = draft.body.listing.id;
  assert.equal((await f.client().call("/api/listings")).body.listings.length, 0);
  const repeat = await owner.user.call(created.path + "/listing", { method: "POST", body: listingBody(photos) });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.listing.id, id);
  assert.equal(f.app.locals.db.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 1);
  assert.equal((await owner.user.call(`/api/listings/${id}`, { method: "PATCH", body: { status: "active" } })).status, 200);
  let detail = (await f.admin.call(`/api/admin/referrals/${created.referral.id}`)).body;
  assert.equal(detail.referral.metrics.claimed, 1);
  assert.equal(detail.referral.metrics.published, 1);
  assert.equal(detail.referral.listingStatus, "active");
  assert.ok(detail.events.some((event) => event.type === "listing_published" && event.details.listingId === id));
  await owner.user.call(`/api/listings/${id}`, { method: "PATCH", body: { status: "archived" } });
  detail = (await f.admin.call(`/api/admin/referrals/${created.referral.id}`)).body;
  assert.equal(detail.referral.listingStatus, "archived");
  assert.equal(detail.referral.metrics.published, 1);
  assert.ok(detail.events.some((event) => event.type === "listing_status_changed"));
});

test("revocation removes capability access and attribution, while admin retains complete records", async (t) => {
  const f = await setup(t);
  const created = await f.create();
  const visitor = f.client();
  await visitor.call(created.path);
  const revoked = await f.admin.call(`/api/admin/referrals/${created.referral.id}/revoke`, { method: "POST" });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.referral.status, "revoked");
  assert.equal((await visitor.call(created.path)).status, 404);
  assert.equal((await f.account("revoked@usc.edu").user.call(created.path + "/claim", { method: "POST", body: { ownershipConfirmed: true, termsAccepted: true } })).status, 404);
  await f.signup(visitor, "after.revoke@usc.edu");
  const detail = (await f.admin.call(`/api/admin/referrals/${created.referral.id}`)).body;
  assert.equal(detail.referral.metrics.accountCreated, 0);
  assert.equal(detail.referral.link, created.referral.link);
  assert.ok(detail.events.some((event) => event.type === "revoked"));
});

test("two simultaneous verified claim attempts produce one owner and one set of photo copies", async (t) => {
  const f = await setup(t);
  const created = await f.create();
  await f.upload(created.referral.id);
  const first = f.account("first.claim@usc.edu"), second = f.account("second.claim@usc.edu");
  const attempts = await Promise.all([first, second].map((student) => student.user.call(created.path + "/claim", { method: "POST", body: { ownershipConfirmed: true, termsAccepted: true } })));
  assert.equal(attempts.filter((result) => result.status === 200).length, 1);
  assert.equal(attempts.filter((result) => [404, 409].includes(result.status)).length, 1);
  assert.equal(f.app.locals.db.prepare("SELECT COUNT(*) AS count FROM uploads").get().count, 1);
  const files = (await readdir(join(f.dataDir, "uploads"))).filter((name) => name.endsWith(".webp"));
  assert.equal(files.length, 1);
  assert.equal(f.app.locals.db.prepare("SELECT COUNT(*) AS count FROM referral_events WHERE type='claimed'").get().count, 1);
});

test("matched backup includes private referral source photos and current account avatar", async (t) => {
  const f = await setup(t);
  const created = await f.create();
  const photos = await f.upload(created.referral.id);
  const avatar = `${randomUUID()}.jpg`, avatarBytes = Buffer.from("avatar fixture");
  await writeFile(join(f.dataDir, "uploads", avatar), avatarBytes);
  f.app.locals.db.prepare("UPDATE users SET avatar=? WHERE id=?").run(`/avatars/${avatar}`, f.administrator.id);
  const backups = join(f.dataDir, "snapshot-test");
  const result = await execute(process.execPath, [resolve("deploy/backup.mjs")], { env: { ...process.env, HANDOFF_DATA_DIR: f.dataDir, HANDOFF_BACKUP_DIR: backups } });
  const completed = JSON.parse(result.stdout), manifest = JSON.parse(await readFile(completed.manifest, "utf8"));
  assert.equal(manifest.schemaVersion, 13);
  assert.equal(manifest.uploads.referralPhotos, 1);
  assert.equal(manifest.uploads.avatars, 1);
  const restore = join(f.dataDir, "restored"); await mkdir(restore);
  await execute("/usr/bin/tar", ["-xzf", completed.uploads, "-C", restore]);
  assert.deepEqual(await readFile(join(restore, "uploads", avatar)), avatarBytes);
  assert.deepEqual(await readFile(join(restore, "uploads/referrals", `${photos[0].id}.webp`)), await readFile(join(f.dataDir, "uploads/referrals", `${photos[0].id}.webp`)));
  const db = new Database(completed.database, { readonly: true });
  assert.equal(db.prepare("SELECT source_text FROM referrals").get().source_text, input().sourceText);
  db.close();
});

test("existing-account login attribution never counts as a new signup and nontracking reads stay out of opens", async (t) => {
  const f = await setup(t);
  const student = f.client();
  await f.signup(student, "existing@usc.edu");
  await f.verify(student, "existing@usc.edu");
  await student.call("/api/auth/logout", { method: "POST" });
  const created = await f.create();
  await student.call(created.path);
  await student.call(created.path + "?track=0");
  await student.call(created.path + "?track=0");
  const login = await student.call("/api/auth/login", { method: "POST", body: { email: "existing@usc.edu", password: PASSWORD } });
  assert.equal(login.status, 200);
  const detail = (await f.admin.call(`/api/admin/referrals/${created.referral.id}`)).body;
  assert.equal(detail.referral.metrics.opens, 1);
  assert.equal(detail.referral.metrics.uniqueVisits, 1);
  assert.equal(detail.referral.metrics.accountCreated, 0);
  assert.equal(detail.referral.metrics.verified, 1);
  assert.ok(detail.events.some((event) => event.type === "logged_in" && event.details.attribution === "existing_account"));
  assert.ok(detail.events.some((event) => event.type === "verified" && event.details.alreadyVerified === true));
});

test("verification attribution survives opening the email on another browser without attribution cookies", async (t) => {
  const f = await setup(t);
  const created = await f.create();
  const visitor = f.client();
  await visitor.call(created.path);
  await f.signup(visitor, "cross.browser@usc.edu");
  await f.verify(f.client(), "cross.browser@usc.edu");
  const detail = (await f.admin.call(`/api/admin/referrals/${created.referral.id}`)).body;
  assert.equal(detail.referral.metrics.accountCreated, 1);
  assert.equal(detail.referral.metrics.verified, 1);
  assert.equal(detail.referral.metrics.claimed, 0);
});

test("revocation during photo transfer blocks claim and removes only its new temporary copies", async (t) => {
  const f = await setup(t);
  const created = await f.create();
  await f.upload(created.referral.id);
  const owner = f.account("race.revoke@usc.edu");
  const [claim, revoke] = await Promise.all([
    owner.user.call(created.path + "/claim", { method: "POST", body: { ownershipConfirmed: true, termsAccepted: true } }),
    f.admin.call(`/api/admin/referrals/${created.referral.id}/revoke`, { method: "POST" }),
  ]);
  assert.equal(revoke.status, 200);
  assert.ok([200, 404].includes(claim.status));
  assert.equal((await owner.user.call(created.path)).status, 404);
  const row = f.app.locals.db.prepare("SELECT * FROM referrals WHERE id=?").get(created.referral.id);
  const copies = f.app.locals.db.prepare("SELECT COUNT(*) AS count FROM uploads").get().count;
  assert.equal(copies, row.claimed_by ? 1 : 0);
  const files = (await readdir(join(f.dataDir, "uploads"))).filter((name) => name.endsWith(".webp"));
  assert.equal(files.length, copies);
  assert.equal((await readdir(join(f.dataDir, "uploads/referrals"))).length, 1);
});

test("disabled claimants, invalid images, cross-origin writes and invented source evidence are rejected", async (t) => {
  const f = await setup(t);
  const created = await f.create();
  const disabled = f.account("disabled@usc.edu", { disabled: true });
  assert.equal((await disabled.user.call(created.path + "/claim", { method: "POST", body: { ownershipConfirmed: true, termsAccepted: true } })).status, 403);
  const owner = f.account("csrf.owner@usc.edu");
  assert.equal((await owner.user.call(created.path + "/claim", { method: "POST", body: { ownershipConfirmed: true, termsAccepted: true }, headers: { Origin: "https://untrusted.example" } })).status, 403);
  const invalid = new FormData(); invalid.append("photos", new Blob(["<svg><script>alert(1)</script></svg>"], { type: "image/jpeg" }), "photo.jpg");
  assert.equal((await f.admin.call(`/api/admin/referrals/${created.referral.id}/photos`, { method: "POST", body: invalid })).status, 400);
  assert.equal((await readdir(join(f.dataDir, "uploads/referrals"))).length, 0);
  assert.equal((await f.admin.call("/api/admin/referrals", { method: "POST", body: input({ sourceUrl: "https://www.facebook.com/posts/987654321", authorProfileUrl: "", evidence: { student: "I am a current undergraduate", usc: "University of Southern California", sublease: "subleasing my furnished room" } }) })).status, 400);
  assert.equal(f.app.locals.db.prepare("SELECT COUNT(*) AS count FROM referrals").get().count, 1);
});
