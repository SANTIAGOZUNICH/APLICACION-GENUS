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
  "0043_asignacion_lotes_local_edits": "18bb43cd0bdfeac06d935dcbf23923900186b2cc4ad9b515655f8a9921171be5",
  "0044_inventory_ingreso_adjuntos": "22fffe21358b2565689f38e1407f0af382f7acc24e281735e8c5d7910cb9d201",
  "0045_scheduled_deliveries": "5e0e8f0f071ac386f5d6fad39ae1e623ec930565c2dd76f94f7956a690ecbbc7",
  "0046_dashboard_kpi_targets": "aef737a752f0556501448cfd6377c47ebdc02e834a494534b3fa7f7135c9b9c7",
  "0047_work_item_delivery_lines": "8e087db051df1b9ce194103839561404f88fb1df77f9eba002b0179252cd0fc5",
  "0049_mp_load_order": "d34b39584f6cae250bbc72a6d29676a78d4c9c369ffffe0458b0c9583c7ed059",
  "0050_entregas_correcciones": "48d39276bc1d97698ef8ff9f5d06ccba68b4c1ce18dfe8a3094c204044195ec4",
  "0051_formula_drive_index": "fd438ee5d8cd4a95ab853aca736ddb9d05ef9047318b08259337bc91a2093380",
  "0052_portal_clientes": "3d48d8521e8e79b650abc2447b89be852c71fb3923f7760a83729d141bb6d963",
  "0053_portal_demo": "220318a3a2141c735a393975d980cbf3d34ee5a964b69d30b8ed402c28641f28",
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

/**
 * Objetos de esquema que el código desplegado NECESITA (tabla o tabla.columna), con la migración que los crea.
 * Se verifica después de `migrate()` + reconciliación: si falta alguno, la migración quedó salteada en silencio
 * (p. ej. Drizzle la omitió por orden de `when` y la reconciliación la rechazó con solo un aviso). En Production el
 * build se corta: es preferible conservar el deploy anterior que publicar código que no puede listar ni guardar.
 * Solo lectura (information_schema); nunca crea ni modifica nada.
 */
export const REQUIRED_SCHEMA_OBJECTS = Object.freeze([
  { migration: "0043_asignacion_lotes_local_edits", object: "asignacion_lotes.source_lote" },
  { migration: "0043_asignacion_lotes_local_edits", object: "asignacion_lotes.source_codigo" },
  { migration: "0043_asignacion_lotes_local_edits", object: "asignacion_lotes.source_producto" },
  { migration: "0043_asignacion_lotes_local_edits", object: "asignacion_lotes_cell_audit.reason" },
  { migration: "0043_asignacion_lotes_local_edits", object: "asignacion_lotes_local_edits" },
  { migration: "0044_inventory_ingreso_adjuntos", object: "inventory_ingreso_adjuntos" },
  { migration: "0045_scheduled_deliveries", object: "scheduled_deliveries" },
  { migration: "0045_scheduled_deliveries", object: "scheduled_delivery_items" },
  { migration: "0045_scheduled_deliveries", object: "scheduled_delivery_links" },
  { migration: "0046_dashboard_kpi_targets", object: "dashboard_kpi_targets" },
  { migration: "0047_work_item_delivery_lines", object: "work_item_delivery_lines" },
  { migration: "0047_work_item_delivery_lines", object: "work_item_deliveries.delivery_complete" },
  { migration: "0047_work_item_delivery_lines", object: "work_item_deliveries.pending_balance" },
  { migration: "0049_mp_load_order", object: "inv_mp_stock.load_seq" },
  { migration: "0049_mp_load_order", object: "inv_mp_stock.seq_criterio" },
  { migration: "0049_mp_load_order", object: "inv_mp_ingresos.load_seq" },
  { migration: "0049_mp_load_order", object: "inv_mp_ingresos.seq_criterio" },
  { migration: "0049_mp_load_order", object: "inv_mp_compras.load_seq" },
  { migration: "0049_mp_load_order", object: "inv_mp_compras.seq_criterio" },
  { migration: "0049_mp_load_order", object: "inv_mp_control.load_seq" },
  { migration: "0049_mp_load_order", object: "inv_mp_control.seq_criterio" },
  { migration: "0050_entregas_correcciones", object: "delivery_calendar_hidden" },
  { migration: "0050_entregas_correcciones", object: "scheduled_delivery_items.deleted_reason" },
  { migration: "0051_formula_drive_index", object: "formula_drive_sync_runs" },
  { migration: "0051_formula_drive_index", object: "formula_drive_index" },
  { migration: "0051_formula_drive_index", object: "formula_drive_links" },
  { migration: "0052_portal_clientes", object: "portal_clients" },
  { migration: "0052_portal_clientes", object: "portal_client_aliases" },
  { migration: "0052_portal_clientes", object: "portal_authorized_emails" },
  { migration: "0052_portal_clientes", object: "portal_login_challenges" },
  { migration: "0052_portal_clientes", object: "portal_sessions" },
  { migration: "0052_portal_clientes", object: "portal_rate_limits" },
  { migration: "0052_portal_clientes", object: "portal_email_outbox" },
  { migration: "0052_portal_clientes", object: "portal_notifications" },
  { migration: "0052_portal_clientes", object: "portal_receipt_confirmations" },
  { migration: "0052_portal_clientes", object: "portal_audit_events" },
  { migration: "0052_portal_clientes", object: "portal_holiday_overrides" },
  { migration: "0053_portal_demo", object: "portal_demo_tokens" },
  { migration: "0053_portal_demo", object: "portal_demo_sessions" },
]);

/** @param {{ query: (text: string, params?: unknown[]) => Promise<any[]>, required?: ReadonlyArray<{migration: string, object: string}> }} opts */
export async function verifyRequiredSchema({ query, required = REQUIRED_SCHEMA_OBJECTS }) {
  const tables = [...new Set(required.map((r) => r.object.split(".")[0]))];
  const present = new Set();
  for (const row of await query(
    "select table_name as t from information_schema.tables where table_schema = current_schema() and table_name = any($1)",
    [tables]
  )) present.add(row.t);
  for (const row of await query(
    "select table_name as t, column_name as c from information_schema.columns where table_schema = current_schema() and table_name = any($1)",
    [tables]
  )) present.add(`${row.t}.${row.c}`);
  const missing = required.filter((r) => !present.has(r.object));
  return { ok: missing.length === 0, missing };
}
