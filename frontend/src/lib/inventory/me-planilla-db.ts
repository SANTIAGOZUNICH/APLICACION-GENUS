/**
 * Planillas de Depósito ME sobre Postgres — escritura TRANSACCIONAL (Etapa 2).
 *
 * A diferencia del camino en memoria (hidratar todo → modificar → re-escribir), acá cada operación:
 *  - bloquea las filas que toca (SELECT … FOR UPDATE) y verifica la versión que vio el usuario (`updatedAt`): si otro
 *    usuario guardó antes, CONFLICTO y no se pisa nada;
 *  - serializa todo lo que mueve el stock de un código con un candado transaccional por código (pg_advisory_xact_lock):
 *    una edición de cantidades y un ajuste del mismo código nunca se cruzan;
 *  - valida TODAS las celdas antes de escribir (una inválida ⇒ no se guarda ninguna);
 *  - deja auditoría (inv_audit) con valor anterior, nuevo, usuario y motivo en la MISMA transacción.
 *
 * El stock NO se guarda como dato editable: se calcula con `computeMeStock` (ingresos − salidas que descuentan +
 * ajustes). Se corrige con un AJUSTE (motivo, historial, stock esperado) o corrigiendo el movimiento de origen.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { invAjustes, invAudit, invMeIngresos, invMeMaterials, invMeSalidas } from "@/lib/db/schema";
import { multiplyTotal } from "./calcs";
import { InventoryForbiddenError, InventoryNotFoundError, InventoryValidationError, type InventoryActor } from "./inventory-service";
import { normalizeMeCodigo } from "./me-codigo";
import {
  MAX_ME_SHEET_CHANGES,
  MIN_AJUSTE_MOTIVO,
  ME_AJUSTE_TIPOS,
  isMeSheetField,
  manualSalidaStockError,
  meSalidaMotivo,
  meSheetModule,
  meSheetProtection,
  validateMeSheetValue,
  type MeSheetChange,
  type MeSheetResource,
  type MeSheetResult,
} from "./me-sheet-edit";
import { buildMeMovements, computeMeStock, type MeMovement } from "./me-stock-calc";
import type { StockAjuste } from "./memory-repo";
import { canReadInventory, canWriteInventory } from "./rbac";
import type { InventoryAudit, MeIngresoRow, MeMaterial, MeSalidaRow } from "./types";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type AnyRow = Record<string, unknown> & { id: string; updatedAt: string };

export class MeSheetConflictError extends Error {
  status = 409;
  code = "CONFLICT";
  constructor(message: string, readonly current?: unknown) {
    super(message);
    this.name = "MeSheetConflictError";
  }
}
/** Celdas rechazadas: nada se escribió. */
export class MeSheetPatchError extends Error {
  status: number;
  code = "CELLS_REJECTED";
  constructor(readonly results: MeSheetResult[]) {
    const firstReal = results.find((r) => !r.ok && !r.message.startsWith("No se guardó: otra celda")) ?? results.find((r) => !r.ok);
    super(firstReal && !firstReal.ok ? firstReal.message : "No se guardó.");
    this.status = results.some((r) => !r.ok && r.code === "CONFLICT") ? 409 : results.some((r) => !r.ok && r.code === "PROTECTED") ? 403 : 422;
  }
}

const tableOf = (resource: MeSheetResource) => (resource === "me_ingresos" ? invMeIngresos : resource === "me_salidas" ? invMeSalidas : invMeMaterials);
const nextVersion = (prev: string) => new Date(Math.max(Date.now(), new Date(prev).getTime() + 1 || 0)).toISOString();

function assertWrite(actor: InventoryActor, module: Parameters<typeof canWriteInventory>[1]) {
  if (actor.isSuperadmin) return;
  if (!canWriteInventory(actor.sector, module)) throw new InventoryForbiddenError(`Sector ${actor.sector} no puede modificar ${module}.`);
}
function assertRead(actor: InventoryActor, module: Parameters<typeof canReadInventory>[1]) {
  if (actor.isSuperadmin) return;
  if (!canReadInventory(actor.sector, module)) throw new InventoryForbiddenError(`Sector ${actor.sector} no puede ver ${module}.`);
}

/** Candado transaccional por código: todo lo que cambia el stock de un código se serializa. */
async function lockCodigos(tx: Tx, codigos: Iterable<string>) {
  for (const c of [...new Set([...codigos].map(normalizeMeCodigo).filter(Boolean))].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`genus-me-stock:${c}`}))`);
  }
}

async function loadLedgerInputs(tx: Tx | ReturnType<typeof getDb>) {
  const [ingresos, salidas, materials, ajustes] = await Promise.all([
    tx.select({ payload: invMeIngresos.payload }).from(invMeIngresos),
    tx.select({ payload: invMeSalidas.payload }).from(invMeSalidas),
    tx.select({ payload: invMeMaterials.payload }).from(invMeMaterials),
    tx.select({ payload: invAjustes.payload }).from(invAjustes),
  ]);
  return {
    ingresos: ingresos.map((r) => r.payload as MeIngresoRow),
    salidas: salidas.map((r) => r.payload as MeSalidaRow),
    materials: materials.map((r) => r.payload as MeMaterial),
    ajustes: ajustes.map((r) => r.payload as StockAjuste),
  };
}
type LedgerInputs = Awaited<ReturnType<typeof loadLedgerInputs>>;
function stockOf(codigo: string, data: LedgerInputs) {
  const c = normalizeMeCodigo(codigo);
  const materialIds = new Set(data.materials.filter((m) => normalizeMeCodigo(m.codigo) === c).map((m) => m.id));
  return { stock: computeMeStock(c, { ...data, materialIds }), materialIds };
}

function auditRow(actor: InventoryActor, module: string, entityId: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, reason: string | null): InventoryAudit {
  return { id: randomUUID(), module, entityId, action, actor: actor.email, actorSector: actor.sector, reason, before, after, createdAt: new Date().toISOString() };
}

/** Material del código (o uno nuevo) — el inventario se agrupa por código. */
async function ensureMaterialForCodigo(tx: Tx, codigo: string, hint: { descripcion?: string; cliente?: string; ubicacion?: string; unidad?: string }, actor: InventoryActor): Promise<string> {
  const rows = await tx.select({ payload: invMeMaterials.payload }).from(invMeMaterials);
  const found = rows.map((r) => r.payload as MeMaterial).filter((m) => normalizeMeCodigo(m.codigo) === codigo).sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)) || a.id.localeCompare(b.id))[0];
  if (found) return found.id;
  const now = new Date().toISOString();
  const mat: MeMaterial = {
    id: randomUUID(), codigo, descripcion: hint.descripcion?.trim() || codigo, cliente: hint.cliente ?? "", ubicacion: hint.ubicacion ?? "", unidad: hint.unidad || "u",
    cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: now, archived: false, archivedAt: null, archivedBy: null, archivedReason: null,
  };
  await tx.insert(invMeMaterials).values({ id: mat.id, payload: mat, updatedAt: new Date(now) });
  await tx.insert(invAudit).values((() => { const a = auditRow(actor, "me_stock", mat.id, "create", null, { codigo }, "Alta automática por código nuevo en la planilla"); return { id: a.id, payload: a, createdAt: new Date(a.createdAt) }; })());
  return mat.id;
}

/**
 * Edición por celda de Ingresos / Salidas / Inventario ME. Todo-o-nada; devuelve las filas confirmadas por la base.
 * Lanza MeSheetPatchError con el resultado por celda si alguna se rechaza (nada se escribe).
 */
export async function patchMeSheetCells(actor: InventoryActor, resource: MeSheetResource, changes: MeSheetChange[]): Promise<{ items: AnyRow[] }> {
  assertWrite(actor, meSheetModule(resource));
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_ME_SHEET_CHANGES) {
    throw new InventoryValidationError(`Entre 1 y ${MAX_ME_SHEET_CHANGES} celdas por operación.`);
  }
  const table = tableOf(resource);
  const db = getDb();
  return db.transaction(async (tx) => {
    const ids = [...new Set(changes.map((c) => String(c?.id ?? "")))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const found = ids.length ? await tx.select({ id: table.id, payload: table.payload }).from(table).where(inArray(table.id, ids)).for("update") : [];
    const rows = new Map(found.map((r) => [r.id, r.payload as AnyRow]));
    const results: MeSheetResult[] = changes.map(() => ({ ok: true }));
    const patches = new Map<string, Record<string, unknown>>();
    const reasons = new Map<string, string>();
    changes.forEach((c, i) => {
      const row = rows.get(String(c?.id));
      if (!row) return void (results[i] = { ok: false, code: "NOT_FOUND", message: "El registro ya no existe." });
      if (!isMeSheetField(resource, c.field)) return void (results[i] = { ok: false, code: "PROTECTED", message: "Columna calculada: no se edita." });
      const prot = meSheetProtection(resource, row as never, c.field, actor.sector, actor.isSuperadmin);
      if (prot) return void (results[i] = { ok: false, code: "PROTECTED", message: prot });
      if (row.updatedAt !== c.expectedVersion) return void (results[i] = { ok: false, code: "CONFLICT", message: "Otro usuario modificó este registro mientras editabas. Recargá y revisá antes de guardar." });
      const v = validateMeSheetValue(resource, c.field, c.value);
      if (!v.ok) return void (results[i] = { ok: false, code: "INVALID", message: v.message });
      const patch = patches.get(row.id) ?? {};
      patch[c.field] = c.field === "codigo" ? normalizeMeCodigo(String(v.value)) : v.value;
      patches.set(row.id, patch);
      if (c.reason?.trim()) reasons.set(row.id, c.reason.trim());
    });
    const reject = () => {
      changes.forEach((_, i) => {
        if (results[i]!.ok) results[i] = { ok: false, code: "INVALID", message: "No se guardó: otra celda del mismo cambio fue rechazada." };
      });
      throw new MeSheetPatchError(results);
    };
    if (results.some((r) => !r.ok)) reject();

    // Armar cada fila nueva y validar reglas de negocio (anti doble descuento, duplicados).
    const prepared: Array<{ id: string; before: AnyRow; next: AnyRow; changed: string[] }> = [];
    const all = resource === "me_ingresos" ? ((await tx.select({ payload: invMeIngresos.payload }).from(invMeIngresos)).map((r) => r.payload as MeIngresoRow)) : [];
    for (const [id, patch] of patches) {
      const before = rows.get(id)!;
      const next: AnyRow = { ...before, ...patch, updatedBy: actor.email, updatedAt: nextVersion(before.updatedAt) };
      const changed = Object.keys(patch).filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(next[f] ?? null));
      if (changed.length === 0) continue;
      if (resource !== "me_inventario") {
        const bultos = next.bultos as number | null;
        const cantidad = next.cantidad as number | null;
        next.total = resource === "me_ingresos" ? multiplyTotal(bultos, cantidad) : (multiplyTotal(bultos, cantidad) ?? cantidad ?? null);
      }
      if (resource === "me_salidas") {
        if ("motivoSalida" in patch && !("descuentaStock" in patch)) {
          const m = meSalidaMotivo(next.motivoSalida as string);
          if (m) next.descuentaStock = m.descuenta;
        }
        const err = manualSalidaStockError(next as never);
        if (err) {
          changes.forEach((c, i) => { if (c.id === id) results[i] = { ok: false, code: "INVALID", message: err }; });
          continue;
        }
      }
      if (resource === "me_ingresos" && changed.some((f) => ["remitoNro", "codigo", "bultos", "cantidad", "fecha"].includes(f))) {
        const n = next as unknown as MeIngresoRow;
        const dup = n.remitoNro?.trim() && all.find((r) => r.id !== id && !r.anulado && r.remitoNro.trim().toUpperCase() === n.remitoNro.trim().toUpperCase() && normalizeMeCodigo(r.codigo) === normalizeMeCodigo(n.codigo) && (r.total ?? null) === (n.total ?? null) && r.fecha === n.fecha);
        if (dup) {
          changes.forEach((c, i) => { if (c.id === id) results[i] = { ok: false, code: "DUPLICATE", message: `Quedaría duplicado del ingreso ${dup.ingresoNro} (mismo remito, código, cantidad y fecha).` }; });
          continue;
        }
      }
      prepared.push({ id, before, next, changed });
    }
    if (results.some((r) => !r.ok)) reject();

    // Lo que mueve stock se serializa por código (viejo y nuevo).
    if (resource !== "me_inventario") {
      await lockCodigos(tx, prepared.flatMap((p) => [String(p.before.codigo ?? ""), String(p.next.codigo ?? "")]));
    }
    for (const p of prepared) {
      if (resource !== "me_inventario" && p.changed.includes("codigo")) {
        p.next.materialId = await ensureMaterialForCodigo(tx, String(p.next.codigo), { descripcion: String(p.next.descripcionInsumo ?? p.next.descripcion ?? ""), cliente: String(p.next.cliente ?? ""), ubicacion: String(p.next.ubicacion ?? ""), unidad: String(p.next.unidad ?? "u") }, actor);
      }
      const res = await tx.update(table).set({ payload: p.next, updatedAt: new Date() }).where(and(eq(table.id, p.id), sql`${table.payload}->>'updatedAt' = ${p.before.updatedAt}`)).returning({ id: table.id });
      if (res.length === 0) throw new MeSheetConflictError("Otro usuario modificó este registro mientras editabas. Recargá y revisá.");
      const fields = [...p.changed, ...(p.changed.some((f) => f === "bultos" || f === "cantidad") ? ["total"] : [])];
      const a = auditRow(actor, meSheetModule(resource), p.id, "cell_edit", Object.fromEntries(fields.map((f) => [f, p.before[f] ?? null])), Object.fromEntries(fields.map((f) => [f, p.next[f] ?? null])), reasons.get(p.id) ?? null);
      await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
    }
    return { items: prepared.map((p) => p.next) };
  });
}

export interface MeAjusteInput {
  materialId: string;
  /** Stock que el usuario vio al decidir el ajuste: si cambió en el medio, conflicto (no se ajusta sobre otro número). */
  expectedStock: number;
  /** Stock real después del ajuste (conteo / corrección). Nunca se fuerza a 0 automáticamente. */
  newStock: number;
  motivo: string;
  tipo: string;
}

/** Ajuste de inventario ME auditado: crea un movimiento AJUSTE (diferencia) — el stock sigue siendo calculado. */
export async function adjustMeStockDb(actor: InventoryActor, input: MeAjusteInput): Promise<{ stockAnterior: number; stockActual: number; ajuste: StockAjuste }> {
  assertWrite(actor, "me_ajustes");
  const motivo = String(input.motivo ?? "").trim();
  if (motivo.length < MIN_AJUSTE_MOTIVO) throw new InventoryValidationError(`El ajuste requiere un motivo (mín. ${MIN_AJUSTE_MOTIVO} caracteres).`);
  const tipo = ME_AJUSTE_TIPOS.some((t) => t.id === input.tipo) ? input.tipo : "OTRO";
  const newStock = Number(input.newStock);
  if (!Number.isFinite(newStock) || newStock < 0 || newStock > 1_000_000_000) throw new InventoryValidationError("El stock corregido debe ser un número ≥ 0.");
  const db = getDb();
  return db.transaction(async (tx) => {
    const [matRow] = await tx.select({ payload: invMeMaterials.payload }).from(invMeMaterials).where(eq(invMeMaterials.id, input.materialId)).for("update");
    if (!matRow) throw new InventoryNotFoundError("Material ME no encontrado.");
    const mat = matRow.payload as MeMaterial;
    if (mat.archived) throw new InventoryValidationError("Material archivado: no se ajusta.");
    const codigo = normalizeMeCodigo(mat.codigo);
    if (!codigo) throw new InventoryValidationError("El material no tiene código.");
    await lockCodigos(tx, [codigo]);
    const data = await loadLedgerInputs(tx);
    const { stock } = stockOf(codigo, data);
    if (Math.abs(stock - Number(input.expectedStock)) > 1e-9) {
      throw new MeSheetConflictError(`El stock de ${codigo} cambió mientras ajustabas (ahora ${stock}). Revisá antes de ajustar.`, { stockActual: stock });
    }
    const diferencia = Number((newStock - stock).toFixed(6));
    if (diferencia === 0) throw new InventoryValidationError("El stock ya es ese valor: no hay nada que ajustar.");
    const now = new Date();
    const ajuste: StockAjuste & { tipo: string; actorName?: string } = {
      id: randomUUID(), module: "ME", entityId: mat.id, cantidadAnterior: stock, cantidadNueva: newStock, diferencia,
      motivo, tipo, actor: actor.email, actorName: actor.displayName, actorSector: actor.sector, createdAt: now.toISOString(),
    };
    await tx.insert(invAjustes).values({ id: ajuste.id, payload: ajuste, createdAt: now });
    const a = auditRow(actor, "me_ajustes", mat.id, "adjust", { stockActual: stock }, { stockActual: newStock, tipo }, motivo);
    await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: now });
    // Cache del saldo en el material (el valor de verdad es el cálculo). No cambia su versión de datos.
    await tx.update(invMeMaterials).set({ payload: { ...mat, codigo, stockActual: newStock }, updatedAt: now }).where(eq(invMeMaterials.id, mat.id));
    return { stockAnterior: stock, stockActual: newStock, ajuste };
  });
}

/** Libro de movimientos (con saldo) del código de un material. */
export async function meMovementsDb(actor: InventoryActor, materialId: string): Promise<{ codigo: string; stockActual: number; movimientos: MeMovement[] }> {
  assertRead(actor, "me_stock");
  const db = getDb();
  const data = await loadLedgerInputs(db);
  const mat = data.materials.find((m) => m.id === materialId);
  if (!mat) throw new InventoryNotFoundError("Material ME no encontrado.");
  const codigo = normalizeMeCodigo(mat.codigo);
  const { stock, materialIds } = stockOf(codigo, data);
  return { codigo, stockActual: stock, movimientos: buildMeMovements(codigo, { ...data, materialIds }) };
}

/** Historial de cambios de un registro (ingreso, salida o material). */
export async function meHistoryDb(actor: InventoryActor, entityId: string): Promise<InventoryAudit[]> {
  assertRead(actor, "me_stock");
  const rows = await getDb().select({ payload: invAudit.payload }).from(invAudit).where(sql`${invAudit.payload}->>'entityId' = ${entityId}`).orderBy(desc(invAudit.createdAt)).limit(300);
  return rows.map((r) => r.payload as InventoryAudit);
}

/** Stock calculado por código directamente desde la base (para verificación y para la UI tras un ajuste). */
export async function meStockByCodigoDb(codigo: string): Promise<number> {
  return stockOf(codigo, await loadLedgerInputs(getDb())).stock;
}
