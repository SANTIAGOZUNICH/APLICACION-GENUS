/**
 * READ-ONLY: movimientos ledger INGRESO sin fila inv_mp_ingresos.
 * No imprime DATABASE_URL ni payloads sensibles completos.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL requerida (Preview only)");
  process.exit(1);
}
if (!url.includes("polished-recipe")) {
  console.error("Abort: host no es Preview polished-recipe");
  process.exit(1);
}

const sql = neon(url);

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

console.log(
  JSON.stringify(
    {
      host_label: "ep-polished-recipe",
      ledger_ingreso_movements: movements.length,
      inv_mp_ingresos_rows: ingresoIds.length,
      orphan_movements: orphans.length,
      repairable_from_payload: repairable.length,
      sample_orphan_ref_ids: orphans.slice(0, 5).map((o) => o.ref_id),
      Production_involved: false,
      backfill_executed: false,
    },
    null,
    2
  )
);
