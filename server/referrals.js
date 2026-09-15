/** Private, operator-created USC referrals. No source fetches, outreach sends, or automatic publication. */
import express from "express";
import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { copyFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { cookies, hashToken, HttpError, randomToken } from "./security.js";
import { createListingSchema, enforceGenderPreference, parse, patchListingSchema, validateListing } from "./validation.js";

const iso = () => new Date().toISOString();
const HOUR = 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const OUTREACH = ["draft", "ready", "sent", "replied", "declined", "do_not_contact"];
const string = (length) => z.string().trim().max(length);
const optionalUrl = z.union([z.literal(""), z.string().url().max(2000)]).default("");
const evidenceSchema = z.object({ student: string(2000).min(3), usc: string(2000).min(3), sublease: string(2000).min(3) }).strict();
const importedListing = patchListingSchema.omit({ status: true, photos: true });
const createSchema = z.object({
  sourceUrl: z.string().url().max(2000), sourceName: string(160).min(2), authorName: string(160).min(2),
  authorProfileUrl: optionalUrl, sourceText: string(16000).min(20), sourcePostedAt: z.string().datetime({ offset: true }).nullable().optional(),
  evidence: evidenceSchema, listing: importedListing.default({}),
  outreachStatus: z.enum(OUTREACH).default("draft"), outreachNotes: string(10000).default(""), outreachDraft: string(10000).default(""),
}).strict();
const patchSchema = z.object({
  sourceName: string(160).min(2).optional(), authorName: string(160).min(2).optional(),
  authorProfileUrl: z.union([z.literal(""), z.string().url().max(2000)]).optional(),
  sourceText: string(16000).min(20).optional(), sourcePostedAt: z.string().datetime({ offset: true }).nullable().optional(),
  evidence: evidenceSchema.optional(), listing: importedListing.optional(),
  outreachStatus: z.enum(OUTREACH).optional(), outreachNotes: string(10000).optional(), outreachDraft: string(10000).optional(),
  note: string(4000).min(1).optional(),
}).strict();
const normalizeText = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();

export function canonicalSourceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new HttpError(400, "Use a public HTTPS source link without login details.");
  url.hash = "";
  const facebook = /^(?:www\.|m\.|mbasic\.|web\.)?facebook\.com$/.test(url.hostname);
  if (facebook) {
    url.hostname = "www.facebook.com";
    url.pathname = url.pathname.replace(/\/permalink\//, "/posts/");
    for (const key of [...url.searchParams.keys()]) if (!["id", "story_fbid", "fbid"].includes(key)) url.searchParams.delete(key);
  } else {
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|referrer$)/i.test(key)) url.searchParams.delete(key);
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.searchParams.sort();
  return url.href;
}
function checkSource(input) {
  const post = normalizeText(input.sourceText);
  if (!post.includes(normalizeText(input.evidence.sublease))) throw new HttpError(400, "The sublease evidence excerpt must appear in the recorded source post.");
  for (const key of ["student", "usc"]) {
    if (!post.includes(normalizeText(input.evidence[key])) && !input.authorProfileUrl) throw new HttpError(400, "Student and USC evidence must appear in the source post or cite the recorded public author profile.");
  }
  if (!/\b(student|undergraduate|graduate|freshman|sophomore|junior|senior|studies|studying)\b/i.test(input.evidence.student)) throw new HttpError(400, "Record explicit evidence that the poster is a student.");
  if (!/\busc\b|university of southern california/i.test(input.evidence.usc)) throw new HttpError(400, "Record explicit USC affiliation evidence.");
  if (!/\bsubleas(?:e|ing|es)\b|\bsublet(?:ting)?\b/i.test(input.evidence.sublease)) throw new HttpError(400, "Record explicit sublease evidence.");
  if (input.authorProfileUrl) canonicalSourceUrl(input.authorProfileUrl);
}
// Shared with the filesystem-authorized operator importer so reruns compare the exact stored encoding.
export async function encodeReferralPhoto(bytes) {
  try {
    const decoder = sharp(bytes, { limitInputPixels: 24_000_000, animated: false, failOn: "warning" });
    const meta = await decoder.metadata();
    if (!["jpeg", "png", "webp", "heif", "avif"].includes(meta.format) || meta.pages > 1 || meta.width < 100 || meta.height < 100) throw new Error("Invalid raster photo.");
    return await decoder.rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
  } catch { throw new HttpError(400, "Upload valid raster photos between 100 by 100 pixels and 24 megapixels."); }
}
function missingFields(listing, photoCount) {
  const required = ["title", "description", "address", "lat", "lng", "price", "deposit", "bedrooms", "bathrooms", "roomType", "availableFrom", "availableTo"];
  const missing = required.filter((key) => listing[key] === undefined || listing[key] === null || listing[key] === "");
  if (!photoCount) missing.push("photos");
  return missing;
}

export function createReferrals({ db, limit, dataDir, origin, secureCookies, isAllowedAdmin, getListing, serializeListing, validatePhotos }) {
  const publicRouter = express.Router();
  const adminRouter = express.Router();
  const privateDir = join(dataDir, "uploads", "referrals");
  const uploadDir = join(dataDir, "uploads");
  const contextCookie = secureCookies ? "__Host-handoff_referral" : "handoff_referral";
  const visitorCookie = secureCookies ? "__Host-handoff_visitor" : "handoff_visitor";
  const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: "lax", path: "/", maxAge: 30 * 24 * HOUR };
  const unavailable = () => new HttpError(404, "This referral is no longer available.");
  const event = (referralId, type, actorId = null, details = {}, visitorHash = null) => {
    db.prepare("INSERT OR IGNORE INTO referral_events(id,referral_id,type,actor_id,visitor_hash,details,created_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(), referralId, type, actorId, visitorHash, JSON.stringify(details), iso());
  };
  const audit = (userId, action, referralId, details = {}) => db.prepare("INSERT INTO admin_audit(id,admin_id,action,target_type,target_id,details,created_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(), userId, action, "referral", referralId, JSON.stringify(details), iso());
  const byId = (id) => db.prepare("SELECT r.*,l.status AS listing_status FROM referrals r LEFT JOIN listings l ON l.id=r.listing_id WHERE r.id=?").get(id);
  const byToken = (value) => TOKEN.test(value || "") ? db.prepare("SELECT r.*,l.status AS listing_status FROM referrals r LEFT JOIN listings l ON l.id=r.listing_id WHERE r.token=?").get(value) : undefined;
  const photoRows = (id) => db.prepare("SELECT p.*,u.filename AS owned_filename FROM referral_photos p LEFT JOIN uploads u ON u.id=p.claimed_upload_id WHERE p.referral_id=? ORDER BY p.created_at,p.id").all(id);
  const currentUser = (req) => req.user && db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  const assertAccess = (req, row) => {
    if (!row || row.status === "revoked" || req.user?.disabled_at || (row.claimed_by && row.claimed_by !== req.user?.id && !isAllowedAdmin(req.user))) throw unavailable();
  };
  const requireClaimant = (req, row) => {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, "Sign in to review and claim your sublease draft.");
    if (user.disabled_at || !user.verified_at || user.campus_id !== "usc" || !/(?:^|\.)usc\.edu$/.test(user.email.split("@")[1] || "")) throw new HttpError(403, "Claim this draft with your verified USC student email.");
    assertAccess({ ...req, user }, row);
    return user;
  };
  const link = (row) => `${origin}/referral/${row.token}`;
  const editUrl = (row) => `/listings/new?mode=manual&referral=${encodeURIComponent(row.token)}`;
  const metrics = (id) => {
    const opened = db.prepare("SELECT COALESCE(SUM(opens),0) AS opens,COUNT(*) AS uniqueVisits,MAX(last_at) AS lastOpenedAt FROM referral_visits WHERE referral_id=?").get(id);
    const counts = Object.fromEntries(db.prepare("SELECT type,COUNT(DISTINCT actor_id) AS count FROM referral_events WHERE referral_id=? GROUP BY type").all(id).map((row) => [row.type, row.count]));
    const row = byId(id);
    return { opens: opened.opens, uniqueVisits: opened.uniqueVisits, accountCreated: counts.account_created || 0, verified: counts.verified || 0, claimed: row.claimed_by ? 1 : 0, published: db.prepare("SELECT 1 FROM referral_events WHERE referral_id=? AND type='listing_published' LIMIT 1").get(id) ? 1 : 0 };
  };
  const serialize = (row, { req, admin = false } = {}) => {
    const photos = photoRows(row.id);
    const claimedByMe = Boolean(req?.user && row.claimed_by === req.user.id);
    const imported = JSON.parse(row.listing_data);
    const listing = { ...imported };
    if (claimedByMe) listing.photos = photos.filter((photo) => photo.owned_filename).map((photo) => `/uploads/${photo.owned_filename}`);
    const result = {
      id: row.id, status: row.status, campusId: "usc", authorName: row.author_name, sourceName: row.source_name,
      sourceUrl: row.source_url, sourcePostedAt: row.source_posted_at, listing,
      photos: photos.map((photo) => ({ id: photo.id, url: admin ? `/api/admin/referrals/${row.id}/photos/${photo.id}` : claimedByMe && photo.owned_filename ? `/uploads/${photo.owned_filename}` : `/api/referrals/${row.token}/photos/${photo.id}` })),
      missing: missingFields(imported, photos.length), claimedByMe, listingId: row.listing_id, listingStatus: row.listing_status || null,
    };
    if (admin) Object.assign(result, {
      link: link(row), authorProfileUrl: row.author_profile_url, sourceText: row.source_text, evidence: JSON.parse(row.evidence),
      outreachStatus: row.outreach_status, outreachNotes: row.outreach_notes, outreachDraft: row.outreach_draft,
      metrics: metrics(row.id), lastOpenedAt: db.prepare("SELECT MAX(last_at) AS value FROM referral_visits WHERE referral_id=?").get(row.id).value,
      createdAt: row.created_at, updatedAt: row.updated_at, claimedAt: row.claimed_at, claimedBy: row.claimed_by,
      ownershipAttestedAt: row.ownership_attested_at, termsAcceptedAt: row.terms_accepted_at,
    });
    return result;
  };
  const response = (row, req) => ({ referral: serialize(row, { req }), next: { signUpUrl: `/sign-up?next=${encodeURIComponent(`/referral/${row.token}`)}`, signInUrl: `/sign-in?next=${encodeURIComponent(`/referral/${row.token}`)}`, reviewUrl: row.listing_id ? `/listings/${row.listing_id}/edit` : editUrl(row) } });
  const privateHeaders = (req, res, next) => {
    res.set({ "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    const csp = res.get("Content-Security-Policy");
    if (csp) res.set("Content-Security-Policy", csp.replace(/frame-ancestors[^;]+;/, "frame-ancestors 'none';"));
    next();
  };
  publicRouter.use(privateHeaders);
  publicRouter.use(limit("referral-read", 240, HOUR));
  const context = (req) => {
    const jar = cookies(req.get("Cookie"));
    const row = byToken(jar[contextCookie]);
    return row?.status === "pending" ? { row, visitorHash: TOKEN.test(jar[visitorCookie] || "") ? hashToken(jar[visitorCookie]) : null } : null;
  };
  const attribute = (req, userId, kind) => {
    const attribution = context(req);
    if (!attribution) return;
    const { row, visitorHash } = attribution;
    const user = db.prepare("SELECT verified_at FROM users WHERE id=?").get(userId);
    db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO referral_attributions(referral_id,user_id,kind,visitor_hash,created_at) VALUES(?,?,?,?,?)").run(row.id, userId, kind, visitorHash, iso());
      event(row.id, kind === "signup" ? "account_created" : "logged_in", userId, { attribution: kind === "signup" ? "new_account" : "existing_account", claimedOwner: false }, visitorHash);
      if (user?.verified_at) event(row.id, "verified", userId, { alreadyVerified: true }, visitorHash);
    })();
  };
  const verified = (userId) => {
    for (const row of db.prepare("SELECT a.* FROM referral_attributions a JOIN referrals r ON r.id=a.referral_id WHERE a.user_id=? AND r.status!='revoked'").all(userId)) event(row.referral_id, "verified", userId, { alreadyVerified: false }, row.visitor_hash);
  };
  const listingChanged = (listingId, status, actorId, previousStatus) => {
    const row = db.prepare("SELECT id FROM referrals WHERE listing_id=?").get(listingId);
    if (!row || status === previousStatus) return;
    event(row.id, status === "active" ? "listing_published" : "listing_status_changed", actorId, { listingId, previousStatus: previousStatus || null, status });
  };
  publicRouter.get("/:token", (req, res) => {
    const row = byToken(req.params.token);
    assertAccess(req, row);
    const track = parse(z.object({ track: z.enum(["0", "1"]).default("1") }).strict(), req.query).track !== "0";
    const jar = cookies(req.get("Cookie"));
    const visitor = TOKEN.test(jar[visitorCookie] || "") ? jar[visitorCookie] : randomToken();
    const visitorHash = hashToken(visitor);
    const timestamp = iso();
    if (track) db.transaction(() => {
      const exists = db.prepare("SELECT 1 FROM referral_visits WHERE referral_id=? AND visitor_hash=?").get(row.id, visitorHash);
      db.prepare("INSERT INTO referral_visits(referral_id,visitor_hash,first_at,last_at,opens) VALUES(?,?,?,?,1) ON CONFLICT(referral_id,visitor_hash) DO UPDATE SET last_at=excluded.last_at,opens=opens+1").run(row.id, visitorHash, timestamp, timestamp);
      event(row.id, "opened", req.user?.id || null, { uniqueVisit: !exists }, visitorHash);
    })();
    // Editor/auth refreshes must not race the real page visit's fresh visitor cookie.
    if (track) res.cookie(visitorCookie, visitor, cookieOptions);
    if (!row.claimed_by) res.cookie(contextCookie, row.token, cookieOptions);
    res.json(response(row, req));
  });
  publicRouter.get("/:token/photos/:photoId", (req, res) => {
    const row = byToken(req.params.token);
    assertAccess(req, row);
    const photo = db.prepare("SELECT * FROM referral_photos WHERE id=? AND referral_id=?").get(req.params.photoId, row.id);
    if (!photo) throw unavailable();
    res.type("image/webp").sendFile(join(privateDir, photo.filename));
  });
  publicRouter.post("/:token/claim", limit("referral-claim", 12, HOUR), async (req, res) => {
    const row = byToken(req.params.token);
    const user = requireClaimant(req, row);
    parse(z.object({ ownershipConfirmed: z.literal(true), termsAccepted: z.literal(true) }).strict(), req.body);
    if (row.claimed_by === user.id) return res.json({ ...response(row, req), editUrl: row.listing_id ? `/listings/${row.listing_id}/edit` : editUrl(row) });
    const photos = photoRows(row.id);
    const copies = [];
    try {
      for (const photo of photos) {
        const id = randomUUID();
        const filename = `${id}.webp`;
        await copyFile(join(privateDir, photo.filename), join(uploadDir, filename), constants.COPYFILE_EXCL);
        copies.push({ id, filename, source: photo });
      }
      db.transaction(() => {
        const fresh = byId(row.id);
        requireClaimant(req, fresh);
        if (fresh.claimed_by) throw new HttpError(409, "This draft has already been claimed. Refresh the page.");
        const currentPhotos = photoRows(row.id);
        if (currentPhotos.length !== photos.length || currentPhotos.some((photo, index) => photo.id !== photos[index].id)) throw new HttpError(409, "The draft changed while you were claiming it. Refresh and review it again.");
        const used = db.prepare("SELECT COALESCE(SUM(bytes),0) AS bytes FROM uploads WHERE owner_id=?").get(user.id).bytes;
        if (used + photos.reduce((sum, photo) => sum + photo.bytes, 0) > 250 * 1024 * 1024) throw new HttpError(413, "Your photo storage is full.");
        const timestamp = iso();
        for (const item of copies) {
          db.prepare("INSERT INTO uploads(id,owner_id,filename,bytes,created_at) VALUES(?,?,?,?,?)").run(item.id, user.id, item.filename, item.source.bytes, timestamp);
          db.prepare("UPDATE referral_photos SET claimed_upload_id=? WHERE id=?").run(item.id, item.source.id);
        }
        db.prepare("UPDATE users SET terms_accepted_at=COALESCE(terms_accepted_at,?),updated_at=? WHERE id=?").run(timestamp, timestamp, user.id);
        db.prepare("UPDATE referrals SET status='claimed',claimed_by=?,claimed_at=?,ownership_attested_at=?,terms_accepted_at=?,updated_at=? WHERE id=?").run(user.id, timestamp, timestamp, timestamp, timestamp, row.id);
        event(row.id, "verified", user.id, { alreadyVerified: true, confirmedAtClaim: true });
        event(row.id, "claimed", user.id, { ownershipConfirmed: true, termsAccepted: true, attestation: "I am currently a USC student and the person responsible for this source post and sublease, have the right to list it, and will review the details before publication.", attestationVersion: "2026-09-15" });
      })();
    } catch (error) {
      for (const item of copies) await unlink(join(uploadDir, item.filename)).catch(() => {});
      throw error;
    }
    const claimed = byId(row.id);
    res.json({ ...response(claimed, req), editUrl: editUrl(claimed) });
  });
  publicRouter.post("/:token/listing", limit("referral-listing", 20, HOUR, (req) => req.user?.id || req.ip), (req, res) => {
    const row = byToken(req.params.token);
    const user = requireClaimant(req, row);
    if (row.claimed_by !== user.id) throw new HttpError(403, "Claim and review this draft before saving a listing.");
    if (row.listing_created_at) {
      if (!row.listing_id) throw new HttpError(410, "The listing from this referral was deleted. Create a new listing from your account.");
      return res.json({ listing: serializeListing(getListing(row.listing_id), user.id) });
    }
    if (!user.terms_accepted_at || !row.ownership_attested_at) throw new HttpError(403, "Confirm ownership and accept the marketplace terms before saving.");
    const required = ["title", "description", "address", "lat", "lng", "price", "deposit", "bedrooms", "bathrooms", "roomType", "availableFrom", "availableTo", "photos"];
    const absent = required.filter((key) => !Object.prototype.hasOwnProperty.call(req.body || {}, key));
    if (absent.length) throw new HttpError(400, `Review and supply these listing fields before saving: ${absent.join(", ")}.`);
    const input = enforceGenderPreference(parse(createListingSchema, req.body));
    validateListing(input);
    validatePhotos(input.photos, user.id);
    const id = randomUUID();
    db.transaction(() => {
      const fresh = byId(row.id);
      requireClaimant(req, fresh);
      if (fresh.listing_created_at) throw new HttpError(409, "A listing has already been created for this referral.");
      const timestamp = iso();
      db.prepare("INSERT INTO listings(id,owner_id,campus_id,title,description,address,lat,lng,price,deposit,original_price,bedrooms,bathrooms,room_type,gender_preference,available_from,available_to,amenities,photos,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, user.id, "usc", input.title, input.description, input.address, input.lat, input.lng, input.price, input.deposit, input.originalPrice, input.bedrooms, input.bathrooms, input.roomType, input.genderPreference, input.availableFrom, input.availableTo, JSON.stringify(input.amenities), JSON.stringify(input.photos), input.status, timestamp, timestamp);
      db.prepare("UPDATE referrals SET listing_id=?,listing_created_at=?,updated_at=? WHERE id=?").run(id, timestamp, timestamp, row.id);
      event(row.id, "listing_created", user.id, { listingId: id, status: input.status });
      listingChanged(id, input.status, user.id, null);
    })();
    res.status(201).json({ listing: serializeListing(getListing(id), user.id) });
  });

  adminRouter.use(privateHeaders);
  adminRouter.use((req, res, next) => req.surface === "internal" && isAllowedAdmin(req.user) ? next() : next(new HttpError(404, "Endpoint not found.")));
  adminRouter.get("/", (req, res) => {
    const query = parse(z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), query: string(120).optional(), status: z.enum(["pending", "claimed", "revoked"]).optional(), outreachStatus: z.enum(OUTREACH).optional() }).strict(), req.query);
    const where = [], values = [];
    if (query.status) { where.push("r.status=?"); values.push(query.status); }
    if (query.outreachStatus) { where.push("r.outreach_status=?"); values.push(query.outreachStatus); }
    if (query.query) { where.push("(r.author_name LIKE ? ESCAPE '\\' OR r.source_name LIKE ? ESCAPE '\\' OR r.source_text LIKE ? ESCAPE '\\' OR json_extract(r.listing_data,'$.title') LIKE ? ESCAPE '\\')"); const search = `%${query.query.replace(/[\\%_]/g, "\\$&")}%`; values.push(search, search, search, search); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = db.prepare(`SELECT COUNT(*) AS total FROM referrals r ${clause}`).get(...values).total;
    const rows = db.prepare(`SELECT r.*,l.status AS listing_status FROM referrals r LEFT JOIN listings l ON l.id=r.listing_id ${clause} ORDER BY r.created_at DESC LIMIT 25 OFFSET ?`).all(...values, (query.page - 1) * 25);
    const totals = { referrals: db.prepare("SELECT COUNT(*) AS count FROM referrals").get().count, opens: 0, uniqueVisits: 0, accountCreated: 0, verified: 0, claimed: 0, published: 0 };
    const visits = db.prepare("SELECT COALESCE(SUM(opens),0) AS opens,COUNT(*) AS uniqueVisits FROM referral_visits").get();
    Object.assign(totals, visits);
    totals.accountCreated = db.prepare("SELECT COUNT(*) AS count FROM referral_events WHERE type='account_created'").get().count;
    totals.verified = db.prepare("SELECT COUNT(*) AS count FROM referral_events WHERE type='verified'").get().count;
    totals.claimed = db.prepare("SELECT COUNT(*) AS count FROM referrals WHERE claimed_by IS NOT NULL").get().count;
    totals.published = db.prepare("SELECT COUNT(DISTINCT referral_id) AS count FROM referral_events WHERE type='listing_published'").get().count;
    res.json({ referrals: rows.map((row) => serialize(row, { admin: true, req })), totals, page: query.page, pages: Math.max(1, Math.ceil(total / 25)), total });
  });
  adminRouter.post("/", limit("referral-create", 60, HOUR, (req) => req.user.id), (req, res) => {
    const input = parse(createSchema, req.body);
    checkSource(input);
    const sourceUrl = canonicalSourceUrl(input.sourceUrl);
    const sourceKey = hashToken(sourceUrl);
    const existing = db.prepare("SELECT id FROM referrals WHERE source_key=?").get(sourceKey);
    if (existing) return res.status(409).json({ error: "A referral already exists for this source post.", referralId: existing.id });
    const id = randomUUID(), value = randomToken(), timestamp = iso();
    const permalink = `${origin}/referral/${value}`;
    let draft = input.outreachDraft.replaceAll("{{link}}", permalink);
    if (draft && !draft.includes(permalink)) draft += `\n\n${permalink}`;
    db.transaction(() => {
      db.prepare("INSERT INTO referrals(id,token,source_key,source_url,source_name,author_name,author_profile_url,source_text,source_posted_at,evidence,listing_data,created_by,outreach_status,outreach_notes,outreach_draft,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, value, sourceKey, sourceUrl, input.sourceName, input.authorName, input.authorProfileUrl, input.sourceText, input.sourcePostedAt || null, JSON.stringify(input.evidence), JSON.stringify(input.listing), req.user.id, input.outreachStatus, input.outreachNotes, draft, timestamp, timestamp);
      event(id, "created", req.user.id, { sourceUrl });
      audit(req.user.id, "referral_created", id);
    })();
    res.status(201).json({ referral: serialize(byId(id), { admin: true, req }) });
  });
  adminRouter.get("/:id", (req, res) => {
    const row = byId(req.params.id);
    if (!row) throw unavailable();
    const events = db.prepare("SELECT e.*,u.name AS actor_name FROM referral_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.referral_id=? ORDER BY e.created_at DESC,e.rowid DESC LIMIT 1000").all(row.id).map((item) => ({ id: item.id, type: item.type, createdAt: item.created_at, actorId: item.actor_id, actorName: item.actor_name || null, details: JSON.parse(item.details) }));
    res.json({ referral: serialize(row, { admin: true, req }), events });
  });
  adminRouter.patch("/:id", (req, res) => {
    const row = byId(req.params.id);
    if (!row) throw unavailable();
    const input = parse(patchSchema, req.body);
    if (!Object.keys(input).length) throw new HttpError(400, "Choose a change to save.");
    if (row.claimed_by && ["sourceText", "evidence", "listing", "authorName", "authorProfileUrl"].some((key) => key in input)) throw new HttpError(409, "This draft is claimed. The student controls listing changes.");
    const merged = { sourceText: input.sourceText ?? row.source_text, evidence: input.evidence ?? JSON.parse(row.evidence), authorProfileUrl: input.authorProfileUrl ?? row.author_profile_url };
    checkSource(merged);
    let draft = input.outreachDraft === undefined ? row.outreach_draft : input.outreachDraft.replaceAll("{{link}}", link(row));
    if (draft && !draft.includes(link(row))) draft += `\n\n${link(row)}`;
    db.transaction(() => {
      db.prepare("UPDATE referrals SET source_name=?,author_name=?,author_profile_url=?,source_text=?,source_posted_at=?,evidence=?,listing_data=?,outreach_status=?,outreach_notes=?,outreach_draft=?,updated_at=? WHERE id=?").run(input.sourceName ?? row.source_name, input.authorName ?? row.author_name, merged.authorProfileUrl, merged.sourceText, input.sourcePostedAt === undefined ? row.source_posted_at : input.sourcePostedAt, JSON.stringify(merged.evidence), JSON.stringify(input.listing ?? JSON.parse(row.listing_data)), input.outreachStatus ?? row.outreach_status, input.outreachNotes ?? row.outreach_notes, draft, iso(), row.id);
      const outreach = ["outreachStatus", "outreachNotes", "outreachDraft", "note"].some((key) => key in input);
      event(row.id, outreach ? "outreach_updated" : "updated", req.user.id, { fields: Object.keys(input), ...(outreach ? { status: input.outreachStatus ?? row.outreach_status, notes: input.outreachNotes ?? row.outreach_notes, draft, note: input.note || "" } : {}) });
      audit(req.user.id, "referral_updated", row.id, { fields: Object.keys(input) });
    })();
    res.json({ referral: serialize(byId(row.id), { admin: true, req }) });
  });
  adminRouter.post("/:id/revoke", (req, res) => {
    const row = byId(req.params.id);
    if (!row) throw unavailable();
    db.transaction(() => {
      if (row.status !== "revoked") {
        db.prepare("UPDATE referrals SET status='revoked',revoked_at=?,updated_at=? WHERE id=?").run(iso(), iso(), row.id);
        event(row.id, "revoked", req.user.id, { listingId: row.listing_id, existingListingUnchanged: true });
        audit(req.user.id, "referral_revoked", row.id);
      }
    })();
    res.json({ referral: serialize(byId(row.id), { admin: true, req }) });
  });
  let uploadBusy = false;
  const admit = (req, res, next) => {
    const row = byId(req.params.id);
    if (!row || row.status !== "pending") return next(new HttpError(409, "Photos can only be added to an unclaimed, active referral."));
    if (uploadBusy) return next(new HttpError(429, "Another referral photo upload is in progress. Try again shortly."));
    uploadBusy = true;
    let released = false;
    req.releaseReferralUpload = () => { if (!released) { released = true; uploadBusy = false; } };
    req.once("aborted", () => { if (!req.referralProcessing) req.releaseReferralUpload(); });
    res.once("finish", req.releaseReferralUpload);
    res.once("close", () => { if (!req.referralProcessing) req.releaseReferralUpload(); });
    next();
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 16, fileSize: 8 * 1024 * 1024, fields: 0, parts: 16 } }).array("photos", 16);
  adminRouter.post("/:id/photos", limit("referral-photos", 60, HOUR, (req) => req.user.id), admit, upload, async (req, res) => {
    req.referralProcessing = true;
    const written = [];
    try {
      if (!req.files?.length) throw new HttpError(400, "Choose at least one photo.");
      const existing = photoRows(req.params.id);
      if (existing.length + req.files.length > 16) throw new HttpError(400, "A referral can contain up to sixteen photos.");
      const images = [];
      for (const file of req.files) images.push({ id: randomUUID(), buffer: await encodeReferralPhoto(file.buffer) });
      for (const image of images) {
        const filename = `${image.id}.webp`;
        await writeFile(join(privateDir, filename), image.buffer, { flag: "wx", mode: 0o600 });
        written.push(filename);
      }
      db.transaction(() => {
        const fresh = byId(req.params.id);
        if (!fresh || fresh.status !== "pending") throw new HttpError(409, "The referral was claimed or revoked. These photos were not added.");
        if (photoRows(fresh.id).length + images.length > 16) throw new HttpError(409, "The draft already has sixteen photos.");
        for (const image of images) db.prepare("INSERT INTO referral_photos(id,referral_id,filename,bytes,created_at) VALUES(?,?,?,?,?)").run(image.id, fresh.id, `${image.id}.webp`, image.buffer.length, iso());
        event(fresh.id, "photos_uploaded", req.user.id, { count: images.length });
        audit(req.user.id, "referral_photos_uploaded", fresh.id, { count: images.length });
      })();
      res.status(201).json({ referral: serialize(byId(req.params.id), { admin: true, req }) });
    } catch (error) {
      for (const filename of written) await unlink(join(privateDir, filename)).catch(() => {});
      throw error;
    } finally { req.releaseReferralUpload(); }
  });
  adminRouter.get("/:id/photos/:photoId", (req, res) => {
    const photo = db.prepare("SELECT * FROM referral_photos WHERE id=? AND referral_id=?").get(req.params.photoId, req.params.id);
    if (!photo) throw unavailable();
    res.type("image/webp").sendFile(join(privateDir, photo.filename));
  });
  return { publicRouter, adminRouter, privateHeaders, attributeSignup: (req, userId) => attribute(req, userId, "signup"), attributeLogin: (req, userId) => attribute(req, userId, "login"), verified, listingChanged };
}
