/**
 * Identidad de cliente del portal: asigna AUTOMÁTICAMENTE un código estable (GEN-XXXXXX) a cada cliente nuevo de GENUS OS.
 *
 * Diseño:
 *  - GENUS OS no tiene tabla de clientes (el cliente es texto en pedidos, trabajos y entregas): la identidad del portal vincula
 *    el nombre normalizado (alias) con UN cliente del portal y su código. Un nombre = un cliente = un código, para todos sus
 *    pedidos y productos. Cambiar el nombre comercial (display_name) NO cambia el código.
 *  - Atómico y sin duplicados con operaciones simultáneas: una transacción con bloqueo por nombre (advisory lock) + índices
 *    únicos (alias activo por nombre, código único) como respaldo.
 *  - Se invoca desde los flujos reales de alta (asignación/planificación de trabajos, pedidos, importación de pedidos,
 *    calendario de entregas) y, como red de seguridad para cualquier otro camino (importaciones, sincronizaciones), desde el cron
 *    del portal: `reconcileNewClients` revisa lo creado desde la fecha de corte.
 *  - NO activa el acceso al portal (access_enabled = false), NO autoriza correos, NO envía invitaciones. Un código por sí solo
 *    nunca autentica: el ingreso exige además acceso habilitado y correo autorizado.
 *  - Los clientes HISTÓRICOS no se generan solos: tienen vista previa y confirmación manual (`previewHistoricalClients` /
 *    `generateHistoricalClients`).
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { normalizeClientName, pickDisplayName, similarityKey, type NameStat } from "./client-identity-rules";
import { generatePublicCode, hmac } from "./security";
import { audit, PortalError, type Row, type SqlExec } from "./store";

type Tx = SqlExec;
type TxRunner = { transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> };

export type ClientIdentity = { clientId: string; publicCode: string; name: string; created: boolean };
export type IdentitySource = "asignacion" | "planificacion" | "pedido" | "importacion_pedidos" | "entrega" | "conciliacion" | "historico" | "manual";

const LIVE_WORK = sql`w.deleted_at is null and w.operational_cancelled_at is null and w.operational_status <> 'cancelado' and w.status::text <> 'CANCELADO'`;

async function newUniqueCode(tx: Tx): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const candidate = generatePublicCode();
    const taken = (await tx.execute(sql`select 1 from portal_clients where public_code = ${candidate}`)).rows;
    if (!taken.length) return candidate;
  }
  throw new PortalError("No se pudo generar un código único. Reintentá.", 500, "CODE_GENERATION");
}

/** Dentro de una transacción: devuelve la identidad existente del nombre o la crea (con código) de forma atómica. */
export async function ensureIdentityInTx(tx: Tx, rawName: unknown, opts: { source: IdentitySource; actor?: string | null }): Promise<ClientIdentity | null> {
  const n = normalizeClientName(rawName);
  if (!n) return null;
  // Serializa a quienes crean el MISMO nombre a la vez (el segundo ve el alias que dejó el primero).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`portal-client:${n.key}`}))`);
  const existing = (await tx.execute(sql`
    select c.id::text as id, c.public_code from portal_client_aliases a join portal_clients c on c.id = a.client_id
     where a.name_key = ${n.key} and a.removed_at is null limit 1`)).rows as Row[];
  if (existing[0]) return { clientId: String(existing[0].id), publicCode: String(existing[0].public_code), name: n.label, created: false };

  const id = randomUUID();
  const code = await newUniqueCode(tx);
  const actor = opts.actor?.trim() || "sistema";
  await tx.execute(sql`
    insert into portal_clients (id, public_code, display_name, created_by, access_enabled, origin, origin_detail)
    values (${id}::uuid, ${code}, ${n.label}, ${actor}, false, ${opts.source === "historico" ? "HISTORICO" : opts.source === "manual" ? "MANUAL" : "AUTOMATICO"}, ${opts.source})`);
  await tx.execute(sql`insert into portal_client_aliases (client_id, name_key, name_label, created_by) values (${id}::uuid, ${n.key}, ${n.label}, ${actor})`);
  await audit(tx, { clientId: id, type: "CODIGO_ASIGNADO", kind: "SISTEMA", actor, detail: { source: opts.source, name: n.label } });
  return { clientId: id, publicCode: code, name: n.label, created: true };
}

function runner(db?: unknown): TxRunner {
  return (db ?? getDb()) as unknown as TxRunner;
}

/** Asigna (o reutiliza) el código de un cliente. Lanza ante errores: usar `ensureClientIdentitySafe` en los flujos de alta. */
export async function ensureClientIdentity(rawName: unknown, opts: { source: IdentitySource; actor?: string | null }, db?: unknown): Promise<ClientIdentity | null> {
  if (!normalizeClientName(rawName)) return null;
  return runner(db).transaction((tx) => ensureIdentityInTx(tx, rawName, opts));
}

/**
 * Versión para los flujos reales de alta: NUNCA rompe ni demora el flujo principal. Sin base configurada no hace nada; si
 * falla (p. ej. migración pendiente), lo registra y la conciliación del cron lo recupera.
 */
export async function ensureClientIdentitySafe(rawName: unknown, source: IdentitySource, actor?: string | null): Promise<ClientIdentity | null> {
  try {
    if (!isDatabaseConfigured() || !normalizeClientName(rawName)) return null;
    return await ensureClientIdentity(rawName, { source, actor });
  } catch (err) {
    console.error("[portal] no se pudo asignar el código de cliente (la conciliación lo reintenta)", err instanceof Error ? err.message : err);
    return null;
  }
}

// ───────────────────────── Fecha de corte y conciliación ─────────────────────────

/** Fecha desde la que se concilian clientes nuevos. Se fija una sola vez (primer uso, con una hora de margen). */
export async function getAutoCodeCutover(db: SqlExec): Promise<Date> {
  await db.execute(sql`
    insert into portal_auto_code_settings (key, value, set_by)
    values ('auto_since', to_char((now() - interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'sistema')
    on conflict (key) do nothing`);
  const r = (await db.execute(sql`select value from portal_auto_code_settings where key = 'auto_since'`)).rows as Row[];
  return new Date(String(r[0]!.value));
}

/** Nombres de cliente presentes en datos vivos de GENUS OS (pedidos, trabajos, entregas programadas). */
async function collectNames(db: SqlExec, since: Date | null): Promise<Map<string, NameStat>> {
  const stats = new Map<string, NameStat>();
  const add = (raw: unknown, kind: "works" | "pedidos" | "entregas", count: number) => {
    const n = normalizeClientName(raw);
    if (!n) return;
    const s = stats.get(n.key) ?? { key: n.key, labels: new Map<string, number>(), works: 0, pedidos: 0, entregas: 0 };
    s.labels.set(n.label, (s.labels.get(n.label) ?? 0) + count);
    s[kind] += count;
    stats.set(n.key, s);
  };
  const sinceIso = since ? since.toISOString() : null;
  const works = (await db.execute(sql`select w.client as name, count(*)::int as n from work_items w where ${LIVE_WORK} and (${sinceIso}::timestamptz is null or w.created_at >= ${sinceIso}::timestamptz) group by w.client`)).rows as Row[];
  for (const r of works) add(r.name, "works", Number(r.n));
  const pedidos = (await db.execute(sql`select p.cliente as name, count(*)::int as n from production_pedidos p where p.deleted_at is null and (${sinceIso}::timestamptz is null or p.created_at >= ${sinceIso}::timestamptz) group by p.cliente`)).rows as Row[];
  for (const r of pedidos) add(r.name, "pedidos", Number(r.n));
  const entregas = (await db.execute(sql`select d.client as name, count(*)::int as n from scheduled_deliveries d where d.status = 'programada' and (${sinceIso}::timestamptz is null or d.created_at >= ${sinceIso}::timestamptz) group by d.client`)).rows as Row[];
  for (const r of entregas) add(r.name, "entregas", Number(r.n));
  return stats;
}

async function mappedKeys(db: SqlExec): Promise<Set<string>> {
  return new Set(((await db.execute(sql`select name_key from portal_client_aliases where removed_at is null`)).rows as Row[]).map((r) => String(r.name_key)));
}

export type ReconcileResult = { checked: number; created: number; failed: number };

/**
 * Red de seguridad (cron): cualquier cliente NUEVO (creado desde la fecha de corte) que haya entrado por un camino no cubierto
 * por los ganchos —importaciones, sincronizaciones, flujos futuros— recibe su código. No toca a los clientes históricos.
 */
export async function reconcileNewClients(db: SqlExec = getDb() as unknown as SqlExec, limit = 200): Promise<ReconcileResult> {
  const since = await getAutoCodeCutover(db);
  const [stats, mapped] = await Promise.all([collectNames(db, since), mappedKeys(db)]);
  const pending = [...stats.values()].filter((s) => !mapped.has(s.key)).slice(0, limit);
  let created = 0;
  let failed = 0;
  for (const s of pending) {
    try {
      const r = await ensureClientIdentity(pickDisplayName(s.labels), { source: "conciliacion" }, db);
      if (r?.created) created++;
    } catch (err) {
      failed++;
      console.error("[portal] conciliación de cliente falló", err instanceof Error ? err.message : err);
    }
  }
  return { checked: pending.length, created, failed };
}

// ───────────────────────── Generación masiva de clientes históricos ─────────────────────────

export type HistoricalItem = { key: string; name: string; works: number; pedidos: number; entregas: number; similarTo: string[] };
export type HistoricalPreview = { total: number; items: HistoricalItem[]; previewToken: string };

function tokenFor(keys: string[]): string {
  return hmac("history-preview", [...keys].sort().join("|")).slice(0, 32);
}

/** Vista previa (SOLO LECTURA): clientes de GENUS OS que todavía no tienen código. No crea nada. */
export async function previewHistoricalClients(db: SqlExec = getDb() as unknown as SqlExec): Promise<HistoricalPreview> {
  const [stats, mapped] = await Promise.all([collectNames(db, null), mappedKeys(db)]);
  const pending = [...stats.values()].filter((s) => !mapped.has(s.key));
  const bySimilar = new Map<string, string[]>();
  for (const s of [...stats.values()]) {
    const k = similarityKey(s.key);
    bySimilar.set(k, [...(bySimilar.get(k) ?? []), pickDisplayName(s.labels)]);
  }
  const items = pending
    .map((s): HistoricalItem => {
      const name = pickDisplayName(s.labels);
      return { key: s.key, name, works: s.works, pedidos: s.pedidos, entregas: s.entregas, similarTo: (bySimilar.get(similarityKey(s.key)) ?? []).filter((x) => x !== name) };
    })
    .sort((a, b) => b.works + b.pedidos + b.entregas - (a.works + a.pedidos + a.entregas) || a.name.localeCompare(b.name, "es"));
  return { total: items.length, items, previewToken: tokenFor(items.map((i) => i.key)) };
}

export type HistoricalResult = { created: number; skippedExisting: number; failed: number; codes: Array<{ name: string; publicCode: string }> };

/**
 * Generación masiva CONFIRMADA: exige el token de la vista previa vigente (si los datos cambiaron, hay que revisarla de nuevo)
 * y la cantidad que se va a crear. Es idempotente: lo que ya tiene código se reutiliza. NUNCA habilita accesos ni envía correos.
 */
export async function generateHistoricalClients(
  actor: string,
  input: { previewToken: unknown; expectedCount: unknown; excludeKeys?: unknown },
  db: SqlExec = getDb() as unknown as SqlExec,
): Promise<HistoricalResult> {
  const preview = await previewHistoricalClients(db);
  if (typeof input.previewToken !== "string" || input.previewToken !== preview.previewToken) {
    throw new PortalError("La lista cambió desde la vista previa. Revisala de nuevo antes de confirmar.", 409, "PREVIEW_STALE");
  }
  const exclude = new Set(Array.isArray(input.excludeKeys) ? input.excludeKeys.map(String) : []);
  const selected = preview.items.filter((i) => !exclude.has(i.key));
  if (Number(input.expectedCount) !== selected.length) {
    throw new PortalError(`La cantidad confirmada (${String(input.expectedCount)}) no coincide con la lista (${selected.length}).`, 409, "COUNT_MISMATCH");
  }
  if (selected.length > 2000) throw new PortalError("Son demasiados clientes de una vez (máximo 2000). Excluí algunos y repetí.", 400, "TOO_MANY");
  const result: HistoricalResult = { created: 0, skippedExisting: 0, failed: 0, codes: [] };
  for (const item of selected) {
    try {
      const r = await ensureClientIdentity(item.name, { source: "historico", actor }, db);
      if (!r) result.failed++;
      else if (r.created) {
        result.created++;
        result.codes.push({ name: r.name, publicCode: r.publicCode });
      } else result.skippedExisting++;
    } catch (err) {
      result.failed++;
      console.error("[portal] generación histórica: falló un cliente", err instanceof Error ? err.message : err);
    }
  }
  await audit(db, { type: "GENERACION_HISTORICA", kind: "STAFF", actor, detail: { created: result.created, skippedExisting: result.skippedExisting, failed: result.failed } });
  return result;
}
