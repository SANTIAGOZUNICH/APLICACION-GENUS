/**
 * Auditoría dry-run de 0010/0011/0012.
 * - Sin DATABASE_URL_TEMP: validación estática (aditiva, gates, rollback docs).
 * - Con DATABASE_URL_TEMP: aplica + rollback real (NO usar Preview Neon).
 *
 * Nunca escribe en Preview. Exit 0 si OK.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.join(__dirname, "..", "drizzle");
const journalPath = path.join(drizzleDir, "meta", "_journal.json");
const migrateScript = fs.readFileSync(
  path.join(__dirname, "migrate-if-database.mjs"),
  "utf8"
);

function read(name) {
  return fs.readFileSync(path.join(drizzleDir, name), "utf8");
}

function assert(cond, msg, steps) {
  steps.push({ ok: !!cond, msg });
  if (!cond) throw new Error(msg);
}

function staticAudit() {
  const steps = [];
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const tags = (journal.entries ?? []).map((e) => e.tag);

  assert(tags.includes("0010_universal_lifecycle"), "0010 en journal", steps);
  assert(
    tags.includes("0011_completa_con_pendientes_enum"),
    "0011 en journal",
    steps
  );
  assert(
    tags.includes("0012_mp_weekly_control_lifecycle"),
    "0012 en journal",
    steps
  );

  assert(
    migrateScript.includes('APPLY_MIGRATION_0010 === "1"'),
    "gate 0010",
    steps
  );
  assert(
    migrateScript.includes('APPLY_MIGRATION_0011 === "1"'),
    "gate 0011",
    steps
  );
  assert(
    migrateScript.includes('APPLY_MIGRATION_0012 === "1"'),
    "gate 0012",
    steps
  );
  assert(
    migrateScript.includes('startsWith("0012_") && !apply0012'),
    "defer copy 0012",
    steps
  );

  const s10 = read("0010_universal_lifecycle.sql");
  const s10Body = s10.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^--.*$/gm, "");
  assert(
    /CREATE TABLE IF NOT EXISTS\s+"lifecycle_audit_events"/i.test(s10),
    "0010 CREATE IF NOT EXISTS",
    steps
  );
  assert(!/\bDROP\b/i.test(s10Body), "0010 sin DROP en apply", steps);
  assert(!/\bTRUNCATE\b/i.test(s10Body), "0010 sin TRUNCATE", steps);
  assert(/DROP TABLE IF EXISTS lifecycle_audit_events/i.test(s10), "0010 rollback doc", steps);

  const s11 = read("0011_completa_con_pendientes_enum.sql");
  const s11Body = s11.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^--.*$/gm, "");
  assert(/ADD VALUE 'COMPLETA_CON_PENDIENTES'/i.test(s11), "0011 ADD VALUE", steps);
  assert(/duplicate_object/i.test(s11), "0011 idempotente", steps);
  assert(/APPLY_MIGRATION_0011/i.test(s11), "0011 gate comment", steps);
  assert(!/\bTRUNCATE\b/i.test(s11Body), "0011 sin TRUNCATE", steps);

  const s12 = read("0012_mp_weekly_control_lifecycle.sql");
  const s12Body = s12.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^--.*$/gm, "");
  assert(/CREATE TABLE IF NOT EXISTS\s+"asignacion_lotes"/i.test(s12), "0012 asignacion_lotes", steps);
  assert(/mp_weekly_controls_status_check/i.test(s12), "0012 status check", steps);
  assert(/APPLY_MIGRATION_0012/i.test(s12), "0012 gate comment", steps);
  assert(/DROP TABLE IF EXISTS "asignacion_lotes"/i.test(s12), "0012 rollback doc", steps);
  // 0012 apply may DROP CONSTRAINT IF EXISTS before ADD (safe additive)
  assert(!/\bTRUNCATE\b/i.test(s12Body), "0012 sin TRUNCATE", steps);
  assert(!/\bDROP TABLE\b/i.test(s12Body), "0012 sin DROP TABLE en apply", steps);

  return { mode: "static", ok: true, steps };
}

async function liveTempAudit(connUrl) {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(connUrl);
  const steps = [];

  await sql`DO $$ BEGIN
    CREATE TYPE operational_order_status AS ENUM ('BORRADOR');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
  await sql`CREATE TABLE IF NOT EXISTS mp_weekly_controls (
    id text PRIMARY KEY,
    status text NOT NULL DEFAULT 'BORRADOR',
    audit jsonb
  )`;

  // 0010
  await sql`CREATE TABLE IF NOT EXISTS lifecycle_audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_kind text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    actor_email text NOT NULL,
    actor_sector text NOT NULL,
    reason text,
    impact_json jsonb,
    created_at timestamptz DEFAULT now() NOT NULL
  )`;
  steps.push({ mig: "0010", action: "apply", ok: true });
  await sql`DROP TABLE IF EXISTS lifecycle_audit_events`;
  const gone = await sql`SELECT to_regclass('public.lifecycle_audit_events') AS t`;
  steps.push({ mig: "0010", action: "rollback", ok: gone[0].t == null });

  await sql`CREATE TABLE IF NOT EXISTS lifecycle_audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_kind text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    actor_email text NOT NULL,
    actor_sector text NOT NULL,
    reason text,
    impact_json jsonb,
    created_at timestamptz DEFAULT now() NOT NULL
  )`;

  await sql`DO $$ BEGIN
    ALTER TYPE operational_order_status ADD VALUE 'COMPLETA_CON_PENDIENTES';
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
  const vals = await sql`
    SELECT e.enumlabel FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'operational_order_status'`;
  steps.push({
    mig: "0011",
    action: "apply",
    ok: vals.some((r) => r.enumlabel === "COMPLETA_CON_PENDIENTES"),
  });

  await sql`ALTER TABLE mp_weekly_controls DROP CONSTRAINT IF EXISTS mp_weekly_controls_status_check`;
  await sql`ALTER TABLE mp_weekly_controls ADD CONSTRAINT mp_weekly_controls_status_check
    CHECK (status IN ('BORRADOR','COMPLETADO','ANULADO','ARCHIVADO'))`;
  await sql`CREATE TABLE IF NOT EXISTS asignacion_lotes (
    id text PRIMARY KEY NOT NULL,
    lote text NOT NULL,
    fecha date NOT NULL,
    producto text NOT NULL,
    codigo text NOT NULL,
    marca text DEFAULT '' NOT NULL,
    cantidades numeric NOT NULL DEFAULT 0,
    vto date,
    muestras text DEFAULT '' NOT NULL,
    cj_muestra text DEFAULT '' NOT NULL,
    fecha_analisis date,
    observaciones text DEFAULT '' NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by text DEFAULT '' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    updated_by text DEFAULT '' NOT NULL
  )`;
  const t = await sql`SELECT to_regclass('public.asignacion_lotes') AS t`;
  steps.push({ mig: "0012", action: "apply", ok: t[0].t != null });
  await sql`ALTER TABLE mp_weekly_controls DROP CONSTRAINT IF EXISTS mp_weekly_controls_status_check`;
  await sql`DROP TABLE IF EXISTS asignacion_lotes`;
  const t2 = await sql`SELECT to_regclass('public.asignacion_lotes') AS t`;
  steps.push({ mig: "0012", action: "rollback", ok: t2[0].t == null });

  return { mode: "live_temp", ok: steps.every((s) => s.ok), steps };
}

async function main() {
  let report;
  const temp = process.env.DATABASE_URL_TEMP?.trim();
  try {
    const staticReport = staticAudit();
    if (temp) {
      if (/atj4uiil|preview/i.test(temp)) {
        throw new Error("DATABASE_URL_TEMP parece Preview — abortado");
      }
      const live = await liveTempAudit(temp);
      report = { ...live, static: staticReport.steps };
    } else {
      report = {
        ...staticReport,
        note: "Sin DATABASE_URL_TEMP: solo auditoría estática. Live dry-run pendiente de DB temporal.",
      };
    }
  } catch (err) {
    report = { ok: false, error: String(err?.message ?? err) };
  }

  const outDir = path.join(__dirname, "..", "tmp-mig-dryrun-0010-0012");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
