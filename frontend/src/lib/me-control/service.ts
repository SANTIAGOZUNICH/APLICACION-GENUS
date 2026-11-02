/**
 * Control inteligente de ME — servicio sobre Postgres.
 *
 * Reutiliza, sin copiar nada:
 *   - la planificación: `work_items` de Envasado Masivo / Premium (cliente, producto, cantidad, fecha);
 *   - el stock: el MISMO cálculo que Depósito → Stock ME (`loadLedgerInputs` + `computeMeStock`);
 *   - la IA: Creamy OS / Gemini (`askGeminiJson`), solo para SUGERIR accesorios entre candidatos reales.
 *
 * NO escribe stock, pedidos, fórmulas ni la planificación. Solo escribe su configuración (`me_product_materials`,
 * `me_material_compat`), las alertas (`me_control_alerts`) y la auditoría (`inv_audit`).
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql, gte, lte, ne } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import { invAudit, meControlAlerts, meMaterialCompat, meProductMaterials, workItems } from "@/lib/db/schema";
import { loadLedgerInputs, stockOf } from "@/lib/inventory/me-planilla-db";
import { normalizeMeCodigo } from "@/lib/inventory/me-codigo";
import { askGeminiJson } from "@/lib/inventory/receipt-extraction";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import { parseArDecimal } from "@/lib/utils/ar-number-parsing";
import {
  buildFindings,
  decideTransition,
  describeShortage,
  describeUnidentified,
  evaluateJobs,
  JOB_STATE_LABELS,
  findingHash,
  productKey,
  type AlertFinding,
  type AlertStatus,
  type ConfigRow,
  type ConfigSource,
  type ConfigStatus,
  type JobResult,
  type MeJob,
} from "./compute";
import { classifyRole, isSectorEnvasado, keyOf, ME_ROLES, type MeRole } from "./families";
import { buildAccessoryPrompt, deterministicSuggestions, parseAccessoryAnswer, type AccessoryGap, type CatalogMaterial, type CompatRow } from "./suggest";

export type MeControlActor = { email: string; sector: string; roleId?: string | null; isSuperadmin?: boolean };
type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const isSuper = (a: MeControlActor) => Boolean(a.isSuperadmin) || String(a.roleId ?? "").toUpperCase() === "ROL-SU";
const sectorOf = (a: MeControlActor) => String(a.sector ?? "").toUpperCase();
/** Ver el control y las alertas: Depósito, Producción, Dirección (y superusuario). Solo lectura salvo Depósito. */
export const canViewMeControl = (a: MeControlActor) => isSuper(a) || ["DEPOSITO", "PRODUCCION", "DIRECCION"].includes(sectorOf(a));
/** Confirmar/corregir asociaciones de ME y cerrar alertas: Depósito (y superusuario). Producción y Dirección NO. */
export const canManageMeControl = (a: MeControlActor) => isSuper(a) || sectorOf(a) === "DEPOSITO";

function assertView(a: MeControlActor) {
  if (!canViewMeControl(a)) throw new OrdersForbiddenError("Tu sector no puede consultar el Control de ME.");
}
function assertManage(a: MeControlActor) {
  if (!canManageMeControl(a)) throw new OrdersForbiddenError("Solo Depósito puede confirmar materiales o cerrar alertas del Control de ME.");
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function weekStartOf(anyDay: string): string {
  const d = new Date(`${anyDay}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return iso(new Date(d.getTime() - dow * DAY));
}
const addDays = (day: string, n: number) => iso(new Date(new Date(`${day}T12:00:00Z`).getTime() + n * DAY));
const WEIGHT_UNITS = /^(kg|kgs|g|gr|grs|l|lt|lts|ml|litros?|kilos?)$/i;

// ───────────────────────────── Lectura de datos ─────────────────────────────

type Loaded = {
  catalog: CatalogMaterial[];
  labels: Map<string, string>;
  stock: Map<string, number>;
  configs: Map<string, ConfigRow[]>;
  compat: CompatRow[];
};

function rowOf(r: typeof meProductMaterials.$inferSelect): ConfigRow {
  return { id: r.id, materialCodigo: r.materialCodigo, role: (ME_ROLES as readonly string[]).includes(r.role) ? (r.role as MeRole) : "OTRO", qtyPerUnit: r.qtyPerUnit, required: r.required, status: r.status as ConfigStatus, source: r.source as ConfigSource, reason: r.reason };
}

async function loadAll(db: Db | Tx, extraCodes: Iterable<string> = []): Promise<Loaded> {
  const ledger = await loadLedgerInputs(db as Db);
  const catalog: CatalogMaterial[] = [];
  const labels = new Map<string, string>();
  const seen = new Set<string>();
  for (const m of ledger.materials) {
    if (m.archived) continue;
    const k = keyOf(normalizeMeCodigo(m.codigo));
    if (!k || seen.has(k)) continue;
    seen.add(k);
    catalog.push({ codigo: normalizeMeCodigo(m.codigo), descripcion: m.descripcion ?? "", cliente: m.cliente ?? "", producto: m.producto ?? "" });
    labels.set(k, m.descripcion ?? "");
  }
  const cfgRows = await db.select().from(meProductMaterials);
  const configs = new Map<string, ConfigRow[]>();
  const wanted = new Set<string>([...extraCodes].map((c) => keyOf(c)));
  for (const r of cfgRows) {
    const k = `${r.clientKey}||${r.productKey}`;
    configs.set(k, [...(configs.get(k) ?? []), rowOf(r)]);
    if (r.materialCodigo) wanted.add(keyOf(r.materialCodigo));
  }
  const stock = new Map<string, number>();
  for (const c of wanted) {
    if (!seen.has(c)) continue; // código inexistente en el inventario: «sin datos», no «0»
    stock.set(c, stockOf(c, ledger).stock);
  }
  const compat = (await db.select().from(meMaterialCompat)).map((c) => ({ baseCodigo: c.baseCodigo, accessoryCodigo: c.accessoryCodigo, status: c.status as CompatRow["status"] }));
  return { catalog, labels, stock, configs, compat };
}

async function loadJobs(db: Db | Tx, from: string, to: string): Promise<MeJob[]> {
  const rows = await db
    .select()
    .from(workItems)
    .where(
      and(
        isNull(workItems.deletedAt),
        inArray(workItems.sector, ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]),
        gte(workItems.plannedDate, from),
        lte(workItems.plannedDate, to),
        ne(workItems.status, "BORRADOR"),
        ne(workItems.status, "CANCELADO"),
        sql`${workItems.operationalStatus} not in ('cancelado','completo','entregado','en_codificado','codificado_completo')`
      )
    );
  return rows
    .filter((w) => isSectorEnvasado(String(w.sector)))
    .map((w) => {
      const parsed = parseArDecimal(w.plannedQuantity).value;
      const weight = WEIGHT_UNITS.test(String(w.unit ?? "").trim());
      const units = !weight ? parsed : w.packagingTotalUnits != null && w.packagingTotalUnits > 0 ? w.packagingTotalUnits : null;
      return { id: w.id, client: w.client, product: w.product, sector: String(w.sector), qty: units != null && units > 0 ? units : null, unit: weight && units != null ? "un." : String(w.unit ?? ""), date: w.plannedDate ? String(w.plannedDate) : null, createdAt: w.createdAt.toISOString() };
    });
}

// ───────────────────────────── Informe por semana ─────────────────────────────

export type WeekReport = {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  jobs: Array<JobResult & { stateLabel: string }>;
  schemaPending: boolean;
};

export async function getWeekReport(actor: MeControlActor, anyDay: string): Promise<WeekReport> {
  assertView(actor);
  const weekStart = weekStartOf(anyDay);
  const weekEnd = addDays(weekStart, 6);
  if (!isDatabaseConfigured()) return { weekStart, weekEnd, generatedAt: new Date().toISOString(), jobs: [], schemaPending: false };
  const db = getDb();
  try {
    const jobs = await loadJobs(db, weekStart, weekEnd);
    const data = await loadAll(db);
    const results = evaluateJobs({ jobs, configs: data.configs, stock: data.stock, labels: data.labels });
    return { weekStart, weekEnd, generatedAt: new Date().toISOString(), jobs: results.map((r) => ({ ...r, stateLabel: JOB_STATE_LABELS[r.state] })), schemaPending: false };
  } catch (err) {
    if (isMissingSchemaError(err)) return { weekStart, weekEnd, generatedAt: new Date().toISOString(), jobs: [], schemaPending: true };
    throw err;
  }
}

// ───────────────────────────── Alertas ─────────────────────────────

export type AlertDto = {
  id: string;
  alertKey: string;
  weekStart: string;
  client: string;
  product: string;
  status: AlertStatus;
  totalQty: number | null;
  jobs: AlertFinding["jobs"];
  shortages: AlertFinding["shortages"];
  unidentified: AlertFinding["unidentified"];
  sinAsociacion: boolean;
  lines: string[];
  reopenCount: number;
  closedBy: string | null;
  closedAt: string | null;
  updatedAt: string;
};

function toDto(r: typeof meControlAlerts.$inferSelect): AlertDto {
  const p = r.payload as Partial<AlertFinding> & { closedKeys?: Record<string, number> };
  const shortages = p.shortages ?? [];
  const unidentified = p.unidentified ?? [];
  const lines = [...shortages.map(describeShortage), ...unidentified.map(describeUnidentified), ...(p.sinAsociacion ? ["REVISAR: el producto no tiene materiales de empaque asociados."] : [])];
  return { id: r.id, alertKey: r.alertKey, weekStart: r.weekStart, client: r.client, product: r.product, status: r.status as AlertStatus, totalQty: p.totalQty ?? null, jobs: p.jobs ?? [], shortages, unidentified, sinAsociacion: Boolean(p.sinAsociacion), lines, reopenCount: r.reopenCount, closedBy: r.closedBy, closedAt: r.closedAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString() };
}

const MAX_AI_PER_SYNC = 2;
const HORIZON_PAST = 1;
const HORIZON_FUTURE = 8;
const g = globalThis as unknown as { __genusMeSync?: { at: number; running: Promise<SyncSummary> | null }; __genusMeAi?: Map<string, number> };
const syncState = () => (g.__genusMeSync ??= { at: 0, running: null });

export type SyncSummary = { weeks: number; findings: number; created: number; reopened: number; updated: number; resolved: number; aiAsked: number };

type AskFn = (prompt: string) => Promise<{ ok: true; json: unknown } | { ok: false; message: string }>;
export type SyncOptions = { today?: string; ask?: AskFn; ai?: boolean };

/**
 * Recalcula el control de las próximas semanas, completa sugerencias y sincroniza las alertas persistentes.
 * Idempotente: se puede llamar tantas veces como haga falta sin duplicar alertas.
 */
export async function syncMeControl(opts: SyncOptions = {}): Promise<SyncSummary> {
  const sum: SyncSummary = { weeks: 0, findings: 0, created: 0, reopened: 0, updated: 0, resolved: 0, aiAsked: 0 };
  if (!isDatabaseConfigured()) return sum;
  const db = getDb();
  try {
    const today = opts.today ?? iso(new Date());
    const current = weekStartOf(today);
    const horizon = Array.from({ length: HORIZON_PAST + HORIZON_FUTURE + 1 }, (_, i) => addDays(current, (i - HORIZON_PAST) * 7));
    const open = await db.select({ weekStart: meControlAlerts.weekStart }).from(meControlAlerts).where(ne(meControlAlerts.status, "RESUELTA"));
    const weeks = [...new Set([...horizon, ...open.map((o) => o.weekStart)])].sort();
    sum.weeks = weeks.length;

    // 1) Trabajos de todas las semanas relevantes.
    const jobsByWeek = new Map<string, MeJob[]>();
    for (const w of weeks) jobsByWeek.set(w, await loadJobs(db, w, addDays(w, 6)));
    const allJobs = [...jobsByWeek.values()].flat();

    // 2) Sugerencias determinísticas (y, si hace falta, IA) para los productos que aparecen en trabajos.
    const products = new Map<string, { client: string; product: string }>();
    for (const j of allJobs) products.set(productKey(j.client, j.product), { client: j.client, product: j.product });
    for (const p of products.values()) sum.aiAsked += await ensureSuggestions(db, p.client, p.product, { ask: opts.ask, ai: opts.ai !== false && sum.aiAsked < MAX_AI_PER_SYNC });

    // 3) Evaluación por semana con el stock UNA sola vez (el reparto entre trabajos lo hace evaluateJobs).
    const data = await loadAll(db);
    const findings: AlertFinding[] = [];
    for (const w of weeks) {
      const results = evaluateJobs({ jobs: jobsByWeek.get(w) ?? [], configs: data.configs, stock: data.stock, labels: data.labels });
      findings.push(...buildFindings(w, results));
    }
    sum.findings = findings.length;

    // 4) Alertas persistentes (una transacción, con candado: sin duplicados aunque corran dos sincronizaciones a la vez).
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('genus-me-control-sync'))`);
      const existing = await tx.select().from(meControlAlerts).where(inArray(meControlAlerts.weekStart, weeks));
      const byKey = new Map(existing.map((e) => [e.alertKey, e]));
      const seen = new Set<string>();
      const now = new Date();
      for (const f of findings) {
        seen.add(f.alertKey);
        const ex = byKey.get(f.alertKey) ?? null;
        const hash = findingHash(f);
        const prevPayload = (ex?.payload ?? {}) as { closedKeys?: Record<string, number> };
        const tr = decideTransition(ex ? { status: ex.status as AlertStatus, closedKeys: prevPayload.closedKeys ?? null } : null, f);
        if (tr.type === "create") {
          await tx.insert(meControlAlerts).values({ alertKey: f.alertKey, weekStart: f.weekStart, client: f.client, product: f.product, status: "ABIERTA", versionHash: hash, payload: f }).onConflictDoNothing();
          sum.created += 1;
        } else if (tr.type === "update" && ex) {
          const unchanged = ex.versionHash === hash && ex.status === tr.status;
          if (unchanged) continue;
          const payload = tr.reopened ? f : { ...f, ...(prevPayload.closedKeys ? { closedKeys: prevPayload.closedKeys } : {}) };
          await tx
            .update(meControlAlerts)
            .set({ status: tr.status, versionHash: hash, payload, updatedAt: now, ...(tr.reopened ? { reopenCount: ex.reopenCount + 1, closedBy: null, closedAt: null, closedVersionHash: null, resolvedAt: null } : {}) })
            .where(eq(meControlAlerts.id, ex.id));
          if (tr.reopened) sum.reopened += 1;
          else sum.updated += 1;
        }
      }
      for (const ex of existing) {
        if (seen.has(ex.alertKey) || ex.status === "RESUELTA") continue;
        await tx.update(meControlAlerts).set({ status: "RESUELTA", resolvedAt: now, updatedAt: now }).where(eq(meControlAlerts.id, ex.id));
        sum.resolved += 1;
      }
    });
    return sum;
  } catch (err) {
    if (isMissingSchemaError(err)) return sum;
    throw err;
  }
}

/** Sincroniza con un máximo de frecuencia (lecturas repetidas de la pantalla no recalculan cada vez). */
export async function syncMeControlIfStale(maxAgeMs = 6000, opts: SyncOptions = {}): Promise<void> {
  const st = syncState();
  if (st.running) {
    await st.running.catch(() => undefined);
    return;
  }
  if (Date.now() - st.at < maxAgeMs) return;
  st.running = syncMeControl(opts).finally(() => {
    st.at = Date.now();
    st.running = null;
  });
  await st.running.catch((err) => console.error("[me-control] sync", err instanceof Error ? err.message : err));
}

export async function listAlerts(actor: MeControlActor, opts: { statuses?: AlertStatus[]; sync?: boolean } = {}): Promise<{ alerts: AlertDto[]; openCount: number; schemaPending: boolean }> {
  assertView(actor);
  if (!isDatabaseConfigured()) return { alerts: [], openCount: 0, schemaPending: false };
  if (opts.sync !== false) await syncMeControlIfStale();
  try {
    const rows = await getDb()
      .select()
      .from(meControlAlerts)
      .where(inArray(meControlAlerts.status, opts.statuses ?? ["ABIERTA"]));
    const alerts = rows.map(toDto).sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.client.localeCompare(b.client) || a.product.localeCompare(b.product));
    return { alerts, openCount: alerts.filter((a) => a.status === "ABIERTA").length, schemaPending: false };
  } catch (err) {
    if (isMissingSchemaError(err)) return { alerts: [], openCount: 0, schemaPending: true };
    throw err;
  }
}

/** Cierra la NOTIFICACIÓN. No borra el faltante ni marca nada como recibido. Guarda quién y cuándo. */
export async function closeAlert(actor: MeControlActor, id: string): Promise<AlertDto> {
  assertManage(actor);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(meControlAlerts).where(eq(meControlAlerts.id, id)).for("update");
    if (!row) throw new OrdersNotFoundError("Alerta no encontrada.");
    if (row.status === "CERRADA") return toDto(row);
    const payload = row.payload as AlertFinding & { closedKeys?: Record<string, number> };
    const now = new Date();
    const [upd] = await tx
      .update(meControlAlerts)
      .set({ status: row.status === "RESUELTA" ? "RESUELTA" : "CERRADA", closedBy: actor.email, closedAt: now, closedVersionHash: row.versionHash, payload: { ...payload, closedKeys: payload.keys ?? {} }, updatedAt: now })
      .where(eq(meControlAlerts.id, id))
      .returning();
    await audit(tx, actor, id, "alerta_cerrada", { status: row.status, versionHash: row.versionHash }, { status: upd!.status }, "Notificación cerrada por el usuario (el faltante sigue calculándose)");
    return toDto(upd!);
  });
}

// ───────────────────────────── Configuración por producto ─────────────────────────────

async function audit(tx: Tx, actor: MeControlActor, entityId: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, reason: string) {
  const a = { id: randomUUID(), module: "me_control", entityId, action, actor: actor.email, actorSector: actor.sector, reason, before, after, createdAt: new Date().toISOString() };
  await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
}

export type ConfigView = { client: string; product: string; rows: Array<ConfigRow & { materialLabel: string; stock: number | null; stockKnown: boolean }>; compat: CompatRow[] };

export async function getProductConfig(actor: MeControlActor, client: string, product: string): Promise<ConfigView> {
  assertView(actor);
  const data = await loadAll(getDb());
  const rows = data.configs.get(productKey(client, product)) ?? [];
  return {
    client,
    product,
    rows: rows.map((r) => ({ ...r, materialLabel: r.materialCodigo ? `${r.materialCodigo} — ${data.labels.get(keyOf(r.materialCodigo)) ?? "(no está en Stock ME)"}` : "", stock: r.materialCodigo ? (data.stock.get(keyOf(r.materialCodigo)) ?? null) : null, stockKnown: r.materialCodigo ? data.stock.has(keyOf(r.materialCodigo)) : false })),
    compat: data.compat.filter((c) => rows.some((r) => r.materialCodigo && keyOf(r.materialCodigo) === keyOf(c.baseCodigo))),
  };
}

export async function searchMaterials(actor: MeControlActor, q: string, limit = 25): Promise<Array<{ codigo: string; descripcion: string; cliente: string; role: MeRole; stock: number }>> {
  assertView(actor);
  const ledger = await loadLedgerInputs(getDb());
  const needle = keyOf(q);
  const seen = new Set<string>();
  const out: Array<{ codigo: string; descripcion: string; cliente: string; role: MeRole; stock: number }> = [];
  for (const m of ledger.materials) {
    if (m.archived) continue;
    const code = normalizeMeCodigo(m.codigo);
    if (!code || seen.has(keyOf(code))) continue;
    const hay = keyOf(`${code} ${m.descripcion} ${m.cliente} ${m.producto ?? ""}`);
    if (needle && !needle.split(" ").every((w) => hay.includes(w))) continue;
    seen.add(keyOf(code));
    out.push({ codigo: code, descripcion: m.descripcion ?? "", cliente: m.cliente ?? "", role: classifyRole(m.descripcion ?? ""), stock: stockOf(code, ledger).stock });
    if (out.length >= limit) break;
  }
  return out;
}

const keys = (client: string, product: string) => ({ clientKey: keyOf(client), productKey: keyOf(product) });

async function lockProduct(tx: Tx, client: string, product: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`genus-me-config:${productKey(client, product)}`}))`);
}

function cleanText(s: unknown, label: string): string {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  if (!t) throw new OrdersValidationError(`Falta ${label}.`);
  return t;
}
function cleanQty(v: unknown): number {
  const n = typeof v === "number" ? v : parseArDecimal(String(v ?? "")).value;
  if (n == null || !Number.isFinite(n) || n <= 0 || n > 1000) throw new OrdersValidationError("La cantidad por unidad debe ser un número mayor que 0.");
  return Math.round(n * 1e6) / 1e6;
}

async function assertMaterialExists(tx: Tx | Db, codigo: string): Promise<string> {
  const code = normalizeMeCodigo(codigo);
  const ledger = await loadLedgerInputs(tx as Db);
  const mat = ledger.materials.find((m) => !m.archived && keyOf(normalizeMeCodigo(m.codigo)) === keyOf(code));
  if (!mat) throw new OrdersValidationError(`El material ${codigo} no existe en el inventario de ME.`);
  return normalizeMeCodigo(mat.codigo);
}

export type AddMaterialInput = { client: string; product: string; materialCodigo?: string | null; role?: string; qtyPerUnit?: number | string; required?: boolean };

/** Agrega (o confirma) un material de un producto. Si materialCodigo es null, registra un rol pendiente de identificar. */
export async function addMaterial(actor: MeControlActor, input: AddMaterialInput): Promise<ConfigRow> {
  assertManage(actor);
  const client = cleanText(input.client, "el cliente");
  const product = cleanText(input.product, "el producto");
  const qty = input.qtyPerUnit == null ? 1 : cleanQty(input.qtyPerUnit);
  const db = getDb();
  const out = await db.transaction(async (tx) => {
    await lockProduct(tx, client, product);
    const code = input.materialCodigo ? await assertMaterialExists(tx, input.materialCodigo) : null;
    let role: MeRole = (ME_ROLES as readonly string[]).includes(String(input.role)) ? (input.role as MeRole) : "OTRO";
    if (code && !input.role) {
      const ledger = await loadLedgerInputs(tx as unknown as Db);
      role = classifyRole(ledger.materials.find((m) => keyOf(normalizeMeCodigo(m.codigo)) === keyOf(code))?.descripcion ?? "");
    }
    const k = keys(client, product);
    const existing = await tx.select().from(meProductMaterials).where(and(eq(meProductMaterials.clientKey, k.clientKey), eq(meProductMaterials.productKey, k.productKey)));
    const same = existing.find((r) => r.role === role && keyOf(r.materialCodigo ?? "") === keyOf(code ?? ""));
    const now = new Date();
    let row: typeof meProductMaterials.$inferSelect;
    const status: ConfigStatus = code ? "CONFIRMADO" : "PENDIENTE";
    if (same) {
      [row] = await tx.update(meProductMaterials).set({ qtyPerUnit: qty, required: input.required ?? same.required, status, source: "MANUAL", confirmedBy: code ? actor.email : null, confirmedAt: code ? now : null, updatedBy: actor.email, updatedAt: now }).where(eq(meProductMaterials.id, same.id)).returning();
    } else {
      [row] = await tx.insert(meProductMaterials).values({ ...k, client, product, materialCodigo: code, role, qtyPerUnit: qty, required: input.required ?? true, status, source: "MANUAL", reason: code ? "Agregado por Depósito" : "Rol pendiente de identificar", createdBy: actor.email, confirmedBy: code ? actor.email : null, confirmedAt: code ? now : null }).returning();
    }
    if (code) {
      // Un rol pendiente del mismo tipo queda resuelto por el material confirmado.
      await tx.delete(meProductMaterials).where(and(eq(meProductMaterials.clientKey, k.clientKey), eq(meProductMaterials.productKey, k.productKey), eq(meProductMaterials.role, role), isNull(meProductMaterials.materialCodigo)));
      await rememberCompat(tx, actor, existing, role, code);
    }
    await audit(tx, actor, row!.id, same ? "me_producto_actualizado" : "me_producto_agregado", same ? { qtyPerUnit: same.qtyPerUnit, status: same.status } : null, { materialCodigo: code, role, qtyPerUnit: qty, status }, `${client} — ${product}`);
    return rowOf(row!);
  });
  await syncMeControl({ ai: false });
  return out;
}

/** Al confirmar un accesorio de un producto con envase confirmado, queda registrada la compatibilidad para el futuro. */
async function rememberCompat(tx: Tx, actor: MeControlActor, existing: Array<typeof meProductMaterials.$inferSelect>, role: MeRole, code: string) {
  if (role !== "CIERRE" && role !== "DISPENSADOR") return;
  for (const base of existing.filter((r) => r.role === "ENVASE" && r.status === "CONFIRMADO" && r.materialCodigo)) {
    await tx.insert(meMaterialCompat).values({ baseCodigo: base.materialCodigo!, accessoryCodigo: code, status: "COMPATIBLE", note: "Confirmado por Depósito en la configuración del producto", createdBy: actor.email }).onConflictDoNothing();
  }
}

async function mutateRow<T>(actor: MeControlActor, id: string, fn: (tx: Tx, row: typeof meProductMaterials.$inferSelect) => Promise<T>): Promise<T> {
  assertManage(actor);
  const db = getDb();
  const out = await db.transaction(async (tx) => {
    const [peek] = await tx.select().from(meProductMaterials).where(eq(meProductMaterials.id, id));
    if (!peek) throw new OrdersNotFoundError("Material del producto no encontrado.");
    await lockProduct(tx, peek.client, peek.product);
    const [row] = await tx.select().from(meProductMaterials).where(eq(meProductMaterials.id, id)).for("update");
    if (!row) throw new OrdersNotFoundError("Material del producto no encontrado.");
    return fn(tx, row);
  });
  await syncMeControl({ ai: false });
  return out;
}

/** Confirma una sugerencia (opcionalmente con otra cantidad por unidad). */
export function confirmRow(actor: MeControlActor, id: string, patch: { qtyPerUnit?: number | string } = {}) {
  return mutateRow(actor, id, async (tx, row) => {
    if (!row.materialCodigo) throw new OrdersValidationError("Elegí el material exacto antes de confirmar (usá «Reemplazar»).");
    const qty = patch.qtyPerUnit == null ? row.qtyPerUnit : cleanQty(patch.qtyPerUnit);
    const now = new Date();
    const [upd] = await tx.update(meProductMaterials).set({ status: "CONFIRMADO", qtyPerUnit: qty, confirmedBy: actor.email, confirmedAt: now, updatedBy: actor.email, updatedAt: now }).where(eq(meProductMaterials.id, row.id)).returning();
    const siblings = await tx.select().from(meProductMaterials).where(and(eq(meProductMaterials.clientKey, row.clientKey), eq(meProductMaterials.productKey, row.productKey)));
    await rememberCompat(tx, actor, siblings, row.role as MeRole, row.materialCodigo);
    await audit(tx, actor, row.id, "me_sugerencia_confirmada", { status: row.status, source: row.source }, { status: "CONFIRMADO", qtyPerUnit: qty }, `${row.client} — ${row.product}: ${row.materialCodigo}`);
    return rowOf(upd!);
  });
}

/** Rechaza una sugerencia: no vuelve a proponerse para este producto. */
export function rejectRow(actor: MeControlActor, id: string) {
  return mutateRow(actor, id, async (tx, row) => {
    const now = new Date();
    const [upd] = await tx.update(meProductMaterials).set({ status: "RECHAZADO", updatedBy: actor.email, updatedAt: now }).where(eq(meProductMaterials.id, row.id)).returning();
    await audit(tx, actor, row.id, "me_sugerencia_rechazada", { status: row.status, source: row.source }, { status: "RECHAZADO" }, `${row.client} — ${row.product}: ${row.materialCodigo ?? row.role}`);
    return rowOf(upd!);
  });
}

export function removeRow(actor: MeControlActor, id: string) {
  return mutateRow(actor, id, async (tx, row) => {
    await tx.delete(meProductMaterials).where(eq(meProductMaterials.id, row.id));
    await audit(tx, actor, row.id, "me_producto_quitado", { materialCodigo: row.materialCodigo, role: row.role, qtyPerUnit: row.qtyPerUnit, status: row.status }, null, `${row.client} — ${row.product}`);
    return { id: row.id };
  });
}

export function updateRow(actor: MeControlActor, id: string, patch: { qtyPerUnit?: number | string; required?: boolean }) {
  return mutateRow(actor, id, async (tx, row) => {
    const qty = patch.qtyPerUnit == null ? row.qtyPerUnit : cleanQty(patch.qtyPerUnit);
    const [upd] = await tx.update(meProductMaterials).set({ qtyPerUnit: qty, required: patch.required ?? row.required, updatedBy: actor.email, updatedAt: new Date() }).where(eq(meProductMaterials.id, row.id)).returning();
    await audit(tx, actor, row.id, "me_producto_actualizado", { qtyPerUnit: row.qtyPerUnit, required: row.required }, { qtyPerUnit: qty, required: upd!.required }, `${row.client} — ${row.product}`);
    return rowOf(upd!);
  });
}

/** Reemplaza el material de una fila por otro (búsqueda libre en todo el inventario de ME). Queda CONFIRMADO. */
export function replaceRow(actor: MeControlActor, id: string, newCodigo: string) {
  return mutateRow(actor, id, async (tx, row) => {
    const code = await assertMaterialExists(tx, newCodigo);
    const dup = await tx.select({ id: meProductMaterials.id }).from(meProductMaterials).where(and(eq(meProductMaterials.clientKey, row.clientKey), eq(meProductMaterials.productKey, row.productKey), eq(meProductMaterials.role, row.role), sql`upper(coalesce(${meProductMaterials.materialCodigo},'')) = ${keyOf(code)}`, ne(meProductMaterials.id, row.id)));
    if (dup.length) throw new OrdersValidationError("Ese material ya está asociado al producto.");
    const now = new Date();
    const [upd] = await tx.update(meProductMaterials).set({ materialCodigo: code, status: "CONFIRMADO", source: "MANUAL", reason: row.materialCodigo ? `Reemplaza a ${row.materialCodigo}` : "Identificado por Depósito", confirmedBy: actor.email, confirmedAt: now, updatedBy: actor.email, updatedAt: now }).where(eq(meProductMaterials.id, row.id)).returning();
    const siblings = await tx.select().from(meProductMaterials).where(and(eq(meProductMaterials.clientKey, row.clientKey), eq(meProductMaterials.productKey, row.productKey)));
    await rememberCompat(tx, actor, siblings, row.role as MeRole, code);
    await audit(tx, actor, row.id, "me_producto_reemplazado", { materialCodigo: row.materialCodigo, status: row.status, source: row.source }, { materialCodigo: code, status: "CONFIRMADO" }, `${row.client} — ${row.product}`);
    return rowOf(upd!);
  });
}

export async function setCompat(actor: MeControlActor, input: { baseCodigo: string; accessoryCodigo: string; status: "COMPATIBLE" | "INCOMPATIBLE"; note?: string }) {
  assertManage(actor);
  if (input.status !== "COMPATIBLE" && input.status !== "INCOMPATIBLE") throw new OrdersValidationError("Estado de compatibilidad inválido.");
  const db = getDb();
  const base = await assertMaterialExists(db, input.baseCodigo);
  const acc = await assertMaterialExists(db, input.accessoryCodigo);
  if (keyOf(base) === keyOf(acc)) throw new OrdersValidationError("El envase y el accesorio no pueden ser el mismo material.");
  await db.transaction(async (tx) => {
    await tx.insert(meMaterialCompat).values({ baseCodigo: base, accessoryCodigo: acc, status: input.status, note: String(input.note ?? "").slice(0, 300), createdBy: actor.email }).onConflictDoUpdate({ target: [meMaterialCompat.baseCodigo, meMaterialCompat.accessoryCodigo], set: { status: input.status, note: String(input.note ?? "").slice(0, 300), createdBy: actor.email } });
    await audit(tx, actor, `${base}|${acc}`, "me_compatibilidad", null, { baseCodigo: base, accessoryCodigo: acc, status: input.status }, input.note ?? "");
    if (input.status === "INCOMPATIBLE") {
      // Una sugerencia sin confirmar entre estas dos piezas deja de tener sentido.
      const bases = await tx.select().from(meProductMaterials).where(and(eq(meProductMaterials.status, "SUGERIDO"), sql`upper(${meProductMaterials.materialCodigo}) = ${keyOf(acc)}`));
      for (const r of bases) await tx.update(meProductMaterials).set({ status: "RECHAZADO", reason: "Marcado como incompatible", updatedBy: actor.email, updatedAt: new Date() }).where(eq(meProductMaterials.id, r.id));
    }
  });
  await syncMeControl({ ai: false });
  return { ok: true };
}

// ───────────────────────────── Sugerencias (inventario / compatibilidades / IA) ─────────────────────────────

const AI_RETRY_MS = 6 * 3600_000;
const aiMemo = () => (g.__genusMeAi ??= new Map());

/**
 * Completa, para un producto, las sugerencias que se pueden deducir (vínculo del inventario, compatibilidades registradas) y,
 * si corresponde, pide a la IA que evalúe candidatos reales. Devuelve cuántas consultas a la IA hizo (0 ó 1).
 */
export async function ensureSuggestions(db: Db, client: string, product: string, opts: { ask?: AskFn; ai?: boolean; force?: boolean } = {}): Promise<number> {
  const data = await loadAll(db);
  const rows = data.configs.get(productKey(client, product)) ?? [];
  const det = deterministicSuggestions({ client, product, rows, catalog: data.catalog, compat: data.compat });
  let asked = 0;
  const toInsert = [...det.suggestions];
  if (opts.ai !== false && det.gaps.some((x) => x.candidates.length)) {
    const gaps = det.gaps.filter((x) => x.candidates.length);
    const memoKey = `${productKey(client, product)}|${gaps.map((x) => `${x.envaseCodigo}:${x.role}:${x.candidates.map((c) => c.codigo).join(",")}`).join("|")}`;
    const last = aiMemo().get(memoKey) ?? 0;
    if (opts.force || Date.now() - last > AI_RETRY_MS) {
      aiMemo().set(memoKey, Date.now());
      const ans = await (opts.ask ?? ((p) => askGeminiJson(p)))(buildAccessoryPrompt(client, product, gaps));
      asked = 1;
      if (ans.ok) for (const hit of parseAccessoryAnswer(ans.json, gaps)) toInsert.push(hit.suggestion);
      else aiMemo().set(memoKey, Date.now() - AI_RETRY_MS + 5 * 60_000); // IA no disponible: reintenta en 5 min
    }
  }
  if (!toInsert.length) return asked;
  await db.transaction(async (tx) => {
    await lockProduct(tx, client, product);
    const k = keys(client, product);
    const now = await tx.select().from(meProductMaterials).where(and(eq(meProductMaterials.clientKey, k.clientKey), eq(meProductMaterials.productKey, k.productKey)));
    for (const s of toInsert) {
      if (now.some((r) => keyOf(r.materialCodigo ?? "") === keyOf(s.materialCodigo) && r.role === s.role)) continue;
      if (now.some((r) => r.role === s.role && r.status !== "RECHAZADO" && r.status !== "PENDIENTE")) continue; // ya hay uno de ese rol (no se pisa)
      const [row] = await tx.insert(meProductMaterials).values({ ...k, client, product, materialCodigo: s.materialCodigo, role: s.role, qtyPerUnit: s.qtyPerUnit, required: true, status: "SUGERIDO", source: s.source, reason: s.reason, createdBy: s.source === "IA" ? "creamy-os" : "sistema" }).returning({ id: meProductMaterials.id });
      now.push({ ...(row as object), clientKey: k.clientKey, productKey: k.productKey, materialCodigo: s.materialCodigo, role: s.role, status: "SUGERIDO" } as (typeof now)[number]);
      await audit(tx, { email: s.source === "IA" ? "creamy-os" : "sistema", sector: "SISTEMA" }, row!.id, "me_sugerencia", null, { materialCodigo: s.materialCodigo, role: s.role, source: s.source }, s.reason);
    }
  });
  return asked;
}

/** «Sugerir con IA» a pedido de una persona de Depósito para un producto. */
export async function suggestWithAi(actor: MeControlActor, client: string, product: string, opts: { ask?: AskFn } = {}): Promise<{ asked: number; suggestions: number }> {
  assertManage(actor);
  const db = getDb();
  const before = (await loadAll(db)).configs.get(productKey(client, product))?.length ?? 0;
  const asked = await ensureSuggestions(db, client, product, { ask: opts.ask, force: true });
  const after = (await loadAll(db)).configs.get(productKey(client, product))?.length ?? 0;
  await syncMeControl({ ai: false });
  return { asked, suggestions: Math.max(0, after - before) };
}

export type { AccessoryGap };
