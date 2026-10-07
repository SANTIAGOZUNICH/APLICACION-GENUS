/**
 * READ-ONLY. Auditoría previa al ledger de Material de Empaque (ME).
 *
 * Compara, por código de material:
 *   STOCK VISTA (antes) = ingresos activos − consumos OA activos   (ajustes ignorados)
 *   NUEVO STOCK         = ingresos − consumos OA + Σ ajustes (module ME)
 * y lista los ajustes históricos que cambian el saldo mostrado.
 *
 * Uso: node scripts/_audit_me_ledger_adjustments.mjs
 * Env: DATABASE_URL / DATABASE_URL_UNPOOLED / POSTGRES_URL (Production o Preview).
 * No escribe nada.
 */
import { neon } from "@neondatabase/serverless";

const url =
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  process.env.POSTGRES_URL?.trim();
if (!url) {
  console.error("[audit-me-ledger] No DATABASE_URL en env — abortando.");
  process.exit(1);
}
const sql = neon(url);
const norm = (c) => String(c ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const [materials, ingresos, salidas, ajustes] = await Promise.all([
  sql`SELECT id, payload FROM inv_me_materials`,
  sql`SELECT id, payload FROM inv_me_ingresos`,
  sql`SELECT id, payload FROM inv_me_salidas`,
  sql`SELECT id, payload FROM inv_ajustes WHERE payload->>'module' = 'ME'`,
]);

const byCodigo = new Map();
const row = (codigo) => {
  if (!byCodigo.has(codigo))
    byCodigo.set(codigo, { codigo, stored: null, ingresos: 0, consumos: 0, ajustes: 0, nAjustes: 0 });
  return byCodigo.get(codigo);
};
const codigoByMaterialId = new Map();
for (const { id, payload: m } of materials) {
  const c = norm(m.codigo);
  codigoByMaterialId.set(id, c);
  if (!c || m.archived) continue;
  row(c).stored = num(m.stockActual);
}
for (const { payload: r } of ingresos) {
  if (r.anulado) continue;
  row(norm(r.codigo)).ingresos += num(r.total);
}
for (const { payload: r } of salidas) {
  if (r.origen !== "OA" || r.reverted) continue;
  row(norm(r.codigo)).consumos += num(r.total ?? r.cantidad);
}
const orphan = [];
for (const { payload: a } of ajustes) {
  const c = codigoByMaterialId.get(a.entityId);
  if (!c) {
    orphan.push(a);
    continue;
  }
  const r = row(c);
  r.ajustes += num(a.diferencia);
  r.nAjustes += 1;
}

const table = [...byCodigo.values()]
  .filter((r) => r.codigo)
  .map((r) => {
    const vista = r.ingresos - r.consumos;
    const nuevo = vista + r.ajustes;
    return {
      MATERIAL: r.codigo,
      "STOCK ACTUAL (vista)": vista,
      "STOCK GUARDADO": r.stored,
      INGRESOS: r.ingresos,
      CONSUMOS: r.consumos,
      AJUSTES: r.ajustes,
      "N AJUSTES": r.nAjustes,
      "NUEVO STOCK": nuevo,
      "DIF.": nuevo - vista,
      "SALDO NEGATIVO": nuevo < 0 ? "SI" : "",
    };
  })
  .sort((a, b) => Math.abs(b["DIF."]) - Math.abs(a["DIF."]));

console.log(`Ajustes ME históricos: ${ajustes.length} (huérfanos sin material: ${orphan.length})`);
console.log(`Materiales con ajustes: ${table.filter((t) => t["N AJUSTES"] > 0).length}`);
console.log(`Materiales cuyo saldo CAMBIA con el ledger: ${table.filter((t) => t["DIF."] !== 0).length}`);
console.table(table.filter((t) => t["DIF."] !== 0 || t["SALDO NEGATIVO"]));
