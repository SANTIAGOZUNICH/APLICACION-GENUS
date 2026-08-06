/**
 * Aplica migraciones Drizzle solo si hay DATABASE_URL (Preview Neon).
 * Production sin Neon no ejecuta nada.
 * Prefiere DATABASE_URL_UNPOOLED (conexión directa) para migraciones.
 *
 * 0005–0012 quedan registradas en el journal pero NO se aplican hasta
 * APPLY_MIGRATION_0005/0006/0007/0008/0009/0010/0011/0012=1.
 * 0008 = almacenamiento privado Vercel Blob (COA/Remitos). No tocar 0005–0007.
 * 0009 = procedimientos + métricas envasado. Solo Preview con gate.
 * 0010 = lifecycle_audit_events. Solo Preview con gate.
 * 0011 = enum COMPLETA_CON_PENDIENTES (gap de 0002 ausente del journal). Gate.
 * 0012 = mp_weekly status check + asignacion_lotes durable. Gate.
 * 0013 = notification deleted_by + tombstones + work_items.planned_date_to. Gate.
 * 0014 = Codificado + depósito graneles. Gate APPLY_MIGRATION_0014=1.
 * 0015 = Creamy memoria personal/operativa (conversaciones, memorias, evidencia,
 *   auditoría). Aditiva. Gate APPLY_MIGRATION_0015=1. Hasta entonces Creamy usa
 *   un repositorio en memoria de proceso (ver src/lib/creamy-memory).
 * 0016 = Genus Auth (usuarios/sesiones/auditoría de sesión enterprise por
 *   sector). Aditiva. Gate APPLY_MIGRATION_0016=1. Hasta entonces el login
 *   usa un repositorio en memoria de proceso (ver src/lib/auth).
 * 0017 = Creamy user_id estable. Aditiva. Gate APPLY_MIGRATION_0017=1.
 * 0018 = Pedidos nativos de Producción. Aditiva. Gate APPLY_MIGRATION_0018=1.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url =
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  process.env.POSTGRES_URL?.trim() ||
  "";

if (!url) {
  console.log(
    "[db:migrate] DATABASE_URL ausente — skip (esperado en Production/sheets)."
  );
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "..", "drizzle");
const apply0005 = process.env.APPLY_MIGRATION_0005 === "1";
const apply0006 = process.env.APPLY_MIGRATION_0006 === "1";
const apply0007 = process.env.APPLY_MIGRATION_0007 === "1";
const apply0008 = process.env.APPLY_MIGRATION_0008 === "1";
const apply0009 = process.env.APPLY_MIGRATION_0009 === "1";
const apply0010 = process.env.APPLY_MIGRATION_0010 === "1";
const apply0011 = process.env.APPLY_MIGRATION_0011 === "1";
const apply0012 = process.env.APPLY_MIGRATION_0012 === "1";
const apply0013 = process.env.APPLY_MIGRATION_0013 === "1";
const apply0014 = process.env.APPLY_MIGRATION_0014 === "1";
const apply0015 = process.env.APPLY_MIGRATION_0015 === "1";
const apply0016 = process.env.APPLY_MIGRATION_0016 === "1";
const apply0017 = process.env.APPLY_MIGRATION_0017 === "1";
const apply0018 = process.env.APPLY_MIGRATION_0018 === "1";

function shouldDeferTag(tag) {
  const t = String(tag ?? "");
  if (t.startsWith("0005_") && !apply0005) return true;
  if (t.startsWith("0006_") && !apply0006) return true;
  if (t.startsWith("0007_") && !apply0007) return true;
  if (t.startsWith("0008_") && !apply0008) return true;
  if (t.startsWith("0009_") && !apply0009) return true;
  if (t.startsWith("0010_") && !apply0010) return true;
  if (t.startsWith("0011_") && !apply0011) return true;
  if (t.startsWith("0012_") && !apply0012) return true;
  if (t.startsWith("0013_") && !apply0013) return true;
  if (t.startsWith("0014_") && !apply0014) return true;
  if (t.startsWith("0015_") && !apply0015) return true;
  if (t.startsWith("0016_") && !apply0016) return true;
  if (t.startsWith("0017_") && !apply0017) return true;
  if (t.startsWith("0018_") && !apply0018) return true;
  return false;
}

function prepareMigrationsFolder() {
  if (
    apply0005 &&
    apply0006 &&
    apply0007 &&
    apply0008 &&
    apply0009 &&
    apply0010 &&
    apply0011 &&
    apply0012 &&
    apply0013 &&
    apply0014 &&
    apply0015 &&
    apply0016 &&
    apply0017 &&
    apply0018
  ) {
    return migrationsFolder;
  }

  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  // Reindexar en secuencia: si se difieren 0005–0018 y quedan 0019/0020
  // ungated, los idx originales (18, 19) dejan huecos y Drizzle/Neon Preview
  // fallan el migrate (build ~10s). Siempre compactar idx al filtrar.
  const filteredEntries = (journal.entries ?? [])
    .filter((e) => !shouldDeferTag(e.tag))
    .map((e, idx) => ({ ...e, idx }));
  const filtered = {
    ...journal,
    entries: filteredEntries,
  };
  if (
    filteredEntries.length === (journal.entries ?? []).length &&
    filteredEntries.every((e, i) => e.idx === i)
  ) {
    return migrationsFolder;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "genus-migrate-"));
  for (const name of fs.readdirSync(migrationsFolder)) {
    if (name === "meta") continue;
    if (name.startsWith("0005_") && !apply0005) continue;
    if (name.startsWith("0006_") && !apply0006) continue;
    if (name.startsWith("0007_") && !apply0007) continue;
    if (name.startsWith("0008_") && !apply0008) continue;
    if (name.startsWith("0009_") && !apply0009) continue;
    if (name.startsWith("0010_") && !apply0010) continue;
    if (name.startsWith("0011_") && !apply0011) continue;
    if (name.startsWith("0012_") && !apply0012) continue;
    if (name.startsWith("0013_") && !apply0013) continue;
    if (name.startsWith("0014_") && !apply0014) continue;
    if (name.startsWith("0015_") && !apply0015) continue;
    if (name.startsWith("0016_") && !apply0016) continue;
    if (name.startsWith("0017_") && !apply0017) continue;
    if (name.startsWith("0018_") && !apply0018) continue;
    fs.copyFileSync(
      path.join(migrationsFolder, name),
      path.join(tmp, name)
    );
  }
  fs.mkdirSync(path.join(tmp, "meta"), { recursive: true });
  for (const name of fs.readdirSync(path.join(migrationsFolder, "meta"))) {
    if (name === "_journal.json") continue;
    fs.copyFileSync(
      path.join(migrationsFolder, "meta", name),
      path.join(tmp, "meta", name)
    );
  }
  fs.writeFileSync(
    path.join(tmp, "meta", "_journal.json"),
    JSON.stringify(filtered, null, 2)
  );
  const deferred = [];
  if (!apply0005) deferred.push("0005");
  if (!apply0006) deferred.push("0006");
  if (!apply0007) deferred.push("0007");
  if (!apply0008) deferred.push("0008");
  if (!apply0009) deferred.push("0009");
  if (!apply0010) deferred.push("0010");
  if (!apply0011) deferred.push("0011");
  if (!apply0012) deferred.push("0012");
  if (!apply0013) deferred.push("0013");
  if (!apply0014) deferred.push("0014");
  if (!apply0015) deferred.push("0015");
  if (!apply0016) deferred.push("0016");
  if (!apply0017) deferred.push("0017");
  if (!apply0018) deferred.push("0018");
  if (deferred.length) {
    console.log(
      `[db:migrate] ${deferred.join(" y ")} diferida(s) (APPLY_MIGRATION_0005…0018=1 para aplicar).`
    );
  }
  return tmp;
}

function isTransientNeonQuotaError(err) {
  const msg = String(err?.cause?.message ?? err?.message ?? err ?? "");
  return (
    msg.includes("data transfer quota") ||
    msg.includes("HTTP status 402") ||
    /status\s*402/i.test(msg)
  );
}

const folder = prepareMigrationsFolder();

console.log(
  `[db:migrate] DB URL presente (vercelEnv=${process.env.VERCEL_ENV ?? "local"}) — aplicando ${folder}…`
);

try {
  const sql = neon(url);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: folder });
  console.log(
    "[db:migrate] OK — migraciones aplicadas (0005–0018 condicionadas)."
  );
} catch (err) {
  // Preview/cuota: no bloquear el build de UI. Production sin DATABASE_URL ya hace skip.
  if (isTransientNeonQuotaError(err)) {
    console.warn(
      "[db:migrate] Neon cuota/402 — skip migrate; build continúa sin tocar schema."
    );
    process.exit(0);
  }
  if (process.env.VERCEL_ENV === "preview") {
    console.warn(
      "[db:migrate] Preview — migrate falló; build continúa sin tocar schema:",
      err?.cause?.message ?? err?.message ?? err
    );
    process.exit(0);
  }
  console.error("[db:migrate] falló:", err);
  process.exit(1);
}
