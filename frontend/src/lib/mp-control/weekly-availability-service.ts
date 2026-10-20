/**
 * Control semanal de MP — disponibilidad REAL: stock del inventario (Stock MP, todos los proveedores y lotes) contra las
 * necesidades de TODAS las elaboraciones programadas en la semana. Solo lectura; no mueve stock.
 *
 * Fuentes (sin copias ni inventario paralelo):
 *   - stock: `inv_mp_stock` (la misma tabla que muestra Materias Primas → Stock);
 *   - producciones: `work_items` de Elaboración que caen en la semana (un trabajo de varios días cuenta UNA vez);
 *   - fórmula: la OE vinculada (MP y %), o la fórmula vigente de Drive/banco si todavía no hay OE;
 *   - consumos ya ejecutados: movimientos CONSUMO_OE/REVERSO de esa OE en el libro mayor (se restan de la necesidad);
 *   - equivalencias aprobadas: `mp_master_links`.
 */
import "server-only";

import { and, eq, inArray, isNull, lte, gte, or, sql } from "drizzle-orm";
import { weekShare } from "@/lib/planning/work-schedules";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { invMpStock, mpMasterLinks, mpStockMovements, mpWeeklyProductionExclusions, mpWeeklyRowState, operationalOrders, workItems } from "@/lib/db/schema";
import { normalizeMpStockPayload } from "@/lib/inventory/neon-persist";
import { parseArDecimal } from "@/lib/utils/ar-number-parsing";
import {
  computeAvailability,
  normCode,
  normText,
  round3,
  toKg,
  toNumber,
  type AvailabilityResult,
  type NameAlias,
  type ProductionInput,
  type StockLot,
} from "./availability";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import { buildProductBreakdown, type ProductSection, type ProductSummary } from "./product-breakdown";

/** Decisiones administrativas por MP (no modifican fórmula, cantidades, stock, disponibilidad ni consumos). */
export const GESTION_OPTIONS = ["", "pendiente", "comprar", "compra_solicitada", "no_comprar", "sustituir", "aporta_cliente", "resuelto"] as const;
export type Gestion = (typeof GESTION_OPTIONS)[number];

export type RowState = {
  observacion: string;
  observacionBy: string | null;
  observacionAt: string | null;
  gestion: Gestion;
  gestionBy: string | null;
  gestionAt: string | null;
  excluded: boolean;
  excludedBy: string | null;
  excludedAt: string | null;
  excludedRequerido: number | null;
  /** Aparecieron necesidades (producciones) nuevas, o la necesidad creció, desde que se excluyó: la fila vuelve a mostrarse, marcada. */
  exclusionToReview: boolean;
  /** Por qué hay que revisar la exclusión (texto para la persona). */
  exclusionReviewReason: string | null;
};
/** Alcance de una exclusión de MP: qué producciones cubría y cuánto se necesitaba cuando se quitó. */
export type ExcludedScope = { productionLabels: string[]; requeridoAtExclusion: number | null; requeridoNow: number };
export type WeeklyRow = AvailabilityResult["rows"][number] & { state: RowState; scope?: ExcludedScope };

export type WeeklyAvailability = Omit<AvailabilityResult, "rows"> & {
  rows: WeeklyRow[];
  /** MP quitadas del control de esta semana por una persona (siguen guardadas: se pueden restaurar). */
  excludedRows: WeeklyRow[];
  /** Producciones quitadas del cálculo de esta semana (se pueden restaurar). */
  excludedProductions: Array<{ workItemId: string; label: string; by: string; at: string; reason: string; /** control = quitada junto con un control eliminado/anulado/archivado; manual = la quitó una persona. */ kind: "control" | "manual" }>;
  /** Vista principal: una sección por producto con su fórmula completa. */
  products: ProductSection[];
  productSummary: ProductSummary;
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  productions: Array<{ id: string; label: string; kg: number | null; days: string; source: "OE" | "FORMULA" | "SIN_FORMULA"; oeNumber?: string; note?: string; client?: string; product?: string }>;
  stockSource: "inv_mp_stock" | "memoria";
};

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function weekBounds(anyDay: string): { start: string; end: string } {
  const d = new Date(`${anyDay}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  const start = new Date(d.getTime() - dow * DAY);
  return { start: iso(start), end: iso(new Date(start.getTime() + 6 * DAY)) };
}

/**
 * Stock MP actual: TODAS las filas de `inv_mp_stock` (la misma tabla que lista Materias Primas → Stock). No se descarta
 * ninguna por no tener código: hay filas de stock sin código y siguen siendo stock. Un error de lectura NO se
 * interpreta como «sin stock»: se propaga y la pantalla lo muestra.
 */
export async function loadStockLots(): Promise<{ lots: StockLot[]; source: WeeklyAvailability["stockSource"] }> {
  let rows;
  let source: WeeklyAvailability["stockSource"] = "inv_mp_stock";
  if (isDatabaseConfigured()) {
    rows = (await getDb().select({ payload: invMpStock.payload }).from(invMpStock)).map((r) => normalizeMpStockPayload(r.payload));
  } else {
    const { memoryInventoryRepo } = await import("@/lib/inventory/get-inventory-service");
    rows = memoryInventoryRepo.mpStock;
    source = "memoria";
  }
  return {
    source,
    lots: rows.map((r) => ({
      id: r.id,
      codigo: r.codigo ?? "",
      codigosAnteriores: r.codigosAnteriores,
      descripcion: r.descripcion ?? "",
      proveedor: r.proveedor ?? "",
      cliente: r.cliente ?? "",
      lote: r.lote ?? "",
      ubicacion: r.ubicacion ?? "",
      cantidadKg: toNumber(r.cantidadKg),
      vencimiento: r.vencimiento ?? "",
      estadoStock: r.estadoStock ?? "",
      estadoStockManual: r.estadoStockManual ?? "",
      archived: Boolean(r.archived),
    })),
  };
}

type Mem = { aliases: NameAlias[] };
const g = globalThis as unknown as { __genusMpAliasMem?: Mem };
const mem = (): Mem => (g.__genusMpAliasMem ??= { aliases: [] });

/** Equivalencias aprobadas a nivel de MATERIA PRIMA (no por lote): «GLICERINA» ⇒ «GLICERINA VEGETAL». */
export async function loadNameAliases(): Promise<NameAlias[]> {
  if (!isDatabaseConfigured()) return mem().aliases;
  try {
    const rows = await getDb().select().from(mpMasterLinks).where(eq(mpMasterLinks.kind, "name_alias"));
    return rows.map((r) => ({ formulaName: r.key.split("||")[0]!, stockName: r.masterCode }));
  } catch (err) {
    if (isMissingSchemaError(err)) return [];
    throw err;
  }
}

export async function approveNameAlias(input: { formulaName: string; stockName: string; by: string }): Promise<void> {
  const formulaName = normText(input.formulaName);
  const stockName = normText(input.stockName);
  if (!formulaName || !stockName) throw new Error("Falta la materia prima.");
  const { lots } = await loadStockLots();
  const { baseName } = await import("./availability");
  if (!lots.some((l) => baseName(l.descripcion, l.proveedor) === stockName)) throw new Error("Esa descripción no existe en el Stock MP.");
  if (!isDatabaseConfigured()) {
    const m = mem();
    if (!m.aliases.some((a) => a.formulaName === formulaName && a.stockName === stockName)) m.aliases.push({ formulaName, stockName });
    return;
  }
  await getDb()
    .insert(mpMasterLinks)
    .values({ kind: "name_alias", key: `${formulaName}||${stockName}`, masterCode: stockName, approvedBy: input.by, note: "Equivalencia por nombre (Control semanal)" })
    .onConflictDoNothing();
}

export async function removeNameAlias(input: { formulaName: string; stockName: string }): Promise<void> {
  const formulaName = normText(input.formulaName);
  const stockName = normText(input.stockName);
  if (!isDatabaseConfigured()) {
    mem().aliases = mem().aliases.filter((a) => !(a.formulaName === formulaName && a.stockName === stockName));
    return;
  }
  await getDb().delete(mpMasterLinks).where(and(eq(mpMasterLinks.kind, "name_alias"), eq(mpMasterLinks.key, `${formulaName}||${stockName}`)));
}

type OeMat = { materiaPrima?: string; codigo?: string; codigoMp?: string; formulaPct?: number | null; parentRowId?: string | null };

/** Producciones de Elaboración programadas en la semana, con su fórmula y lo que ya se consumió. */
async function loadProductions(weekStart: string, weekEnd: string): Promise<{ inputs: ProductionInput[]; meta: WeeklyAvailability["productions"] }> {
  if (!isDatabaseConfigured()) return { inputs: [], meta: [] };
  const db = getDb();
  const works = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.sector, "ELABORACION"),
        isNull(workItems.deletedAt),
        lte(workItems.plannedDate, weekEnd),
        gte(sql`coalesce(${workItems.plannedDateTo}, ${workItems.plannedDate})`, weekStart)
      )
    );
  if (works.length === 0) return { inputs: [], meta: [] };

  const workIds = works.map((w) => w.id);
  const orderIds = works.map((w) => w.orderId).filter((x): x is string => Boolean(x));
  const oes = await db
    .select()
    .from(operationalOrders)
    .where(
      and(
        isNull(operationalOrders.deletedAt),
        or(
          orderIds.length ? inArray(operationalOrders.id, orderIds) : sql`false`,
          inArray(operationalOrders.linkedWorkItemId, workIds as string[])
        )
      )
    );
  const liveOes = oes.filter((o) => o.status !== "ANULADA" && o.status !== "ARCHIVADA");
  const oeByWork = new Map<string, (typeof liveOes)[number]>();
  for (const w of works) {
    const cand = liveOes
      .filter((o) => o.id === w.orderId || o.linkedWorkItemId === w.id)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    if (cand) oeByWork.set(w.id, cand);
  }
  // Consumos ya ejecutados (libro mayor): neto por OE y código.
  const consumed = new Map<string, Map<string, number>>();
  const oeIds = [...new Set([...oeByWork.values()].map((o) => o.id))];
  if (oeIds.length) {
    const movs = await db
      .select({ refId: mpStockMovements.refId, codigo: mpStockMovements.codigo, kind: mpStockMovements.kind, quantity: mpStockMovements.quantity })
      .from(mpStockMovements)
      .where(and(eq(mpStockMovements.refType, "oe"), inArray(mpStockMovements.refId, oeIds), inArray(mpStockMovements.kind, ["CONSUMO_OE", "REVERSO"])));
    for (const m of movs) {
      if (!m.refId) continue;
      const per = consumed.get(m.refId) ?? new Map<string, number>();
      per.set(normCode(m.codigo), round3((per.get(normCode(m.codigo)) ?? 0) - m.quantity));
      consumed.set(m.refId, per);
    }
  }

  // Programaciones de la MISMA orden en varios días/semanas: la necesidad de MP de la orden se reparte en proporción a lo
  // planificado en cada semana (suma 1), en vez de contarse completa en cada una. Solo si hay más de una programación vigente.
  const rootIds = [...new Set(works.map((w) => w.scheduleRootId ?? w.id))];
  const siblings = await db
    .select()
    .from(workItems)
    .where(and(isNull(workItems.deletedAt), eq(workItems.sector, "ELABORACION"), or(inArray(workItems.id, rootIds), inArray(workItems.scheduleRootId, rootIds))));
  const groups = new Map<string, typeof siblings>();
  for (const s of siblings) {
    const k = s.scheduleRootId ?? s.id;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const shareOf = (w: (typeof works)[number]): number | null => {
    const members = groups.get(w.scheduleRootId ?? w.id) ?? [];
    if (members.length < 2) return null;
    return weekShare(
      members.map((m) => ({
        qty: toKg(parseArDecimal(m.plannedQuantity).value, m.unit),
        inPeriod: String(m.plannedDate) <= weekEnd && String(m.plannedDateTo ?? m.plannedDate) >= weekStart,
      }))
    );
  };

  const inputs: ProductionInput[] = [];
  const meta: WeeklyAvailability["productions"] = [];
  const seenOe = new Set<string>();
  const { resolveFormulaForWork } = await import("@/lib/formulas/resolve-for-work");
  for (const w of works) {
    const days = w.plannedDateTo && w.plannedDateTo !== w.plannedDate ? `${w.plannedDate} → ${w.plannedDateTo}` : w.plannedDate;
    const label = `${w.client} — ${w.product}`;
    const qtyRaw = parseArDecimal(w.plannedQuantity).value;
    const oe = oeByWork.get(w.id);
    // Duplicados: varios trabajos (p. ej. días) de la misma OE cuentan UNA vez.
    if (oe && seenOe.has(oe.id)) {
      meta.push({ id: w.id, label, kg: null, days, source: "OE", oeNumber: oe.orderNumber, client: w.client, product: w.product, note: "Misma OE que otro trabajo de la semana: no se suma de nuevo." });
      continue;
    }
    if (oe) seenOe.add(oe.id);
    const done = !oe && ["completo", "entregado", "cancelado"].includes(w.operationalStatus);
    if (w.status === "CANCELADO" || w.operationalStatus === "cancelado") {
      meta.push({ id: w.id, label, kg: null, days, source: oe ? "OE" : "SIN_FORMULA", note: "Cancelado: no se considera." });
      continue;
    }
    if (done) {
      meta.push({ id: w.id, label, kg: null, days, source: "SIN_FORMULA", note: "Ya elaborado: no se considera." });
      continue;
    }

    if (oe) {
      const fd = oe.formData as { header?: { quantityKg?: number | null }; materials?: OeMat[] };
      const share = shareOf(w);
      const fullQty = fd.header?.quantityKg != null && Number(fd.header.quantityKg) > 0 ? Number(fd.header.quantityKg) : toKg(qtyRaw, w.unit);
      const qty = fullQty != null && share != null ? round3(fullQty * share) : fullQty;
      const per = consumed.get(oe.id);
      const mats = (fd.materials ?? []).filter((m) => !m.parentRowId);
      const reliable = qty != null && qty > 0 && mats.length > 0 && mats.every((m) => m.formulaPct != null);
      inputs.push({
        id: w.id,
        client: w.client,
        label: `${label} (OE ${oe.orderNumber})`,
        product: w.product,
        oeNumber: oe.orderNumber,
        days,
        weekKg: qty ?? null,
        source: "OE",
        note: share != null ? `Orden repartida en varias programaciones: esta semana corresponde el ${Math.round(share * 100)} % de la necesidad.` : undefined,
        reliable,
        unreliableReason: !reliable ? (qty == null || qty <= 0 ? `Cantidad no válida (${w.plannedQuantity} ${w.unit})` : "La OE no tiene fórmula completa (faltan %)") : undefined,
        lines: mats.map((m) => {
          const need = reliable ? round3(((m.formulaPct ?? 0) * qty!) / 100) : null;
          return { materiaPrima: m.materiaPrima ?? "", codigo: m.codigo ?? "", codigoMp: m.codigoMp ?? "", kg: need, pct: m.formulaPct ?? null };
        }),
        consumedByCode: per ? Object.fromEntries([...per].filter(([, kg]) => kg > 0).map(([code, kg]) => [code, share != null ? round3(kg * share) : kg])) : undefined,
      });
      meta.push({ id: w.id, label, kg: qty ?? null, days, source: "OE", oeNumber: oe.orderNumber, client: w.client, product: w.product, note: share != null ? `Orden repartida en varias programaciones: esta semana corresponde el ${Math.round(share * 100)} % de la necesidad.` : undefined });
      continue;
    }

    const qty = toKg(qtyRaw, w.unit);
    const res = await resolveFormulaForWork({ client: w.client, product: w.product });
    if (!res.ok) {
      inputs.push({ id: w.id, client: w.client, label, product: w.product, days, weekKg: qty ?? null, source: "SIN_FORMULA", reliable: false, unreliableReason: `Sin fórmula encontrada: ${res.message}`, lines: [] });
      meta.push({ id: w.id, label, kg: qty ?? null, days, source: "SIN_FORMULA", client: w.client, product: w.product, note: res.message });
      continue;
    }
    const reliable = qty != null && qty > 0;
    inputs.push({
      id: w.id,
      client: w.client,
      label,
      product: w.product,
      days,
      weekKg: qty ?? null,
      source: "FORMULA",
      reliable,
      unreliableReason: reliable ? undefined : `Cantidad/unidad no convertible a kg (${w.plannedQuantity} ${w.unit})`,
      lines: res.materials.map((m) => ({ materiaPrima: m.materiaPrima, codigo: m.codigo, pct: m.formulaPct ?? null, kg: reliable && m.formulaPct != null ? round3((m.formulaPct * qty!) / 100) : null })),
    });
    meta.push({ id: w.id, label, kg: qty ?? null, days, source: "FORMULA", client: w.client, product: w.product });
  }
  return { inputs, meta };
}

type StateMem = { rows: Map<string, RowState & { label: string; productionIds: string[] }>; prods: Map<string, { workItemId: string; label: string; by: string; at: string; reason: string }> };
const gs = globalThis as unknown as { __genusMpWeekState?: StateMem };
const stateMem = (): StateMem => (gs.__genusMpWeekState ??= { rows: new Map(), prods: new Map() });
const emptyState = (): RowState => ({ observacion: "", observacionBy: null, observacionAt: null, gestion: "", gestionBy: null, gestionAt: null, excluded: false, excludedBy: null, excludedAt: null, excludedRequerido: null, exclusionToReview: false, exclusionReviewReason: null });
const memKey = (week: string, key: string) => `${week}|${key}`;

type StoredState = RowState & { productionIds: string[]; label: string };
async function loadRowStates(week: string): Promise<Map<string, StoredState>> {
  const out = new Map<string, StoredState>();
  if (!isDatabaseConfigured()) {
    for (const [k, v] of stateMem().rows) if (k.startsWith(`${week}|`)) out.set(k.slice(week.length + 1), v);
    return out;
  }
  try {
    const rows = await getDb().select().from(mpWeeklyRowState).where(eq(mpWeeklyRowState.weekStart, week));
    for (const r of rows) {
      out.set(r.rowKey, {
        label: r.materialLabel,
        observacion: r.observacion,
        observacionBy: r.observacionBy,
        observacionAt: r.observacionAt?.toISOString() ?? null,
        gestion: (GESTION_OPTIONS as readonly string[]).includes(r.gestion) ? (r.gestion as Gestion) : "",
        gestionBy: r.gestionBy,
        gestionAt: r.gestionAt?.toISOString() ?? null,
        excluded: r.excluded,
        excludedBy: r.excludedBy,
        excludedAt: r.excludedAt?.toISOString() ?? null,
        excludedRequerido: r.excludedRequerido,
        exclusionToReview: false,
        exclusionReviewReason: null,
        productionIds: Array.isArray(r.excludedProductionIds) ? (r.excludedProductionIds as string[]) : [],
      });
    }
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err; // sin migración 0058: el control funciona igual, sin estado administrativo
  }
  return out;
}

async function loadProductionExclusions(week: string): Promise<StateMem["prods"]> {
  if (!isDatabaseConfigured()) return new Map([...stateMem().prods].filter(([k]) => k.startsWith(`${week}|`)).map(([k, v]) => [k.slice(week.length + 1), v]));
  const out: StateMem["prods"] = new Map();
  try {
    const rows = await getDb().select().from(mpWeeklyProductionExclusions).where(eq(mpWeeklyProductionExclusions.weekStart, week));
    for (const r of rows) out.set(r.workItemId, { workItemId: r.workItemId, label: r.label, by: r.excludedBy, at: r.excludedAt.toISOString(), reason: r.reason });
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }
  return out;
}

/**
 * ¿Una MP quitada del control sigue oculta? Solo si TODAS las producciones que la necesitan hoy ya existían al quitarla y la
 * necesidad no creció. Exclusiones sin alcance guardado (viejas) nunca ocultan nada.
 */
export function exclusionVerdict(p: { knownProductionIds: string[]; requeridoAtExclusion: number | null; currentProductionIds: string[]; requeridoNow: number }): { toReview: boolean; reason: string | null } {
  const known = new Set(p.knownProductionIds);
  const fresh = p.currentProductionIds.filter((id) => !known.has(id));
  if (fresh.length > 0) return { toReview: true, reason: `Aparecieron ${fresh.length} producción${fresh.length === 1 ? "" : "es"} nueva${fresh.length === 1 ? "" : "s"} que necesita${fresh.length === 1 ? "" : "n"} esta MP desde que se quitó.` };
  if (p.requeridoAtExclusion != null && p.requeridoNow > p.requeridoAtExclusion + 0.0005) {
    return { toReview: true, reason: `La necesidad creció desde que se quitó (de ${p.requeridoAtExclusion} a ${p.requeridoNow} kg).` };
  }
  return { toReview: false, reason: null };
}

export class MpStateSchemaPendingError extends Error {
  constructor() {
    super("Falta aplicar la migración 0058 en la base: todavía no se pueden guardar observaciones, gestiones ni exclusiones.");
  }
}
async function guardSchema<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isMissingSchemaError(err)) throw new MpStateSchemaPendingError();
    throw err;
  }
}

/** Observación general por MP y semana (no por producción). Vacía = se borra el texto. */
export async function saveRowNote(input: { week: string; rowKey: string; label: string; observacion?: string; gestion?: string; by: string }): Promise<void> {
  const { start } = weekBounds(input.week);
  const now = new Date();
  const patchObs = input.observacion !== undefined;
  const patchGes = input.gestion !== undefined;
  const observacion = (input.observacion ?? "").slice(0, 2000);
  if (patchGes && !(GESTION_OPTIONS as readonly string[]).includes(input.gestion!)) throw new Error("Decisión de gestión inválida.");
  if (!isDatabaseConfigured()) {
    const m = stateMem();
    const k = memKey(start, input.rowKey);
    const cur = m.rows.get(k) ?? { ...emptyState(), label: input.label, productionIds: [] };
    if (patchObs) Object.assign(cur, { observacion, observacionBy: input.by, observacionAt: now.toISOString() });
    if (patchGes) Object.assign(cur, { gestion: input.gestion as Gestion, gestionBy: input.by, gestionAt: now.toISOString() });
    m.rows.set(k, cur);
    return;
  }
  await guardSchema(async () => {
    const set: Partial<typeof mpWeeklyRowState.$inferInsert> = {};
    if (patchObs) Object.assign(set, { observacion, observacionBy: input.by, observacionAt: now });
    if (patchGes) Object.assign(set, { gestion: input.gestion!, gestionBy: input.by, gestionAt: now });
    await getDb()
      .insert(mpWeeklyRowState)
      .values({ weekStart: start, rowKey: input.rowKey, materialLabel: input.label, ...set })
      .onConflictDoUpdate({ target: [mpWeeklyRowState.weekStart, mpWeeklyRowState.rowKey], set });
  });
}

/** Quita MP del control de la semana (persistente; no toca inventario, fórmulas, OE ni consumos). */
export async function excludeRows(input: { week: string; rows: Array<{ rowKey: string; label: string; productionIds: string[]; requerido: number }>; by: string }): Promise<number> {
  const { start } = weekBounds(input.week);
  const now = new Date();
  if (!isDatabaseConfigured()) {
    const m = stateMem();
    for (const r of input.rows) {
      const k = memKey(start, r.rowKey);
      const cur = m.rows.get(k) ?? { ...emptyState(), label: r.label, productionIds: [] };
      Object.assign(cur, { excluded: true, excludedBy: input.by, excludedAt: now.toISOString(), excludedRequerido: r.requerido, productionIds: r.productionIds, label: r.label });
      m.rows.set(k, cur);
    }
    return input.rows.length;
  }
  await guardSchema(async () => {
    for (const r of input.rows) {
      const set = { excluded: true, excludedBy: input.by, excludedAt: now, excludedProductionIds: r.productionIds, excludedRequerido: r.requerido, materialLabel: r.label };
      await getDb().insert(mpWeeklyRowState).values({ weekStart: start, rowKey: r.rowKey, ...set }).onConflictDoUpdate({ target: [mpWeeklyRowState.weekStart, mpWeeklyRowState.rowKey], set });
    }
  });
  return input.rows.length;
}

export async function restoreRows(input: { week: string; rowKeys: string[] }): Promise<void> {
  const { start } = weekBounds(input.week);
  if (!isDatabaseConfigured()) {
    for (const k of input.rowKeys) {
      const cur = stateMem().rows.get(memKey(start, k));
      if (cur) Object.assign(cur, { excluded: false, excludedBy: null, excludedAt: null, excludedRequerido: null, productionIds: [] });
    }
    return;
  }
  await guardSchema(async () => {
    if (input.rowKeys.length === 0) return;
    await getDb()
      .update(mpWeeklyRowState)
      .set({ excluded: false, excludedBy: null, excludedAt: null, excludedRequerido: null, excludedProductionIds: [] })
      .where(and(eq(mpWeeklyRowState.weekStart, start), inArray(mpWeeklyRowState.rowKey, input.rowKeys)));
  });
}

/** Quita producciones del cálculo de la semana (sus necesidades de MP dejan de sumarse). No borra trabajos ni OE. */
export async function excludeProductions(input: { week: string; items: Array<{ workItemId: string; label: string }>; by: string; reason?: string }): Promise<number> {
  const { start } = weekBounds(input.week);
  if (!isDatabaseConfigured()) {
    for (const i of input.items) stateMem().prods.set(memKey(start, i.workItemId), { workItemId: i.workItemId, label: i.label, by: input.by, at: new Date().toISOString(), reason: input.reason ?? "" });
    return input.items.length;
  }
  await guardSchema(async () => {
    for (const i of input.items) {
      await getDb()
        .insert(mpWeeklyProductionExclusions)
        .values({ weekStart: start, workItemId: i.workItemId, label: i.label, excludedBy: input.by, reason: input.reason ?? "" })
        .onConflictDoNothing();
    }
  });
  return input.items.length;
}

export async function restoreProductions(input: { week: string; workItemIds: string[] }): Promise<void> {
  const { start } = weekBounds(input.week);
  if (!isDatabaseConfigured()) {
    for (const id of input.workItemIds) stateMem().prods.delete(memKey(start, id));
    return;
  }
  await guardSchema(async () => {
    if (input.workItemIds.length === 0) return;
    await getDb().delete(mpWeeklyProductionExclusions).where(and(eq(mpWeeklyProductionExclusions.weekStart, start), inArray(mpWeeklyProductionExclusions.workItemId, input.workItemIds)));
  });
}

/**
 * Al eliminar/anular/archivar un control individual: sus necesidades de MP dejan de sumarse en la semana del control.
 * Se excluyen SOLO las producciones que corresponden a ese control (misma OE, o mismo cliente + producto); las
 * necesidades de las demás producciones no se tocan. No borra nada del inventario, fórmulas, OE ni trabajos.
 */
export async function excludeProductionsForControl(control: { id: string; client: string; product: string; linkedOeId: string | null; createdAt: string; quantityKg?: number | null }, by: string): Promise<string[]> {
  if (!isDatabaseConfigured()) return [];
  const { start, end } = weekBounds(control.createdAt.slice(0, 10));
  let works;
  try {
    works = await getDb()
      .select()
      .from(workItems)
      .where(and(eq(workItems.sector, "ELABORACION"), isNull(workItems.deletedAt), lte(workItems.plannedDate, end), gte(sql`coalesce(${workItems.plannedDateTo}, ${workItems.plannedDate})`, start)));
  } catch {
    return [];
  }
  const nc = normText(control.client);
  const np = normText(control.product);
  // Con OE vinculada se identifica SOLO por la OE. Sin OE: mismo cliente + producto, y si hay varias producciones
  // iguales se toma la de la misma cantidad; si sigue ambiguo no se quita nada (no se borran necesidades ajenas).
  let matched = control.linkedOeId ? works.filter((w) => w.orderId === control.linkedOeId) : [];
  if (!control.linkedOeId) {
    const same = works.filter((w) => normText(w.client) === nc && normText(w.product) === np);
    const qty = control.quantityKg;
    const byQty = qty ? same.filter((w) => Number(String(w.plannedQuantity ?? "").replace(",", ".")) === qty) : [];
    matched = byQty.length > 0 ? byQty.slice(0, 1) : same.length === 1 ? same : [];
  }
  if (matched.length === 0) return [];
  await excludeProductions({ week: start, items: matched.map((w) => ({ workItemId: w.id, label: `${w.client} — ${w.product}` })), by, reason: `Control eliminado (${control.id.slice(0, 8)})` });
  return matched.map((w) => w.id);
}

export async function restoreProductionsForControl(controlId: string): Promise<void> {
  const tag = `Control eliminado (${controlId.slice(0, 8)})`;
  if (!isDatabaseConfigured()) {
    for (const [k, v] of stateMem().prods) if (v.reason === tag) stateMem().prods.delete(k);
    return;
  }
  await guardSchema(async () => {
    await getDb().delete(mpWeeklyProductionExclusions).where(eq(mpWeeklyProductionExclusions.reason, tag));
  });
}

/** Quita del control de la semana las MP indicadas (la persona ve las filas; el servidor toma de ellas las producciones y cantidades). */
export async function excludeRowsByKeys(week: string, rowKeys: string[], by: string): Promise<number> {
  const current = await getWeeklyAvailability(week);
  const pick = current.rows.filter((r) => rowKeys.includes(r.key));
  if (pick.length === 0) return 0;
  return excludeRows({ week, by, rows: pick.map((r) => ({ rowKey: r.key, label: r.materiaPrima, productionIds: [...new Set(r.needs.map((n) => n.productionId))], requerido: r.requerido })) });
}

export async function getWeeklyAvailability(anyDay: string, now = new Date()): Promise<WeeklyAvailability> {
  const { start, end } = weekBounds(anyDay);
  const [{ lots, source }, aliases, prods, states, prodEx] = await Promise.all([loadStockLots(), loadNameAliases(), loadProductions(start, end), loadRowStates(start), loadProductionExclusions(start)]);
  // Producciones quitadas del cálculo de la semana: sus necesidades no se suman.
  const inputs = prods.inputs.filter((p) => !prodEx.has(p.id));
  const result = computeAvailability({ lots, aliases, productions: inputs, todayIso: iso(now) });
  const rows: WeeklyRow[] = [];
  const excludedRows: WeeklyRow[] = [];
  const labelOf = new Map(prods.meta.map((m) => [m.id, m.label]));
  for (const r of result.rows) {
    const st = states.get(r.key);
    const state: RowState = { ...emptyState(), ...(st ?? {}) };
    if (st?.excluded) {
      // Una exclusión solo oculta lo que ya existía cuando se quitó. Si aparecen producciones nuevas, o la necesidad
      // creció, la MP vuelve a verse marcada «revisar»: una exclusión vieja o muy amplia no puede esconder necesidades nuevas.
      const verdict = exclusionVerdict({ knownProductionIds: st.productionIds, requeridoAtExclusion: st.excludedRequerido, currentProductionIds: [...new Set(r.needs.map((n) => n.productionId))], requeridoNow: r.requerido });
      state.exclusionToReview = verdict.toReview;
      state.exclusionReviewReason = verdict.reason;
      const scope: ExcludedScope = { productionLabels: st.productionIds.map((id) => labelOf.get(id) ?? "Producción ya no programada en la semana"), requeridoAtExclusion: st.excludedRequerido, requeridoNow: r.requerido };
      if (!verdict.toReview) {
        excludedRows.push({ ...r, state, scope });
        continue;
      }
      rows.push({ ...r, state, scope });
      continue;
    }
    rows.push({ ...r, state });
  }
  const summary = { ...result.summary, total: rows.length };
  for (const k of Object.keys(summary) as Array<keyof typeof summary>) if (k !== "total") summary[k] = rows.filter((r) => r.estado === k).length;
  const excludedKeys = new Set(excludedRows.map((r) => r.key));
  const duplicates = prods.meta.filter((m) => m.note?.startsWith("Misma OE")).map((m) => ({ id: m.id, oeNumber: m.oeNumber, days: m.days, note: m.note }));
  const breakdown = buildProductBreakdown({ rows: [...rows, ...excludedRows], productions: inputs, excludedKeys, duplicates });
  return {
    ...result,
    rows,
    summary,
    excludedRows,
    excludedProductions: [...prodEx.values()].map((p) => ({ ...p, kind: p.reason.startsWith("Control eliminado") ? ("control" as const) : ("manual" as const) })),
    products: breakdown.sections,
    productSummary: breakdown.summary,
    weekStart: start,
    weekEnd: end,
    generatedAt: now.toISOString(),
    productions: prods.meta.filter((p) => !prodEx.has(p.id)),
    stockSource: source,
  };
}

/** Stock utilizable consolidado (todas las filas del Stock MP con ese nombre) para líneas de una planilla de control. */
export async function stockForControlLines(lines: Array<{ materiaPrima: string; codigo?: string }>, now = new Date()) {
  const [{ lots }, aliases] = await Promise.all([loadStockLots(), loadNameAliases()]);
  const { stockForLine } = await import("./availability");
  return lines.map((l) => stockForLine(lots, l, iso(now), aliases));
}
