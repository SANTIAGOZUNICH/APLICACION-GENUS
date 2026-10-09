/**
 * Reconciliación de migraciones salteadas por orden de merge — ENDURECIDA.
 *
 * PROBLEMA: Drizzle aplica solo entradas del journal con `when` mayor al `created_at` más alto ya
 * aplicado; una migración mergeada después con `when` menor se saltea en silencio.
 *
 * QUÉ HACE ESTE PASO (corre después de `migrate()`): para cada migración de una LISTA EXPLÍCITA
 * (`ALLOWED_RECONCILE_MIGRATIONS`) que no figure en `drizzle.__drizzle_migrations` (por hash), la aplica
 * y la registra. NO es un ejecutor genérico de SQL:
 *   1. Lista explícita tag → sha256 EXACTO del archivo. Un archivo que no esté en la lista, o cuyo
 *      contenido difiera del hash fijado, NUNCA se ejecuta (se informa y se omite).
 *   2. Cada sentencia debe pasar una validación estricta: solo DDL ADITIVO e idempotente
 *      (CREATE TABLE/INDEX IF NOT EXISTS, ALTER TABLE … ADD COLUMN IF NOT EXISTS). Cualquier otra
 *      cosa (DROP, DELETE, UPDATE, INSERT, TRUNCATE, DO, GRANT, comentarios que oculten sentencias,
 *      varias sentencias en una) aborta ANTES de ejecutar nada de esa migración.
 *   3. Registro de ejecución: tabla `genus_migration_reconcile_log` (tag, hash, applied_at, statements)
 *      además del registro estándar de Drizzle.
 *   4. Nunca modifica ni borra datos: solo crea objetos nuevos.
 * Agregar una migración nueva a la lista es una decisión explícita de revisión (hay un test que obliga
 * a que toda migración posterior a 0038 esté en la lista con su hash).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** tag → sha256 del archivo .sql EXACTO. Cambiar el SQL exige re-pinar el hash en una revisión. */
export const ALLOWED_RECONCILE_MIGRATIONS = Object.freeze({
  "0039_me_remito_ai": "0ea9de391d7ede8d07a0b40d8e749ca646c467e4c03215970dcc89b1ea159e92",
  "0039_asignacion_lotes_adoption_reconciliation": "17f87ae7f5656ea23271e12219199c5754c4ca6c92ee530a5795d60616b5f184",
  "0040_asignacion_lotes_cell_audit": "e5572cbca6585d6bd29b22414609ccea8dfda8730a0d476e8561d3ebc03031fb",
  "0041_semanas_task_priorities": "b610bd6e4e5913bb2ccd2e9d1640ac9b835bed1946b7bc5a3154fffffb933c19",
  "0042_semanas_task_links": "028846d48272e2132b1cfa098820a13fa48f5217a21515f52066fb1b6b3507b7",
});

export const RECONCILE_LOG_TABLE = "genus_migration_reconcile_log";

export function drizzleHash(sqlText) {
  return crypto.createHash("sha256").update(sqlText).digest("hex");
}

export function splitStatements(sqlText) {
  return sqlText
    .split("--> statement-breakpoint")
    .map((chunk) =>
      // Se descartan comentarios de línea completos; una sentencia queda en una sola unidad.
      chunk
        .split("\n")
        .filter((line) => !/^\s*--/.test(line))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

const IDENT = String.raw`"?[a-z_][a-z0-9_]*"?`;
const ALLOWED_STATEMENT_PATTERNS = [
  new RegExp(String.raw`^create\s+table\s+if\s+not\s+exists\s+${IDENT}\s*\(`, "i"),
  new RegExp(String.raw`^create\s+(unique\s+)?index\s+if\s+not\s+exists\s+${IDENT}\s+on\s+${IDENT}\s*\(`, "i"),
  new RegExp(String.raw`^alter\s+table\s+${IDENT}\s+add\s+column\s+if\s+not\s+exists\s+${IDENT}\s+`, "i"),
];
const FORBIDDEN = /\b(drop|delete|truncate|update|insert|grant|revoke|copy|do|execute|call|vacuum|reindex|rename|alter\s+type|alter\s+column|set\s+not\s+null)\b/i;

/** Devuelve un motivo de rechazo o null si la sentencia es DDL aditivo permitido. */
export function rejectStatement(stmt) {
  const body = stmt.replace(/;\s*$/, "");
  if (body.includes(";")) return "varias sentencias en una";
  if (!ALLOWED_STATEMENT_PATTERNS.some((re) => re.test(body))) return "no es DDL aditivo idempotente permitido";
  // Se ignoran palabras dentro de literales/identificadores citados al buscar verbos prohibidos.
  const noQuoted = body.replace(/'(?:[^']|'')*'/g, "''").replace(/"[^"]*"/g, '""');
  if (FORBIDDEN.test(noQuoted)) return "contiene una palabra prohibida";
  return null;
}

/**
 * @param {{ folder: string, query: (text: string, params?: unknown[]) => Promise<any[]>, transaction?: (stmts: Array<{text:string, params?:unknown[]}>) => Promise<void>, log?: (m: string) => void, allowed?: Record<string,string> }} opts
 */
export async function reconcileMigrations({ folder, query, transaction, log = () => {}, allowed = ALLOWED_RECONCILE_MIGRATIONS }) {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"));
  const tx =
    transaction ??
    (async (stmts) => {
      for (const s of stmts) await query(s.text, s.params);
    });

  const exists = await query(
    "select 1 as ok from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations'"
  );
  if (!exists.length) return { applied: [], skipped: [], rejected: [] };

  const rows = await query('select hash from "drizzle"."__drizzle_migrations"');
  const known = new Set(rows.map((r) => r.hash));
  const applied = [];
  const skipped = [];
  const rejected = [];

  for (const entry of journal.entries ?? []) {
    const pinned = allowed[entry.tag];
    if (!pinned) continue; // no está en la lista explícita: Drizzle decide, esto no la toca
    const file = path.join(folder, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) {
      rejected.push({ tag: entry.tag, reason: "archivo inexistente" });
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    const hash = drizzleHash(text);
    if (hash !== pinned) {
      rejected.push({ tag: entry.tag, reason: `hash distinto al autorizado (${hash.slice(0, 12)}…)` });
      log(`[db:migrate] RECHAZADA ${entry.tag}: el contenido no coincide con el hash autorizado — no se ejecuta.`);
      continue;
    }
    if (known.has(hash)) {
      skipped.push(entry.tag);
      continue;
    }
    const statements = splitStatements(text);
    const bad = statements.map((s) => ({ s, why: rejectStatement(s) })).find((x) => x.why);
    if (bad) {
      rejected.push({ tag: entry.tag, reason: `sentencia rechazada: ${bad.why}` });
      log(`[db:migrate] RECHAZADA ${entry.tag}: ${bad.why}.`);
      continue;
    }
    const stmts = [
      { text: `create table if not exists "${RECONCILE_LOG_TABLE}" ("tag" text not null, "hash" text not null, "applied_at" timestamptz not null default now(), "statements" integer not null, primary key ("tag","hash"))` },
      ...statements.map((t) => ({ text: t })),
      { text: 'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)', params: [hash, entry.when] },
      { text: `insert into "${RECONCILE_LOG_TABLE}" ("tag","hash","statements") values ($1,$2,$3) on conflict do nothing`, params: [entry.tag, hash, statements.length] },
    ];
    await tx(stmts);
    known.add(hash);
    applied.push(entry.tag);
    log(`[db:migrate] reconciliada migración salteada por orden de merge: ${entry.tag}`);
  }
  return { applied, skipped, rejected };
}
