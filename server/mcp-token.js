/**
 * Tokens for the read only MCP at https://internal.handofflease.com/mcp.
 *
 *   node server/mcp-token.js new <name>      prints a new token once, replaces any token with that name
 *   node server/mcp-token.js list            names and dates, never the tokens
 *   node server/mcp-token.js revoke <name>   that token stops working at once
 *
 * Needs HANDOFF_DATA_DIR. Only a sha256 hash of each token is kept, in
 * mcp-tokens.json in the data directory (mode 600). The token itself is shown
 * once and stored nowhere.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

if (!process.env.HANDOFF_DATA_DIR) throw new Error("Set HANDOFF_DATA_DIR to the data directory.");
const file = join(resolve(process.env.HANDOFF_DATA_DIR), "mcp-tokens.json");
const [command, name] = process.argv.slice(2);
const load = () => {
  try {
    const list = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};
const save = (list) => {
  writeFileSync(file, `${JSON.stringify(list, null, 1)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
};

if (command === "new" && /^[\w.-]{1,40}$/.test(name || "")) {
  const token = `hof_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(token).digest("hex");
  save([...load().filter((t) => t.name !== name), { name, hash, created_at: new Date().toISOString() }]);
  console.log(token);
  console.error(`Token "${name}" saved (hash only). It is shown this once.`);
} else if (command === "list") {
  for (const t of load()) console.log(`${t.name}\t${t.created_at}`);
} else if (command === "revoke" && name) {
  const list = load();
  const left = list.filter((t) => t.name !== name);
  save(left);
  console.error(list.length === left.length ? `No token named "${name}".` : `Token "${name}" revoked.`);
} else {
  console.error("Usage: node server/mcp-token.js new <name> | list | revoke <name>");
  process.exit(1);
}
