/**
 * Reconciliación de migraciones "order-independent".
 *
 * PROBLEMA: el migrador de Drizzle decide qué aplicar comparando el `when`
 * (created_at) de cada entrada del journal contra el `created_at` MÁS ALTO ya
 * aplicado en la base. Una migración mergeada DESPUÉS con un `when` menor que el
 * de una ya desplegada es SALTEADA en silencio (sin error). Con varias ramas
 * agregando migraciones en paralelo, eso depende del orden de merge.
 *
 * ESTRATEGIA (no modifica ninguna migración ya ejecutada ni el motor de Drizzle):
 *  1. Drizzle sigue corriendo igual (aplica lo que corresponde por `when`).
 *  2. Este paso corre DESPUÉS y, para cada migración marcada como segura para
 *     aplicarse fuera de orden, verifica por HASH (el mismo sha256 del archivo que
 *     usa Drizzle) si figura en `drizzle.__drizzle_migrations`. Si falta → la aplica
 *     y la registra. Así ninguna queda salteada, sin importar el orden de merge.
 *  3. Solo participan migraciones declaradas "reconcile-safe": 100 % aditivas e
 *     idempotentes (IF NOT EXISTS). Marca: línea `-- genus:reconcile-safe` en el
 *     archivo, o tag en KNOWN_RECONCILE_SAFE_TAGS (ramas ya escritas, revisadas una
 *     por una). Las migraciones viejas (<= 0038), las diferidas por gate
 *     (0005–0018, 0022) y las no marcadas NUNCA se reaplican.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RECONCILE_MARKER = "-- genus:reconcile-safe";

/** Migraciones de ramas abiertas, auditadas: solo CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS. */
export const KNOWN_RECONCILE_SAFE_TAGS = new Set([
  "0039_me_remito_ai",
  "0039_asignacion_lotes_adoption_reconciliation",
]);

export function drizzleHash(sqlText) {
  return crypto.createHash("sha256").update(sqlText).digest("hex");
}

export function splitStatements(sqlText) {
  return sqlText
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isReconcileSafe(tag, sqlText) {
  return KNOWN_RECONCILE_SAFE_TAGS.has(tag) || sqlText.includes(RECONCILE_MARKER);
}

/**
 * @param {{ folder: string, query: (text: string, params?: unknown[]) => Promise<any[]>, transaction?: (stmts: Array<{text:string, params?:unknown[]}>) => Promise<void>, log?: (m: string) => void }} opts
 * `query` ejecuta una sentencia y devuelve filas; `transaction` ejecuta varias de forma atómica.
 */
export async function reconcileMigrations({ folder, query, transaction, log = () => {} }) {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"));
  const tx =
    transaction ??
    (async (stmts) => {
      for (const s of stmts) await query(s.text, s.params);
    });

  // Si Drizzle nunca corrió (sin tabla) no hay nada que reconciliar: migrate() ya aplicó todo.
  const exists = await query(
    "select 1 as ok from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations'"
  );
  if (!exists.length) return { applied: [], skipped: [] };

  const rows = await query('select hash from "drizzle"."__drizzle_migrations"');
  const known = new Set(rows.map((r) => r.hash));
  const applied = [];
  const skipped = [];

  for (const entry of journal.entries ?? []) {
    const file = path.join(folder, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (!isReconcileSafe(entry.tag, text)) continue;
    const hash = drizzleHash(text);
    if (known.has(hash)) {
      skipped.push(entry.tag);
      continue;
    }
    const stmts = splitStatements(text).map((t) => ({ text: t }));
    stmts.push({
      text: 'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)',
      params: [hash, entry.when],
    });
    await tx(stmts);
    known.add(hash);
    applied.push(entry.tag);
    log(`[db:migrate] reconciliada migración salteada por orden de merge: ${entry.tag}`);
  }
  return { applied, skipped };
}
