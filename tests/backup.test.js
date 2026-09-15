import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { openDatabase } from "../server/database.js";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "handoff-backup-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, "data");
  const backups = join(root, "backups");
  const db = openDatabase(data);
  return { root, data, backups, db };
}
function backup({ data, backups }) {
  return spawnSync(process.execPath, [resolve("deploy/backup.mjs")], {
    env: { ...process.env, HANDOFF_DATA_DIR: data, HANDOFF_BACKUP_DIR: backups },
    encoding: "utf8",
  });
}

test("current schema backup restores original lease data and its matched photo archive", (t) => {
  const f = fixture(t);
  const filename = "00000000-0000-4000-8000-000000000001.webp";
  const photo = Buffer.from("immutable photo fixture");
  f.db.exec(`
    INSERT INTO users(id,name,email,campus_id,password_hash,created_at,updated_at)
      VALUES('owner','Backup fixture','backup@example.test','usc','fixture','2026-09-14','2026-09-14');
    INSERT INTO listings(id,owner_id,campus_id,title,description,address,lat,lng,price,deposit,
      bedrooms,bathrooms,room_type,available_from,available_to,status,original_price,photos,created_at,updated_at)
      VALUES('listing','owner','usc','Fixture','Fixture','Fixture',34.0224,-118.2851,1000,0,
      1,1,'private','2027-01-01','2027-06-01','active',1400,'["/uploads/${filename}"]','2026-09-14','2026-09-14');
  `);
  f.db.prepare("INSERT INTO uploads(id,owner_id,filename,bytes,created_at) VALUES(?,?,?,?,?)")
    .run("photo", "owner", filename, photo.length, "2026-09-14");
  writeFileSync(join(f.data, "uploads", filename), photo);
  f.db.close();
  const result = backup(f);
  assert.equal(result.status, 0, result.stderr);
  const completed = JSON.parse(result.stdout);
  const manifest = JSON.parse(readFileSync(completed.manifest, "utf8"));
  assert.equal(manifest.schemaVersion, 13);
  assert.equal(manifest.uploads.count, 1);
  for (const item of [manifest.database, manifest.uploads])
    assert.equal(createHash("sha256").update(readFileSync(join(completed.directory, item.file))).digest("hex"), item.sha256);
  const restored = new Database(completed.database, { readonly: true });
  assert.equal(restored.pragma("quick_check", { simple: true }), "ok");
  assert.equal(restored.prepare("SELECT original_price FROM listings WHERE id='listing'").get().original_price, 1400);
  restored.close();
  const restoredPhotos = join(f.root, "restored");
  mkdirSync(restoredPhotos);
  execFileSync("/usr/bin/tar", ["-xzf", completed.uploads, "-C", restoredPhotos]);
  assert.deepEqual(readFileSync(join(restoredPhotos, "uploads", filename)), photo);
});

test("backup still rejects an unknown future database schema", (t) => {
  const f = fixture(t);
  f.db.pragma("user_version = 14");
  f.db.close();
  const result = backup(f);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /recognized Handoff database schema/);
  assert.equal(result.stdout.trim(), "");
});

test("the contacts-only schema12 backs up and upgrades to referrals13 without changing saved contact preferences", (t) => {
  const f = fixture(t);
  f.db.exec(`
    DROP TABLE referral_events; DROP TABLE referral_attributions; DROP TABLE referral_visits;
    DROP TABLE referral_photos; DROP TABLE referrals; PRAGMA user_version=12;
    INSERT INTO users(id,name,email,campus_id,password_hash,phone,instagram,facebook,share_channels,created_at,updated_at)
      VALUES('contacts-owner','Preserved account','contacts@usc.edu','usc','unchanged-fixture',
      '+12135550142','fixture.student','https://www.facebook.com/fixture.student','["email","phone"]','2026-09-14','2026-09-14');
  `);
  const before = f.db.prepare("SELECT * FROM users WHERE id='contacts-owner'").get();
  f.db.close();
  const snapshot = backup(f);
  assert.equal(snapshot.status, 0, snapshot.stderr);
  const files = JSON.parse(snapshot.stdout);
  assert.equal(JSON.parse(readFileSync(files.manifest, "utf8")).schemaVersion, 12);
  const saved = new Database(files.database, { readonly: true });
  assert.deepEqual(saved.prepare("SELECT * FROM users WHERE id='contacts-owner'").get(), before);
  saved.close();
  const upgraded = openDatabase(f.data);
  try {
    assert.equal(upgraded.pragma("user_version", { simple: true }), 13);
    assert.deepEqual(upgraded.prepare("SELECT * FROM users WHERE id='contacts-owner'").get(), before);
    assert.equal(upgraded.prepare("SELECT COUNT(*) AS n FROM referrals").get().n, 0);
    assert.ok(upgraded.prepare("PRAGMA table_info(handoff_requests)").all().some((column) => column.name === "share_channels"));
    assert.equal(upgraded.pragma("quick_check", { simple: true }), "ok");
    assert.deepEqual(upgraded.pragma("foreign_key_check"), []);
  } finally { upgraded.close(); }
});

test("a schema11 database adds exact contacts defaults before the referral migration", (t) => {
  const f = fixture(t);
  f.db.exec(`
    DROP TABLE referral_events; DROP TABLE referral_attributions; DROP TABLE referral_visits;
    DROP TABLE referral_photos; DROP TABLE referrals;
    ALTER TABLE users DROP COLUMN phone; ALTER TABLE users DROP COLUMN instagram;
    ALTER TABLE users DROP COLUMN facebook; ALTER TABLE users DROP COLUMN share_channels;
    ALTER TABLE handoff_requests DROP COLUMN share_channels; PRAGMA user_version=11;
    INSERT INTO users(id,name,email,campus_id,password_hash,created_at,updated_at)
      VALUES('legacy-owner','Existing student','legacy@usc.edu','usc','unchanged-fixture','2026-09-14','2026-09-14');
  `);
  f.db.close();
  const upgraded = openDatabase(f.data);
  try {
    assert.equal(upgraded.pragma("user_version", { simple: true }), 13);
    assert.deepEqual(upgraded.prepare("SELECT phone,instagram,facebook,share_channels FROM users WHERE id='legacy-owner'").get(),
      { phone: null, instagram: null, facebook: null, share_channels: '["email"]' });
    assert.equal(upgraded.prepare("SELECT COUNT(*) AS n FROM referrals").get().n, 0);
  } finally { upgraded.close(); }
});
