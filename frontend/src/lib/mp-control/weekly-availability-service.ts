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
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { invMpStock, mpMasterLinks, mpStockMovements, operationalOrders, workItems } from "@/lib/db/schema";
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

export type WeeklyAvailability = AvailabilityResult & {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  productions: Array<{ id: string; label: string; kg: number | null; days: string; source: "OE" | "FORMULA" | "SIN_FORMULA"; oeNumber?: string; note?: string }>;
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
      meta.push({ id: w.id, label, kg: null, days, source: "OE", oeNumber: oe.orderNumber, note: "Misma OE que otro trabajo de la semana: no se suma de nuevo." });
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
      const qty = fd.header?.quantityKg != null && Number(fd.header.quantityKg) > 0 ? Number(fd.header.quantityKg) : toKg(qtyRaw, w.unit);
      const per = consumed.get(oe.id);
      const mats = (fd.materials ?? []).filter((m) => !m.parentRowId);
      const reliable = qty != null && qty > 0 && mats.length > 0 && mats.every((m) => m.formulaPct != null);
      inputs.push({
        id: w.id,
        client: w.client,
        label: `${label} (OE ${oe.orderNumber})`,
        reliable,
        unreliableReason: !reliable ? (qty == null || qty <= 0 ? `Cantidad no válida (${w.plannedQuantity} ${w.unit})` : "La OE no tiene fórmula completa (faltan %)") : undefined,
        lines: mats.map((m) => {
          const need = reliable ? round3(((m.formulaPct ?? 0) * qty!) / 100) : null;
          return { materiaPrima: m.materiaPrima ?? "", codigo: m.codigo ?? "", codigoMp: m.codigoMp ?? "", kg: need };
        }),
        consumedByCode: per ? Object.fromEntries([...per].filter(([, kg]) => kg > 0)) : undefined,
      });
      meta.push({ id: w.id, label, kg: qty ?? null, days, source: "OE", oeNumber: oe.orderNumber });
      continue;
    }

    const qty = toKg(qtyRaw, w.unit);
    const res = await resolveFormulaForWork({ client: w.client, product: w.product });
    if (!res.ok) {
      inputs.push({ id: w.id, client: w.client, label, reliable: false, unreliableReason: `Sin fórmula encontrada: ${res.message}`, lines: [] });
      meta.push({ id: w.id, label, kg: qty ?? null, days, source: "SIN_FORMULA", note: res.message });
      continue;
    }
    const reliable = qty != null && qty > 0;
    inputs.push({
      id: w.id,
      client: w.client,
      label,
      reliable,
      unreliableReason: reliable ? undefined : `Cantidad/unidad no convertible a kg (${w.plannedQuantity} ${w.unit})`,
      lines: res.materials.map((m) => ({ materiaPrima: m.materiaPrima, codigo: m.codigo, kg: reliable && m.formulaPct != null ? round3((m.formulaPct * qty!) / 100) : null })),
    });
    meta.push({ id: w.id, label, kg: qty ?? null, days, source: "FORMULA" });
  }
  return { inputs, meta };
}

export async function getWeeklyAvailability(anyDay: string, now = new Date()): Promise<WeeklyAvailability> {
  const { start, end } = weekBounds(anyDay);
  const [{ lots, source }, aliases, prods] = await Promise.all([loadStockLots(), loadNameAliases(), loadProductions(start, end)]);
  const result = computeAvailability({ lots, aliases, productions: prods.inputs, todayIso: iso(now) });
  return { ...result, weekStart: start, weekEnd: end, generatedAt: now.toISOString(), productions: prods.meta, stockSource: source };
}

/** Stock utilizable consolidado (todas las filas del Stock MP con ese nombre) para líneas de una planilla de control. */
export async function stockForControlLines(lines: Array<{ materiaPrima: string; codigo?: string }>, now = new Date()) {
  const [{ lots }, aliases] = await Promise.all([loadStockLots(), loadNameAliases()]);
  const { stockForLine } = await import("./availability");
  return lines.map((l) => stockForLine(lots, l, iso(now), aliases));
}
