/**
 * READ-ONLY. Diagnóstico previo a migración 0022 (índice único de código
 * normalizado en inv_me_materials activos). Lista grupos de materiales
 * activos que colisionarían bajo el mismo código normalizado.
 *
 * Uso: node scripts/_audit_me_codigo_duplicates.mjs
 * Env: DATABASE_URL / DATABASE_URL_UNPOOLED / POSTGRES_URL.
 */
import { neon } from "@neondatabase/serverless";

const url =
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  process.env.POSTGRES_URL?.trim();

if (!url) {
  console.error("[audit-me-codigo] No DATABASE_URL en env — abortando.");
  process.exit(1);
}

const sql = neon(url);

const rows = await sql`
  SELECT
    upper(trim(regexp_replace(coalesce(payload->>'codigo', ''), '\s+', ' ', 'g'))) AS codigo_norm,
    count(*) AS n,
    array_agg(id) AS ids
  FROM inv_me_materials
  WHERE coalesce(payload->>'archived', 'false') NOT IN ('true', 'True')
    AND length(trim(coalesce(payload->>'codigo', ''))) > 0
  GROUP BY 1
  HAVING count(*) > 1
  ORDER BY n DESC
`;

console.log(
  JSON.stringify(
    {
      duplicateGroups: rows.length,
      safeToApply0022: rows.length === 0,
      groups: rows,
    },
    null,
    2
  )
);

if (rows.length > 0) {
  console.error(
    `[audit-me-codigo] ${rows.length} grupo(s) duplicado(s) — NO habilitar APPLY_MIGRATION_0022 sin reconciliar primero (scripts/_repair_me_inventario_by_codigo.mjs).`
  );
  process.exit(2);
}
console.log("[audit-me-codigo] Sin duplicados activos — 0022 es segura de aplicar.");
