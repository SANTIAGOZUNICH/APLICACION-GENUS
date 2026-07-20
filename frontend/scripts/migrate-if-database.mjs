/**
 * Aplica migraciones Drizzle solo si hay DATABASE_URL (Preview Neon).
 * Production sin Neon no ejecuta nada.
 * Prefiere DATABASE_URL_UNPOOLED (conexión directa) para migraciones.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
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

console.log(
  `[db:migrate] DB URL presente (vercelEnv=${process.env.VERCEL_ENV ?? "local"}) — aplicando ${migrationsFolder}…`
);

try {
  const sql = neon(url);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder });
  console.log(
    "[db:migrate] OK — planning + operational_orders / order_templates / os_notifications."
  );
} catch (err) {
  console.error("[db:migrate] falló:", err);
  process.exit(1);
}
