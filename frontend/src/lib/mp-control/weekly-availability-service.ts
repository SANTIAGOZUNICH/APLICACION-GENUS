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
import { mpMasterLinks, invMpStock, mpStockMovements, operationalOrders, workItems } from "@/lib/db/schema";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import { normalizeMpStockPayload } from "@/lib/inventory/neon-persist";
import { parseArDecimal } from "@/lib/utils/ar-number-parsing";
import {
  computeAvailability,
  normCode,
  normText,
  round3,
  toKg,
  type AvailabilityResult,
  type MpLink,
  type MpLinkKind,
  type ProductionInput,
  type StockLot,
} from "./availability";

export type WeeklyAvailability = AvailabilityResult & {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  productions: Array<{ id: string; label: string; kg: number | null; days: string; source: "OE" | "FORMULA" | "SIN_FORMULA"; oeNumber?: string; note?: string }>;
  stockSource: "inv_mp_stock" | "memoria";
  schemaPending: boolean;
};

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function weekBounds(anyDay: string): { start: string; end: string } {
  const d = new Date(`${anyDay}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  const start = new Date(d.getTime() - dow * DAY);
  return { start: iso(start), end: iso(new Date(start.getTime() + 6 * DAY)) };
}

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
    lots: rows
      .filter((r) => r.codigo.trim())
      .map((r) => ({
        id: r.id,
        codigo: r.codigo,
        codigosAnteriores: r.codigosAnteriores,
        descripcion: r.descripcion,
        proveedor: r.proveedor,
        lote: r.lote,
        ubicacion: r.ubicacion,
        cantidadKg: r.cantidadKg,
        vencimiento: r.vencimiento,
        estadoStock: r.estadoStock,
        estadoStockManual: r.estadoStockManual,
        archived: r.archived,
      })),
  };
}

type Mem = { links: Array<MpLink & { id: string }> };
const g = globalThis as unknown as { __genusMpLinksMem?: Mem };
const mem = (): Mem => (g.__genusMpLinksMem ??= { links: [] });

export async function loadMpLinks(): Promise<{ links: MpLink[]; schemaPending: boolean }> {
  if (!isDatabaseConfigured()) return { links: mem().links, schemaPending: false };
  try {
    const rows = await getDb().select().from(mpMasterLinks);
    return {
      links: rows.map((r) => ({ kind: r.kind as MpLinkKind, key: r.key, masterCode: r.masterCode, approvedBy: r.approvedBy, approvedAt: r.approvedAt.toISOString() })),
      schemaPending: false,
    };
  } catch (err) {
    if (isMissingSchemaError(err)) return { links: [], schemaPending: true };
    throw err;
  }
}

/** Confirma una equivalencia (la recuerda). Una clave solo puede apuntar a un maestro: confirmar de nuevo la corrige. */
export async function approveMpLink(input: { kind: MpLinkKind; key: string; masterCode: string; by: string; note?: string }): Promise<void> {
  const key = input.kind === "formula_name" ? normText(input.key) : normCode(input.key);
  const masterCode = normCode(input.masterCode);
  if (!key || !masterCode) throw new Error("Falta la materia prima o el código maestro.");
  if (input.kind === "inventory_code" && key === masterCode) throw new Error("Un código no se vincula consigo mismo.");
  const { lots } = await loadStockLots();
  if (!lots.some((l) => normCode(l.codigo) === masterCode)) throw new Error(`El código maestro ${masterCode} no existe en el inventario de Materias Primas.`);
  if (!isDatabaseConfigured()) {
    const m = mem();
    m.links = m.links.filter((l) => !(l.kind === input.kind && l.key === key));
    m.links.push({ id: `${Date.now()}`, kind: input.kind, key, masterCode, approvedBy: input.by, approvedAt: new Date().toISOString() });
    return;
  }
  await getDb()
    .insert(mpMasterLinks)
    .values({ kind: input.kind, key, masterCode, approvedBy: input.by, note: input.note ?? "" })
    .onConflictDoUpdate({ target: [mpMasterLinks.kind, mpMasterLinks.key], set: { masterCode, approvedBy: input.by, approvedAt: new Date(), note: input.note ?? "" } });
}

export async function removeMpLink(input: { kind: MpLinkKind; key: string }): Promise<void> {
  const key = input.kind === "formula_name" ? normText(input.key) : normCode(input.key);
  if (!isDatabaseConfigured()) {
    mem().links = mem().links.filter((l) => !(l.kind === input.kind && l.key === key));
    return;
  }
  await getDb().delete(mpMasterLinks).where(and(eq(mpMasterLinks.kind, input.kind), eq(mpMasterLinks.key, key)));
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
      inputs.push({ id: w.id, label, reliable: false, unreliableReason: `Sin fórmula vinculada: ${res.message}`, lines: [] });
      meta.push({ id: w.id, label, kg: qty ?? null, days, source: "SIN_FORMULA", note: res.message });
      continue;
    }
    const reliable = qty != null && qty > 0;
    inputs.push({
      id: w.id,
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
  const [{ lots, source }, { links, schemaPending }, prods] = await Promise.all([loadStockLots(), loadMpLinks(), loadProductions(start, end)]);
  const result = computeAvailability({ lots, links, productions: prods.inputs, todayIso: iso(now) });
  return { ...result, weekStart: start, weekEnd: end, generatedAt: now.toISOString(), productions: prods.meta, stockSource: source, schemaPending };
}

/** Stock utilizable consolidado (todos los proveedores/lotes) para líneas de una planilla de control individual. */
export async function stockForControlLines(lines: Array<{ materiaPrima: string; codigo: string }>, now = new Date()) {
  const { lots } = await loadStockLots();
  const { links } = await loadMpLinks();
  const { stockForLine } = await import("./availability");
  return lines.map((l) => stockForLine(lots, links, l, iso(now)));
}
