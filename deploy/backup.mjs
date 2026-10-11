import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

process.umask(0o077);
const execute = promisify(execFile);
const data = resolve(process.env.HANDOFF_DATA_DIR || "/var/lib/handoff");
const destination = resolve(
  process.env.HANDOFF_BACKUP_DIR || "/var/backups/handoff",
);
const createdAt = new Date().toISOString();
const identifier = `handoff-${createdAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const staging = join(destination, `.${identifier}.partial`);
const completed = join(destination, identifier);
const databaseFile = join(staging, "handoff.sqlite");
const archiveFile = join(staging, "uploads.tar.gz");
const listFile = join(staging, "uploads.files");

async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

await mkdir(destination, { recursive: true, mode: 0o700 });
await mkdir(staging, { mode: 0o700 });
let source;
let snapshot;
try {
  // A mistyped data directory must never produce a successful empty backup.
  source = new Database(join(data, "handoff.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  source.pragma("busy_timeout = 5000");
  await source.backup(databaseFile);
  source.close();
  source = null;
  await chmod(databaseFile, 0o600);
  snapshot = new Database(databaseFile, {
    readonly: true,
    fileMustExist: true,
  });
  const integrity = snapshot.pragma("quick_check", { simple: true });
  if (integrity !== "ok")
    throw new Error("SQLite backup failed its integrity check.");
  const schemaVersion = snapshot.pragma("user_version", { simple: true });
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].includes(schemaVersion))
    throw new Error("Backup requires a recognized Handoff database schema.");
  const uploads = snapshot
    .prepare("SELECT filename,bytes FROM uploads ORDER BY filename")
    .all();
  const privatePhotos = schemaVersion >= 13
    ? snapshot.prepare("SELECT filename,bytes FROM referral_photos ORDER BY filename").all()
    : [];
  for (const photo of privatePhotos) {
    if (!/^[a-f0-9-]{36}\.webp$/.test(photo.filename)) throw new Error("Unexpected private referral photo filename.");
    uploads.push({ filename: `referrals/${photo.filename}`, bytes: photo.bytes });
  }
  const hasAvatar = snapshot.prepare("PRAGMA table_info(users)").all().some((column) => column.name === "avatar");
  const avatars = hasAvatar ? snapshot.prepare("SELECT DISTINCT avatar FROM users WHERE avatar IS NOT NULL AND avatar!=''").all() : [];
  for (const row of avatars) {
    if (!/^\/avatars\/[a-f0-9-]{36}\.jpg$/.test(row.avatar)) throw new Error("Unexpected profile photo path.");
    const filename = row.avatar.slice("/avatars/".length);
    const info = await lstat(join(data, "uploads", filename));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("A profile photo is missing or unsafe.");
    uploads.push({ filename, bytes: info.size });
  }
  const requiredPhotos = snapshot
    .prepare(
      "SELECT DISTINCT p.value AS path FROM listings l,json_each(l.photos) p",
    )
    .all();
  const knownPhotos = new Set(
    uploads.map((file) => `/uploads/${file.filename}`),
  );
  if (requiredPhotos.some((photo) => !knownPhotos.has(photo.path)))
    throw new Error(
      "A listing references a photo absent from the upload registry.",
    );
  snapshot.close();
  snapshot = null;

  const uploadDirectory = await lstat(join(data, "uploads"));
  if (!uploadDirectory.isDirectory() || uploadDirectory.isSymbolicLink())
    throw new Error("The upload source must be a real directory.");
  if (privatePhotos.length) {
    const directory = await lstat(join(data, "uploads", "referrals"));
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("The referral photo directory is unsafe.");
  }
  for (const file of uploads) {
    if (!/^(?:[a-f0-9-]{36}\.(?:webp|jpg)|referrals\/[a-f0-9-]{36}\.webp)$/.test(file.filename))
      throw new Error("Unexpected filename in the upload registry.");
    let metadata;
    // Upload rows reserve storage immediately before immutable photo files are written.
    // Allow a just-started write to finish, but never label an incomplete snapshot successful.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        metadata = await lstat(join(data, "uploads", file.filename));
        if (metadata.size === file.bytes) break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await delay(100);
    }
    if (
      !metadata?.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size !== file.bytes
    )
      throw new Error(
        `A registered photo is missing, unsafe, or incomplete: ${file.filename}`,
      );
  }

  // Files are immutable. Select the exact database snapshot's files, avoiding a moving directory archive.
  const members = [
    "uploads",
    ...(privatePhotos.length ? ["uploads/referrals"] : []),
    ...uploads.map((file) => `uploads/${file.filename}`),
  ];
  await writeFile(listFile, `${members.join("\0")}\0`, {
    flag: "wx",
    mode: 0o600,
  });
  await execute(
    "/usr/bin/tar",
    [
      "--no-recursion",
      "-czf",
      archiveFile,
      "-C",
      data,
      "--null",
      "-T",
      listFile,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  await chmod(archiveFile, 0o600);
  const archiveListing = await execute("/usr/bin/tar", ["-tzf", archiveFile], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const actualMembers = archiveListing.stdout
    .trim()
    .split("\n")
    .map((name) => name.replace(/\/$/, ""))
    .sort();
  if (JSON.stringify(actualMembers) !== JSON.stringify([...members].sort()))
    throw new Error("The image archive does not match the database snapshot.");
  const [databaseStats, archiveStats, databaseHash, archiveHash] =
    await Promise.all([
      stat(databaseFile),
      stat(archiveFile),
      digest(databaseFile),
      digest(archiveFile),
    ]);
  const manifest = {
    formatVersion: 1,
    createdAt,
    schemaVersion,
    integrity,
    database: {
      file: "handoff.sqlite",
      bytes: databaseStats.size,
      sha256: databaseHash,
    },
    uploads: {
      file: "uploads.tar.gz",
      bytes: archiveStats.size,
      sha256: archiveHash,
      count: uploads.length,
      referralPhotos: privatePhotos.length,
      avatars: avatars.length,
      imageBytes: uploads.reduce((sum, file) => sum + file.bytes, 0),
    },
    fileList: "uploads.files",
    restore:
      "Stop Handoff. Verify both SHA-256 hashes. Preserve the existing data directory. Restore this database and this upload archive together, set private Handoff ownership, and start a schema-compatible release.",
  };
  await writeFile(
    join(staging, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  // Only this atomic completion rename makes the set eligible for restore.
  await rename(staging, completed);
  console.log(
    JSON.stringify({
      ok: true,
      directory: completed,
      manifest: join(completed, "manifest.json"),
      database: join(completed, "handoff.sqlite"),
      uploads: join(completed, "uploads.tar.gz"),
      schemaVersion,
    }),
  );
} catch (error) {
  console.error(
    `Handoff backup failed. Incomplete files remain at ${staging}. ${error.message}`,
  );
  process.exitCode = 1;
} finally {
  if (source?.open) source.close();
  if (snapshot?.open) snapshot.close();
}
