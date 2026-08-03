/**
 * Dry-run de migración 0005: aplica SQL en transacción y hace ROLLBACK.
 *
 * Uso:
 *   DATABASE_URL_TEMP=postgres://... node scripts/migration-0005-dry-run.mjs
 *
 * NO usa DATABASE_URL de Preview/Production. Solo DATABASE_URL_TEMP.
 * Sin TEMP: sale 0 con mensaje (no falla CI).
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const url = process.env.DATABASE_URL_TEMP?.trim() || "";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "..", "drizzle", "0005_avisos_mp_stock_coa.sql");

if (!url) {
  console.log(
    "[0005 dry-run] DATABASE_URL_TEMP ausente — skip (no tocar Preview/Production)."
  );
  process.exit(0);
}

if (process.env.VERCEL_ENV === "production") {
  console.error("[0005 dry-run] Bloqueado en VERCEL_ENV=production.");
  process.exit(1);
}

const raw = fs.readFileSync(sqlPath, "utf8");
const statements = raw
  .split(/-->\s*statement-breakpoint/)
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  console.log(`[0005 dry-run] ${statements.length} statements — BEGIN…`);
  try {
    await client.query("BEGIN");
    for (const stmt of statements) {
      await client.query(stmt);
    }
    await client.query("SELECT 1 FROM os_internal_messages LIMIT 1");
    await client.query("SELECT 1 FROM mp_stock_movements LIMIT 1");
    await client.query("SELECT 1 FROM coa_folders LIMIT 1");
    const idx = await client.query(
      "SELECT indexname FROM pg_indexes WHERE indexname = 'mp_stock_movements_idempotency_uidx'"
    );
    if (idx.rowCount === 0) {
      throw new Error("Falta índice de idempotencia");
    }
    console.log("[0005 dry-run] OK — ROLLBACK (sin persistir).");
    await client.query("ROLLBACK");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.error("[0005 dry-run] FALLÓ:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
