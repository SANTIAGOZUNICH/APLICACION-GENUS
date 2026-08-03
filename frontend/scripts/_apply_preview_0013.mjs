/**
 * Apply Preview migration 0013 only (notification deletes + planned_date_to).
 * Requires APPLY via env; refuses non-Preview hosts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const map = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    map[line.slice(0, eq)] = v;
  }
  return map;
}

const env = {
  ...loadEnv(path.join(root, ".env.local")),
  ...loadEnv(path.join(root, ".env.preview.local")),
  ...process.env,
};

let dbUrl = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!dbUrl || dbUrl === "[SENSITIVE]") {
  console.error("STOP: no Preview DB");
  process.exit(2);
}
const host = new URL(dbUrl).hostname;
if (!host.includes("polished-recipe")) {
  console.error("STOP: not Preview host", host.replace(/ep-[a-z]+-[a-z]+-/, "ep-***-"));
  process.exit(2);
}

const r = spawnSync(process.execPath, [path.join(__dirname, "migrate-if-database.mjs")], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...env,
    DATABASE_URL: dbUrl,
    DATABASE_URL_UNPOOLED: dbUrl.includes("-pooler")
      ? dbUrl.replace("-pooler", "")
      : dbUrl,
    APPLY_MIGRATION_0005: "1",
    APPLY_MIGRATION_0006: "1",
    APPLY_MIGRATION_0007: "1",
    APPLY_MIGRATION_0008: "1",
    APPLY_MIGRATION_0009: "1",
    APPLY_MIGRATION_0010: "1",
    APPLY_MIGRATION_0011: "1",
    APPLY_MIGRATION_0012: "1",
    APPLY_MIGRATION_0013: "1",
  },
});
console.log(r.stdout || "");
console.error(r.stderr || "");
process.exit(r.status ?? 1);
