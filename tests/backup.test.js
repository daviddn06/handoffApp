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
  assert.equal(manifest.schemaVersion, 7);
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
  f.db.pragma("user_version = 9");
  f.db.close();
  const result = backup(f);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /recognized Handoff database schema/);
  assert.equal(result.stdout.trim(), "");
});
