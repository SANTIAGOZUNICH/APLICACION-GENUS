/**
 * READ-ONLY: movimientos ledger INGRESO sin fila inv_mp_ingresos.
 * No imprime DATABASE_URL ni payloads sensibles completos.
 * Usa .env.preview.local (mismo patrón que precheck 0008).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv(file) {
  const map = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    map[line.slice(0, eq)] = v;
  }
  return map;
}

const envFile = path.join(root, ".env.preview.local");
if (!fs.existsSync(envFile)) {
  console.error("STOP: .env.preview.local ausente");
  process.exit(1);
}
const env = loadEnv(envFile);
let raw = env.DATABASE_URL_UNPOOLED;
if (!raw || raw.length < 20 || raw === "[SENSITIVE]") raw = env.DATABASE_URL;
if (!raw || raw.length < 20 || raw === "[SENSITIVE]") {
  console.error("STOP: sin DATABASE_URL Preview");
  process.exit(1);
}
const u = new URL(raw);
if (!u.hostname.includes("polished-recipe")) {
  console.error("Abort: host no es Preview polished-recipe");
  process.exit(1);
}
if (u.hostname.includes("-pooler")) {
  u.hostname = u.hostname.replace("-pooler", "");
}

const sql = neon(u.toString());

const movements = await sql`
  SELECT ref_id, codigo, quantity, created_at
  FROM mp_stock_movements
  WHERE kind = 'INGRESO' AND ref_type = 'mp_ingreso' AND ref_id IS NOT NULL
  ORDER BY created_at DESC
`;

const ingresoIds = await sql`SELECT id FROM inv_mp_ingresos`;
const known = new Set(ingresoIds.map((r) => r.id));

const orphans = movements.filter((m) => !known.has(m.ref_id));
const repairable = orphans.filter((m) => m.codigo && Number(m.quantity) > 0);

const formulas = await sql`
  SELECT
    (SELECT count(*)::int FROM formula_versions) AS versions,
    (SELECT count(*)::int FROM formula_products WHERE active_version_id IS NOT NULL) AS active
`;

console.log(
  JSON.stringify(
    {
      host_label: u.hostname.split(".")[0],
      ledger_ingreso_movements: movements.length,
      inv_mp_ingresos_rows: ingresoIds.length,
      orphan_movements: orphans.length,
      repairable_from_payload: repairable.length,
      sample_orphan_ref_ids: orphans.slice(0, 5).map((o) => String(o.ref_id).slice(0, 8) + "…"),
      formula_versions: formulas[0]?.versions ?? null,
      formula_active: formulas[0]?.active ?? null,
      Production_involved: false,
      backfill_executed: false,
      read_only: true,
    },
    null,
    2
  )
);
