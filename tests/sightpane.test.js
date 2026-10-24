import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";

const run = promisify(execFile);
const ORIGIN = "http://127.0.0.1:4742";

async function setup(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "handoff-mcp-"));
  const app = createApp({ dataDir, mailTransport: null, origin: ORIGIN, aiClient: null });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    app.locals.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const token = async (...args) =>
    (await run(process.execPath, ["server/mcp-token.js", ...args], { env: { ...process.env, HANDOFF_DATA_DIR: dataDir } })).stdout.trim();
  const post = (body, { auth, surface = "internal" } = {}) =>
    fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(surface ? { "X-Handoff-Surface": surface } : {}),
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(body),
    });
  return { db: app.locals.db, dataDir, token, post };
}

function seed(db) {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  const user = (email, verified) => {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO users (id,name,email,password_hash,verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ).run(id, "Test Student", email, "x", verified ? now : null, now, now);
    return id;
  };
  const owner = user("owner@usc.edu", true);
  const other = user("other@usc.edu", false);
  const listing = (title, status) => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO listings (id,owner_id,campus_id,title,description,address,lat,lng,price,deposit,bedrooms,bathrooms,room_type,
        available_from,available_to,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, owner, "usc", title, "d", "a", 34, -118, 1450, 0, 1, 1, "private", now.slice(0, 10), later, status, now, now);
    return id;
  };
  const live = listing("Sunny room near campus", "active");
  listing("Draft room", "draft");
  db.prepare(
    "INSERT INTO handoff_requests (id,listing_id,requester_id,message,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
  ).run(randomUUID(), live, other, "hi", "pending", now, now);
  db.prepare(
    "INSERT INTO reports (id,listing_id,reporter_id,reason,details,status,created_at) VALUES (?,?,?,?,?,?,?)",
  ).run(randomUUID(), live, other, "spam", "private report text", "open", now);
  return live;
}

test("the MCP needs a token, lives on the internal host only, and returns counts", async (t) => {
  const { db, dataDir, token, post } = await setup(t);
  const live = seed(db);
  const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  assert.equal((await post(list)).status, 401, "no token file means no access");
  const secret = await token("new", "sightpane");
  assert.match(secret, /^hof_/);
  const file = join(dataDir, "mcp-tokens.json");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.ok(!(await readFile(file, "utf8")).includes(secret), "only the hash is stored");

  assert.equal((await post(list)).status, 401);
  assert.equal((await post(list, { auth: "hof_wrong" })).status, 401);
  assert.notEqual((await post(list, { auth: secret, surface: "" })).status, 200, "not on the app host");
  assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { auth: secret })).status, 202);

  const tools = await (await post(list, { auth: secret })).json();
  assert.deepEqual(tools.result.tools.map((x) => x.name), ["sightpane_overview"]);
  const call = await (
    await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "sightpane_overview", arguments: {} } }, { auth: secret })
  ).json();
  const o = call.result.structuredContent;
  const m = Object.fromEntries(o.metrics.map((x) => [x.label, x.value]));
  assert.equal(m.Students, 2);
  assert.equal(o.metrics.length, 4);
  assert.equal(m["Live listings"], 1);
  assert.equal(m["Pending requests"], 1);
  assert.equal(m["Open reports"], 1);
  assert.equal(o.status, "warn");
  assert.match(o.note, /1 open report needs review/);
  assert.deepEqual(o.items.map((x) => x.href), [`https://app.handofflease.com/listings/${live}`]);
  const text = JSON.stringify(o);
  for (const secretish of ["owner@usc.edu", "Test Student", "private report text"]) assert.ok(!text.includes(secretish), secretish);

  await token("revoke", "sightpane");
  assert.equal((await post(list, { auth: secret })).status, 401);
});
