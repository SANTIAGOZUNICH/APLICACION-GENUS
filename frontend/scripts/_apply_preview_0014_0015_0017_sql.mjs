/**
 * Apply 0014→0015→0017 SQL directly on Preview (same path as successful dry-run).
 * Also records hashes in __drizzle_migrations if possible.
 * NEVER Production.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW_HOST_MARKER = "polished-recipe";
const FILES = [
  { tag: "0014_codificado_deposito_graneles", file: "drizzle/0014_codificado_deposito_graneles.sql" },
  { tag: "0015_creamy_memory", file: "drizzle/0015_creamy_memory.sql" },
  { tag: "0017_creamy_userid_notif_idempotency", file: "drizzle/0017_creamy_userid_notif_idempotency.sql" },
];

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value && value !== "[SENSITIVE]") out[line.slice(0, i).trim()] = value;
  }
  return out;
}

const env = { ...process.env, ...loadEnv(path.join(root, ".env.preview.db.local")) };
const url = (env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || "").trim();
if (!url) throw new Error("Missing Preview DATABASE_URL");
const host = new URL(url).hostname;
if (!host.includes(PREVIEW_HOST_MARKER) || /prod|production/i.test(host)) {
  throw new Error("Refusing non-Preview host");
}

const sql = neon(url);

async function applyFile(relativePath) {
  const statements = fs
    .readFileSync(path.join(root, relativePath), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/^\s*\/\*[\s\S]*?\*\//, "").trim())
    .filter(Boolean);
  for (const statement of statements) {
    await sql.query(statement);
  }
  return statements.length;
}

const before = await sql`
  SELECT
    to_regclass('public.deposito_graneles') IS NOT NULL AS deposito,
    to_regclass('public.creamy_user_memories') IS NOT NULL AS creamy,
    (SELECT count(*)::int FROM formula_versions) AS versions,
    (SELECT count(*)::int FROM formula_versions WHERE status='VIGENTE') AS vigentes
`;

const applied = [];
for (const item of FILES) {
  const count = await applyFile(item.file);
  const body = fs.readFileSync(path.join(root, item.file), "utf8");
  const hash = createHash("sha256").update(body).digest("hex");
  // Best-effort journal record (Drizzle meta table).
  try {
    await sql`
      INSERT INTO "__drizzle_migrations" ("hash", "created_at")
      VALUES (${hash}, ${Date.now()})
      ON CONFLICT DO NOTHING
    `;
  } catch {
    // table shape may differ; schema apply is source of truth
  }
  applied.push({ tag: item.tag, statements: count });
}

// idempotent re-run
for (const item of FILES) {
  await applyFile(item.file);
}

const after = await sql`
  SELECT
    to_regclass('public.deposito_graneles') IS NOT NULL AS deposito,
    to_regclass('public.creamy_user_memories') IS NOT NULL AS creamy,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='creamy_user_memories' AND column_name='user_id'
    ) AS creamy_user_id,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='work_items' AND column_name='via_codificado'
    ) AS via_codificado,
    (SELECT count(*)::int FROM formula_versions) AS versions,
    (SELECT count(*)::int FROM formula_versions WHERE status='VIGENTE') AS vigentes
`;

const report = {
  ok:
    after[0].deposito &&
    after[0].creamy &&
    after[0].creamy_user_id &&
    after[0].via_codificado &&
    after[0].versions === 842 &&
    after[0].vigentes === 784,
  hostAnon: `${host.split(".")[0].replace(/-pooler$/, "").split("-").slice(0, 3).join("-")}-***`,
  before: before[0],
  applied,
  after: after[0],
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
