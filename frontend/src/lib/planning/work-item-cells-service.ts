/**
 * Aplica ediciones por celda de trabajos con las funciones CANÓNICAS de planificación.
 * Una celda = una llamada canónica con SOLO ese campo (+ versión esperada): cualquier otra columna
 * del trabajo queda intacta. Se valida TODO antes de escribir; luego cada celda se persiste y se
 * informa su resultado real (nunca éxito sin confirmación de la base).
 */
import "server-only";

import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workItems } from "@/lib/db/schema";
import { mapWorkItemRow } from "@/lib/planning/drizzle-repository";
import { projectNativeWorkItem } from "@/lib/planning/native-projector";
import {
  updateWorkItemLoteVtoDurable,
  updateWorkItemPlanningDurable,
  type UpdateLoteVtoInput,
  type UpdateWorkItemPlanningInput,
} from "@/lib/planning/work-item-progress-repository";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import type { WorkItem } from "@/types/operational/work-item";
import {
  MAX_WORK_ITEM_CELL_CHANGES,
  MIN_WORK_ITEM_REASON,
  isWorkItemCellField,
  validateWorkItemCellValue,
  workItemCellProtection,
  workItemReasonRequired,
  type WorkItemCellChange,
  type WorkItemCellResult,
} from "./work-item-cell-edit";

export interface WorkItemCellStore {
  load(nativeIds: string[]): Promise<Map<string, WorkItem>>;
  updatePlanning(id: string, input: UpdateWorkItemPlanningInput): Promise<{ version: number }>;
  updateLoteVto(id: string, input: UpdateLoteVtoInput): Promise<{ version: number }>;
}

export const neonWorkItemCellStore: WorkItemCellStore = {
  async load(nativeIds) {
    const rows = await getDb().select().from(workItems).where(inArray(workItems.id, nativeIds));
    const out = new Map<string, WorkItem>();
    for (const row of rows) {
      if (row.deletedAt) continue;
      const item = projectNativeWorkItem(mapWorkItemRow(row));
      out.set(item.id, { ...item, version: row.version });
    }
    return out;
  },
  updatePlanning: (id, input) => updateWorkItemPlanningDurable(id, input),
  updateLoteVto: (id, input) => updateWorkItemLoteVtoDurable(id, input),
};

let storeOverride: WorkItemCellStore | null = null;
export function setWorkItemCellStoreForTests(s: WorkItemCellStore | null): void {
  storeOverride = s;
}

const nativeOf = (id: string) => id.slice("native:".length);
const todayIso = () => new Date().toISOString().slice(0, 10);

function classify(err: unknown): { code: "CONFLICT" | "INVALID" | "ERROR"; message: string } {
  const message = err instanceof Error ? err.message : "Error al guardar.";
  if (/conflict/i.test(message)) return { code: "CONFLICT", message };
  if (err instanceof Error && /Validation/i.test(err.name)) return { code: "INVALID", message };
  if (/inv[aá]lid|obligatori|debe mantenerse|no hay cambios/i.test(message)) return { code: "INVALID", message };
  return { code: "ERROR", message };
}

export async function applyWorkItemCellChanges(
  actor: { email: string; sector: string; displayName: string },
  changes: WorkItemCellChange[],
  today = todayIso()
): Promise<{ results: WorkItemCellResult[]; ok: boolean }> {
  if (actor.sector !== "PRODUCCION") throw new OrdersForbiddenError("Solo Producción edita la planificación de trabajos.");
  if (!Array.isArray(changes) || changes.length === 0) throw new OrdersValidationError("No hay cambios para guardar.");
  if (changes.length > MAX_WORK_ITEM_CELL_CHANGES) throw new OrdersValidationError(`Máximo ${MAX_WORK_ITEM_CELL_CHANGES} celdas por operación.`);
  const store = storeOverride ?? neonWorkItemCellStore;

  const nativeIds = [...new Set(changes.filter((c) => typeof c?.id === "string" && c.id.startsWith("native:")).map((c) => nativeOf(c.id)))];
  const items = nativeIds.length ? await store.load(nativeIds) : new Map<string, WorkItem>();

  const results: WorkItemCellResult[] = new Array(changes.length);
  const plan: Array<{ index: number; change: WorkItemCellChange; value: string | null; item: WorkItem }> = [];

  // 1) Validación COMPLETA antes de escribir cualquier cosa.
  changes.forEach((c, index) => {
    const fail = (code: Extract<WorkItemCellResult, { ok: false }>["code"], message: string) => {
      results[index] = { index, ok: false, code, message };
    };
    if (!c || !isWorkItemCellField(c.field)) return fail("PROTECTED", "Columna no editable.");
    const item = items.get(String(c.id));
    if (!item) return fail("NOT_FOUND", "El trabajo ya no existe o no es editable desde acá.");
    const reasonProt = workItemCellProtection(item, c.field, actor.sector);
    if (reasonProt) return fail("PROTECTED", reasonProt);
    const v = validateWorkItemCellValue(c.field, c.value);
    if (!v.ok) return fail("INVALID", v.message);
    if (workItemReasonRequired(item, c.field, today) && (c.reason ?? "").trim().length < MIN_WORK_ITEM_REASON) {
      return fail("REASON_REQUIRED", `Esta edición requiere un motivo (mín. ${MIN_WORK_ITEM_REASON} caracteres).`);
    }
    plan.push({ index, change: c, value: v.value, item });
  });
  if (results.some((r) => r && !r.ok)) {
    // Un pegado con celdas rechazadas NO guarda parcialmente: se informa y no se escribe nada.
    plan.forEach((p) => {
      results[p.index] = { index: p.index, ok: false, code: "INVALID", message: "No se guardó: otra celda del mismo pegado fue rechazada." };
    });
    return { results, ok: false };
  }

  // 2) Persistencia: una llamada canónica por celda, encadenando la versión por trabajo.
  const versionOf = new Map<string, number>();
  const clientVersion = new Map<string, number>();
  for (const p of plan) {
    const key = p.change.id;
    if (!clientVersion.has(key)) clientVersion.set(key, p.change.expectedVersion);
    // Edición encadenada sobre nuestra propia versión SOLO si el cliente partía de la misma versión original.
    const expected =
      versionOf.has(key) && p.change.expectedVersion === clientVersion.get(key) ? versionOf.get(key)! : p.change.expectedVersion;
    const by = actor.displayName || actor.email;
    try {
      const row =
        p.change.field === "packagingLote" || p.change.field === "packagingVto"
          ? await store.updateLoteVto(nativeOf(key), {
              [p.change.field]: p.value,
              reason: p.change.reason ?? "",
              updatedBy: by,
              updatedBySector: actor.sector,
              expectedVersion: expected,
            } as UpdateLoteVtoInput)
          : await store.updatePlanning(nativeOf(key), {
              [p.change.field]: p.value,
              reason: p.change.reason ?? null,
              updatedBy: by,
              updatedBySector: actor.sector,
              expectedVersion: expected,
            } as UpdateWorkItemPlanningInput);
      versionOf.set(key, row.version);
      results[p.index] = { index: p.index, ok: true, version: row.version };
    } catch (err) {
      const c = classify(err);
      results[p.index] = { index: p.index, ok: false, code: c.code, message: c.message };
    }
  }
  return { results, ok: results.every((r) => r?.ok) };
}
