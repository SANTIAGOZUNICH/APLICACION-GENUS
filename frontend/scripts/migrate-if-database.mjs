/**
 * Aplica migraciones Drizzle solo si hay DATABASE_URL (Preview Neon).
 * Production sin Neon no ejecuta nada.
 * Prefiere DATABASE_URL_UNPOOLED (conexión directa) para migraciones.
 *
 * 0005–0010 quedan registradas en el journal pero NO se aplican hasta
 * APPLY_MIGRATION_0005/0006/0007/0008/0009/0010=1.
 * 0008 = almacenamiento privado Vercel Blob (COA/Remitos). No tocar 0005–0007.
 * 0009 = procedimientos + métricas envasado. Solo Preview con gate.
 * 0010 = lifecycle_audit_events. Solo Preview con gate.
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

function shouldDeferTag(tag) {
  const t = String(tag ?? "");
  if (t.startsWith("0005_") && !apply0005) return true;
  if (t.startsWith("0006_") && !apply0006) return true;
  if (t.startsWith("0007_") && !apply0007) return true;
  if (t.startsWith("0008_") && !apply0008) return true;
  if (t.startsWith("0009_") && !apply0009) return true;
  if (t.startsWith("0010_") && !apply0010) return true;
  return false;
}

function prepareMigrationsFolder() {
  if (apply0005 && apply0006 && apply0007 && apply0008 && apply0009 && apply0010) {
    return migrationsFolder;
  }

  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const filtered = {
    ...journal,
    entries: (journal.entries ?? []).filter((e) => !shouldDeferTag(e.tag)),
  };
  if (filtered.entries.length === (journal.entries ?? []).length) {
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
  if (deferred.length) {
    console.log(
      `[db:migrate] ${deferred.join(" y ")} diferida(s) (APPLY_MIGRATION_0005…0010=1 para aplicar).`
    );
  }
  return tmp;
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
    "[db:migrate] OK — migraciones aplicadas (0005–0010 condicionadas)."
  );
} catch (err) {
  console.error("[db:migrate] falló:", err);
  process.exit(1);
}
