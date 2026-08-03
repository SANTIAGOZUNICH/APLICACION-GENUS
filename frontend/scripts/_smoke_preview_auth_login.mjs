/**
 * Smoke login against Preview Neon Auth tables (local process, not HTTP).
 * Does not print passwords. Requires .env.preview.db.local + .env.auth.seed.local.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { neon } from "@neondatabase/serverless";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

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
  const [u, d] = String(email).split("@");
  return d ? `${u.slice(0, 1)}***@${d}` : "***";
}

const fileEnv = {
  ...loadEnv(path.join(root, ".env.preview.db.local")),
  ...loadEnv(path.join(root, ".env.auth.seed.local")),
};
Object.assign(process.env, fileEnv, {
  GENUS_AUTH_BACKEND: "neon",
  VERCEL_ENV: "preview",
});

const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "").trim();
if (!url || !new URL(url).hostname.includes("polished-recipe")) {
  console.error("Preview DATABASE_URL required");
  process.exit(1);
}

// Dynamic import of compiled TS via tsx is heavy; use bcrypt + SQL smoke instead.
const bcrypt = require("bcryptjs");
const sql = neon(url);

const cases = [
  ["elaboracion@laboratoriogenus.com.ar", "GENUS_AUTH_PASSWORD_ELABORACION", "ELABORACION"],
  ["calidad@laboratoriogenus.com.ar", "GENUS_AUTH_PASSWORD_CALIDAD", "CALIDAD"],
  ["produccion@laboratoriogenus.com.ar", "GENUS_AUTH_PASSWORD_PRODUCCION", "PRODUCCION"],
  ["mp@laboratoriogenus.com.ar", "GENUS_AUTH_PASSWORD_MATERIA_PRIMA", "MATERIA_PRIMA"],
  ["deposito@laboratoriogenus.com.ar", "GENUS_AUTH_PASSWORD_DEPOSITO", "DEPOSITO"],
  ["emasivo@laboratoriogenus.com.ar", "GENUS_AUTH_PASSWORD_ENVASADO_MASIVO", "ENVASADO_MASIVO"],
  ["epremium@laboratoriogenus.com.ar", "GENUS_AUTH_PASSWORD_ENVASADO_PREMIUM", "ENVASADO_PREMIUM"],
  ["codificado@laboratoriogenus.com.ar", "GENUS_AUTH_PASSWORD_CODIFICADO", "CODIFICADO"],
];

const results = [];
for (const [email, envName, sector] of cases) {
  const password = process.env[envName];
  const rows = await sql`
    SELECT id, email, sector, status, password_hash
    FROM genus_auth_users
    WHERE email_normalized = ${email.toLowerCase()}
    LIMIT 1
  `;
  const user = rows[0];
  if (!user) {
    results.push({ email: maskEmail(email), sector, ok: false, reason: "missing_user" });
    continue;
  }
  const hashOk = password ? await bcrypt.compare(password, user.password_hash) : false;
  results.push({
    email: maskEmail(email),
    sector: user.sector,
    status: user.status,
    ok: hashOk && user.sector === sector && user.status === "ACTIVO",
    hashOk,
  });
}

const formulas = (
  await sql`
    SELECT
      (SELECT count(*)::int FROM formula_versions) AS versions,
      (SELECT count(*)::int FROM formula_versions WHERE status = 'VIGENTE') AS vigentes
  `
)[0];

const report = {
  ok: results.every((r) => r.ok) && formulas.versions === 842 && formulas.vigentes === 784,
  results,
  formulas,
  migration0014: "not_touched",
  production: false,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
