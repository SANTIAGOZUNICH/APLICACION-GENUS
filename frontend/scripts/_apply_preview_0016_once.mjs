/**
 * Apply drizzle/0016_genus_auth.sql to Preview Neon only.
 * Requires .env.preview.db.local (from _resolve_preview_db_via_neon_api.mjs)
 * and APPLY_MIGRATION_0016=1 (set by this script).
 * Never targets Production.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW_HOST_MARKER = "polished-recipe";

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value && value !== "[SENSITIVE]") out[key] = value;
  }
  return out;
}

const env = {
  ...process.env,
  ...loadEnv(path.join(root, ".env.preview.db.local")),
  APPLY_MIGRATION_0016: "1",
};

const url = (env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || "").trim();
if (!url) {
  console.error("Missing Preview DATABASE_URL — run _resolve_preview_db_via_neon_api.mjs first");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!host.includes(PREVIEW_HOST_MARKER)) {
  console.error("Refusing non-Preview host");
  process.exit(1);
}
if (/prod|production/i.test(host)) {
  console.error("Refusing Production-looking host");
  process.exit(1);
}

console.log(
  JSON.stringify({
    action: "apply_0016_preview",
    hostAnon: `${host.split(".")[0].replace(/-pooler$/, "").split("-").slice(0, 3).join("-")}-***`,
  })
);

const result = spawnSync(process.execPath, ["scripts/migrate-if-database.mjs"], {
  cwd: root,
  env,
  encoding: "utf8",
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
