/**
 * Seed Genus Auth users on Preview only.
 * Loads .env.preview.db.local + .env.auth.seed.local (both gitignored).
 * Never prints password values.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

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

function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

const env = {
  ...process.env,
  ...loadEnv(path.join(root, ".env.preview.db.local")),
  ...loadEnv(path.join(root, ".env.auth.seed.local")),
  APPLY_AUTH_SEED: "1",
  VERCEL_ENV: "preview",
};

const url = (env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || "").trim();
if (!url) {
  console.error("Missing Preview DATABASE_URL");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!host.includes(PREVIEW_HOST_MARKER) || /prod|production/i.test(host)) {
  console.error("Refusing non-Preview / Production host");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["scripts/seed-genus-auth.mjs"], {
  cwd: root,
  env,
  encoding: "utf8",
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

const sql = neon(url);
const rows = await sql`
  SELECT email, sector, status
  FROM genus_auth_users
  ORDER BY sector
`;
console.log(
  JSON.stringify(
    {
      ok: true,
      userCount: rows.length,
      accounts: rows.map((row) => ({
        email: maskEmail(row.email),
        sector: row.sector,
        status: row.status,
      })),
      formulas: (
        await sql`
          SELECT
            (SELECT count(*)::int FROM formula_versions) AS versions,
            (SELECT count(*)::int FROM formula_versions WHERE status = 'VIGENTE') AS vigentes
        `
      )[0],
    },
    null,
    2
  )
);
