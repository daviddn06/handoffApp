/**
 * A read only summary of Handoff for an MCP client, answered on the internal
 * host only.
 *
 *   POST https://internal.handofflease.com/mcp
 *   Authorization: Bearer <token>
 *   body: one JSON-RPC message, answered with one JSON reply (202 for a notification)
 *
 * The one tool, sightpane_overview, returns
 *   { metrics: [{ label, value, unit?, href? }], items?: [{ title, subtitle?, href?, at? }],
 *     status?: 'ok' | 'warn' | 'down', note? }
 * Counts and public listing titles only, never a student's name, email or
 * report text. Tokens are checked against mcp-tokens.json in the data
 * directory, which holds only sha256 hashes and is written by
 * server/mcp-token.js. No token file, no access.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = "https://app.handofflease.com";
const INTERNAL = "https://internal.handofflease.com";

export const TOOL = {
  name: "sightpane_overview",
  description:
    "Read only summary of Handoff. Students, verified students, live listings, pending requests, open reports, waitlist and signups over 7 days, the newest live listings, a status and a note. Counts and public listing titles only.",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true },
};

export function sightpaneOverview(db) {
  const count = (sql, ...args) => {
    try {
      return Number(db.prepare(sql).get(...args)?.count || 0);
    } catch {
      return 0;
    }
  };
  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const reportsOpen = count("SELECT COUNT(*) AS count FROM reports WHERE status='open'");
  const pending = count("SELECT COUNT(*) AS count FROM handoff_requests WHERE status='pending'");
  const newest = db
    .prepare(
      "SELECT id, title, price, created_at FROM listings WHERE status='active' AND available_to>=? ORDER BY created_at DESC LIMIT 5",
    )
    .all(now.slice(0, 10));
  const notes = [];
  if (reportsOpen)
    notes.push(`${reportsOpen} open ${reportsOpen === 1 ? "report needs" : "reports need"} review`);
  return {
    metrics: [
      { label: "Students", value: count("SELECT COUNT(*) AS count FROM users"), href: `${INTERNAL}/users` },
      { label: "Verified students", value: count("SELECT COUNT(*) AS count FROM users WHERE verified_at IS NOT NULL"), href: `${INTERNAL}/users` },
      { label: "Signups, 7 days", value: count("SELECT COUNT(*) AS count FROM users WHERE created_at>=?", weekAgo), href: `${INTERNAL}/users` },
      { label: "Live listings", value: count("SELECT COUNT(*) AS count FROM listings WHERE status='active' AND available_to>=?", now.slice(0, 10)), href: `${INTERNAL}/listings` },
      { label: "Pending requests", value: pending, href: `${INTERNAL}/requests` },
      { label: "Open reports", value: reportsOpen, href: `${INTERNAL}/reports` },
      { label: "Waitlist", value: count("SELECT COUNT(*) AS count FROM waitlist"), href: `${INTERNAL}/waitlist` },
    ],
    items: newest.map((l) => ({
      title: l.title,
      subtitle: `$${Number(l.price).toLocaleString("en-US")} a month`,
      href: `${APP}/listings/${l.id}`,
      at: l.created_at,
    })),
    status: reportsOpen ? "warn" : "ok",
    ...(notes.length ? { note: `${notes.join(". ")}.` } : {}),
  };
}

/** The name of the token this request carries, or null. */
export function tokenName(req, dataDir) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(req.get("Authorization") || ""));
  if (!m) return null;
  let list;
  try {
    list = JSON.parse(readFileSync(join(dataDir, "mcp-tokens.json"), "utf8"));
  } catch {
    return null;
  }
  const hash = createHash("sha256").update(m[1]).digest();
  for (const t of Array.isArray(list) ? list : []) {
    const b = Buffer.from(String(t.hash || ""), "hex");
    if (b.length === hash.length && timingSafeEqual(b, hash)) return String(t.name || "token");
  }
  return null;
}

/** Express handler for POST /mcp. */
export function sightpaneMcp({ db, dataDir }) {
  const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  return (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!tokenName(req, dataDir))
      return res
        .status(401)
        .set("WWW-Authenticate", "Bearer")
        .json(rpcError(null, -32001, "Send Authorization: Bearer <token>"));
    const msg = req.body;
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.method !== "string")
      return res.status(400).json(rpcError(null, -32600, "invalid request"));
    if (msg.id === undefined || msg.id === null) return res.status(202).end();
    const reply = (result) => res.json({ jsonrpc: "2.0", id: msg.id, result });
    if (msg.method === "initialize")
      return reply({
        protocolVersion: msg.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "handoff", version: "1.0.0" },
        instructions: "Handoff, the student sublease marketplace. One read only tool, sightpane_overview.",
      });
    if (msg.method === "ping") return reply({});
    if (msg.method === "tools/list") return reply({ tools: [TOOL] });
    if (msg.method === "tools/call") {
      if (msg.params?.name !== TOOL.name)
        return res.json(rpcError(msg.id, -32602, `unknown tool ${msg.params?.name}`));
      const out = sightpaneOverview(db);
      return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 1) }], structuredContent: out });
    }
    return res.json(rpcError(msg.id, -32601, `method not found: ${msg.method}`));
  };
}
