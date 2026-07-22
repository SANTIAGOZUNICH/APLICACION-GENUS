/**
 * Aplica migraciones Drizzle solo si hay DATABASE_URL (Preview Neon).
 * Production sin Neon no ejecuta nada.
 * Prefiere DATABASE_URL_UNPOOLED (conexión directa) para migraciones.
 *
 * 0005 (avisos/MP stock/COA) queda registrada en el journal pero NO se aplica
 * hasta definir APPLY_MIGRATION_0005=1 en el entorno.
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

function prepareMigrationsFolder() {
  if (apply0005) return migrationsFolder;

  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const filtered = {
    ...journal,
    entries: (journal.entries ?? []).filter(
      (e) => !String(e.tag ?? "").startsWith("0005_")
    ),
  };
  if (filtered.entries.length === (journal.entries ?? []).length) {
    return migrationsFolder;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "genus-migrate-"));
  for (const name of fs.readdirSync(migrationsFolder)) {
    if (name === "meta") continue;
    if (name.startsWith("0005_")) continue;
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
  console.log(
    "[db:migrate] 0005 diferida (definí APPLY_MIGRATION_0005=1 para aplicar)."
  );
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
  console.log("[db:migrate] OK — migraciones aplicadas (0005 condicionada).");
} catch (err) {
  console.error("[db:migrate] falló:", err);
  process.exit(1);
}
