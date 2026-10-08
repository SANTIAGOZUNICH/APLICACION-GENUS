/**
 * Prepara una base de PRUEBA para el E2E: migraciones reales (./drizzle) + marca + usuarios de prueba.
 *
 *   GENUS_E2E_CONFIRM_DISPOSABLE_DB=yes GENUS_E2E_DATABASE_URL=postgres://u:p@localhost/genus_e2e \
 *   NODE_EXTRA_CA_CERTS=.e2e-local/certs/ca-bundle.pem node scripts/e2e/setup-e2e-db.mjs
 *
 * - Pasa por las guardas de scripts/e2e/e2e-safety.mjs (nunca Vercel/producción, base local, confirmación).
 * - Base VACÍA → aplica todas las migraciones y crea la marca `genus_e2e_marker`.
 *   Base con marca → aplica solo las migraciones nuevas (por hash). Base con tablas y SIN marca → aborta.
 * - Cada sentencia corre en su propia transacción (como en Neon): algunas migraciones agregan valores a un
 *   enum y los usan en la siguiente sentencia, lo que Postgres no permite dentro de una sola transacción.
 * - Se conecta con el mismo driver que la app (`@neondatabase/serverless`), vía scripts/e2e/local-pg-wsproxy.mjs.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertE2eEnvironment, assertMarkedDatabase, E2E_MARKER_TABLE } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
const { hash } = require("bcryptjs");
neonConfig.webSocketConstructor = require("ws");

process.on("uncaughtException", (err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

assertE2eEnvironment();

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;

try {
  const publicTables = await q("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
  const hasMarker = Boolean((await q(`select to_regclass('public.${E2E_MARKER_TABLE}') as reg`))[0]?.reg);
  if (!hasMarker && publicTables[0].n > 0) {
    throw new Error(
      `[setup-e2e-db] la base tiene ${publicTables[0].n} tablas y NO tiene la marca ${E2E_MARKER_TABLE}: ` +
        "no es una base de prueba vacía. Abortado sin escribir nada."
    );
  }
  if (!hasMarker) {
    await q(`create table ${E2E_MARKER_TABLE} (purpose text not null, created_at timestamptz not null default now())`);
    await q(`insert into ${E2E_MARKER_TABLE} (purpose) values ('genus-e2e-disposable')`);
    console.log(`[setup-e2e-db] base vacía → marca ${E2E_MARKER_TABLE} creada`);
  }
  await assertMarkedDatabase(q);

  await q('create schema if not exists "drizzle"');
  await q('create table if not exists "drizzle"."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)');
  const applied = new Set((await q('select hash from "drizzle"."__drizzle_migrations"')).map((r) => r.hash));
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"));
  let count = 0;
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    if (applied.has(digest)) continue;
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (!statement.trim()) continue;
      try {
        await q(statement);
      } catch (err) {
        throw new Error(`[setup-e2e-db] ${entry.tag}: ${err.message}`);
      }
    }
    await q('insert into "drizzle"."__drizzle_migrations" (hash, created_at) values ($1, $2)', [digest, entry.when]);
    count += 1;
  }
  console.log(`[setup-e2e-db] migraciones aplicadas ahora: ${count} (journal: ${journal.entries.length}, última ${journal.entries.at(-1).tag})`);

  const passwordHash = await hash(E2E_PASSWORD, 10);
  for (const u of Object.values(E2E_USERS)) {
    await q(
      `insert into genus_auth_users (email, email_normalized, display_name, sector, role_id, role_label, sector_label, job_title, status, password_hash, redirect_to)
       values ($1, $1, $2, $3, $4, $5, $6, 'E2E', 'ACTIVO', $7, '/plan-semanal')
       on conflict (email_normalized) do update set password_hash = excluded.password_hash, status = 'ACTIVO'`,
      [u.email, u.displayName, u.sector, u.role, u.roleLabel, u.sectorLabel, passwordHash]
    );
  }
  console.log(`[setup-e2e-db] usuarios de prueba: ${Object.values(E2E_USERS).map((u) => u.email).join(", ")}`);
} finally {
  await pool.end();
}
