/**
 * @mock-temp Trabajos asignados manualmente desde Producción — localStorage.
 * Se fusionan con los WorkItems reales (Sheets/native) al listar por sector;
 * no escribe a Sheets/Drive — capa de adapter aislada, lista para reemplazo por
 * escritura real cuando exista Action Pipeline con RBAC server-side.
 */

import type { SectorId } from "@/types/operational/sector";
import type { OriginStage, WorkItem, WorkItemPriority } from "@/types/operational/work-item";
import { gateWorkMutation, type WorkMutationAttempt } from "../lib/work-mutation-rbac";
import { resolveAssignedWorkLifecycleAction } from "../lib/assigned-work-lifecycle";

const ORIGIN_STAGE_BY_SECTOR: Record<
  "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM",
  OriginStage
> = {
  ELABORACION: "ELABORACION",
  ENVASADO_MASIVO: "ACONDICIONAMIENTO",
  ENVASADO_PREMIUM: "ACONDICIONAMIENTO",
};

const STORAGE_KEY = "genus_os_manual_work_items";

export interface CreateManualWorkItemInput {
  sector: Extract<SectorId, "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM">;
  ownerPerson: string | null;
  line: string | null;
  client: string;
  product: string;
  plannedDate: string;
  /** Fecha de entrega operativa (ISO). Independiente de plannedDate. */
  deliveryDate: string;
  quantity: string;
  unit: string;
  /** Conservado por compatibilidad; la UI de asignación ya no lo expone. */
  priority?: WorkItemPriority | null;
  oeRef: string | null;
  oaRef: string | null;
  notes: string | null;
  assignedBy: string;
}

export interface ManualWorkItemMeta {
  assignedBy: string;
  assignedAt: string;
  reassignedBy?: string;
  reassignedAt?: string;
  /** Baja lógica — oculto de bandejas activas pero conservado. */
  archived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  /** Eliminación lógica de pendiente sin avance (no aparece en merge activo). */
  deleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  /** Cancelación con historial. */
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  cancelSector?: string;
}

function readAll(): WorkItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WorkItem[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: WorkItem[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function readMeta(): Record<string, ManualWorkItemMeta> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY}_meta`);
    return raw ? (JSON.parse(raw) as Record<string, ManualWorkItemMeta>) : {};
  } catch {
    return {};
  }
}

function writeMeta(meta: Record<string, ManualWorkItemMeta>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${STORAGE_KEY}_meta`, JSON.stringify(meta));
}

export function listManualWorkItems(sector: SectorId): WorkItem[] {
  return readAll().filter((item) => {
    if (item.sector !== sector) return false;
    const meta = readMeta()[item.id];
    if (meta?.deleted || meta?.archived) return false;
    if (item.status === "cancelado") return false;
    return true;
  });
}

/**
 * Punto único de fusión: todo consumidor de WorkItems por sector (vistas operativas,
 * Control de MP, Panel de Producción, listados de OE/OA) debe pasar por acá para que
 * los trabajos creados en Asignar Trabajos aparezcan de forma consistente en todas
 * las pantallas — evita reimplementar el merge en cada vista.
 *
 * Excluye eliminados, archivados y cancelados de las bandejas activas.
 */
export function mergeManualWorkItems(sector: SectorId, items: WorkItem[]): WorkItem[] {
  return [...items, ...listManualWorkItems(sector)];
}

export function listAllManualWorkItems(options?: {
  includeInactive?: boolean;
}): WorkItem[] {
  const all = readAll();
  if (options?.includeInactive) return [...all];
  const meta = readMeta();
  return all.filter((item) => {
    const m = meta[item.id];
    if (m?.deleted || m?.archived) return false;
    if (item.status === "cancelado") return false;
    return true;
  });
}

/** Historial: cancelados y archivados (no eliminados duros de pendientes). */
export function listInactiveManualWorkItems(): WorkItem[] {
  const meta = readMeta();
  return readAll().filter((item) => {
    const m = meta[item.id];
    return item.status === "cancelado" || Boolean(m?.archived);
  });
}

export function getManualWorkItemMeta(id: string): ManualWorkItemMeta | null {
  return readMeta()[id] ?? null;
}

export function getManualWorkItemById(id: string): WorkItem | null {
  return readAll().find((item) => item.id === id) ?? null;
}

export type ManualWorkMutationResult =
  | { ok: true; item: WorkItem; action: "eliminar" | "cancelar" | "archivar" }
  | { ok: false; error: string; code?: string };

export function deleteOrCancelManualWorkItem(input: {
  id: string;
  actorSectorId: SectorId;
  actorName: string;
  cancelReason?: string;
  /** true si hay avance en OperationalStore. */
  hasProgressRecord?: boolean;
  finishedQty?: string | null;
}): ManualWorkMutationResult {
  const gate = gateWorkMutation(input.actorSectorId);
  if (!gate.ok) {
    return { ok: false, error: gate.error, code: gate.code };
  }

  const items = readAll();
  const idx = items.findIndex((item) => item.id === input.id);
  if (idx < 0) {
    return { ok: false, error: "No encontramos ese trabajo asignado.", code: "NOT_FOUND" };
  }

  const item = items[idx]!;
  const decision = resolveAssignedWorkLifecycleAction(
    { status: item.status, finishedQty: input.finishedQty ?? item.finishedQty },
    { hasProgressRecord: input.hasProgressRecord }
  );

  if (decision.action === "bloquear_finalizado" && item.status === "completo") {
    return { ok: false, error: decision.reason, code: "FINALIZED" };
  }
  if (decision.action === "bloquear_finalizado") {
    return { ok: false, error: decision.reason, code: "ALREADY_INACTIVE" };
  }

  const meta = readMeta();
  const now = new Date().toISOString();

  if (decision.action === "eliminar") {
    // Baja lógica de pendiente: no aparece en merge; no toca OE/OA ni Calidad.
    meta[input.id] = {
      ...(meta[input.id] ?? { assignedBy: input.actorName, assignedAt: now }),
      deleted: true,
      deletedAt: now,
      deletedBy: input.actorName,
    };
    writeMeta(meta);
    // Conservamos el registro en el array para auditoría, filtrado por meta.deleted.
    return { ok: true, item, action: "eliminar" };
  }

  if (decision.action === "archivar") {
    meta[input.id] = {
      ...(meta[input.id] ?? { assignedBy: input.actorName, assignedAt: now }),
      archived: true,
      archivedAt: now,
      archivedBy: input.actorName,
    };
    writeMeta(meta);
    return { ok: true, item, action: "archivar" };
  }

  // cancelar
  const reason = (input.cancelReason ?? "").trim();
  if (!reason) {
    return {
      ok: false,
      error: "El motivo de cancelación es obligatorio.",
      code: "REASON_REQUIRED",
    };
  }

  const cancelled: WorkItem = {
    ...item,
    status: "cancelado",
    notes: [item.notes, `Cancelado: ${reason}`].filter(Boolean).join(" · "),
  };
  items[idx] = cancelled;
  writeAll(items);

  meta[input.id] = {
    ...(meta[input.id] ?? { assignedBy: input.actorName, assignedAt: now }),
    cancelledAt: now,
    cancelledBy: input.actorName,
    cancelReason: reason,
    cancelSector: input.actorSectorId,
  };
  writeMeta(meta);

  return { ok: true, item: cancelled, action: "cancelar" };
}

/** Solo PRODUCCION — wrapper tipado para tests / pipeline. */
export function assertProduccionWorkMutation(
  actorSectorId: SectorId | null | undefined
): WorkMutationAttempt {
  return gateWorkMutation(actorSectorId);
}

export function createManualWorkItem(input: CreateManualWorkItemInput): WorkItem {
  const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: WorkItem = {
    id,
    sector: input.sector,
    ownerSector: input.sector,
    ownerPerson: input.ownerPerson,
    source: "semanas_2026",
    sourceFileId: "manual",
    sourceSheet: null,
    sourceRange: null,
    productSourceRange: null,
    quantitySourceRange: null,
    originStage: ORIGIN_STAGE_BY_SECTOR[input.sector],
    date: input.plannedDate,
    plannedDate: input.plannedDate,
    dayLabel: null,
    dayOfWeek: null,
    weekLabel: null,
    weekStart: null,
    weekId: null,
    client: input.client,
    product: input.product,
    quantity: input.quantity,
    unit: input.unit,
    line: input.line,
    deliveryDate: input.deliveryDate,
    status: "pendiente",
    priority: input.priority ?? "NORMAL",
    pedidoRef: null,
    oeRef: input.oeRef,
    oaRef: input.oaRef,
    loteRef: null,
    notes: input.notes,
    actionLabel: null,
    href: null,
    confidence: "high",
    createdFrom: "manual_assignment",
    generatedEntities: [],
    dependsOn: null,
    blockedBy: null,
    unblocks: null,
  };

  const items = [...readAll(), item];
  writeAll(items);

  const meta = readMeta();
  meta[id] = { assignedBy: input.assignedBy, assignedAt: new Date().toISOString() };
  writeMeta(meta);

  return item;
}

export function reassignManualWorkItem(
  id: string,
  patch: {
    plannedDate?: string;
    deliveryDate?: string;
    ownerPerson?: string | null;
    line?: string | null;
  },
  reassignedBy: string
): void {
  const items = readAll().map((item) =>
    item.id === id
      ? {
          ...item,
          plannedDate: patch.plannedDate ?? item.plannedDate,
          deliveryDate: patch.deliveryDate ?? item.deliveryDate,
          ownerPerson: patch.ownerPerson !== undefined ? patch.ownerPerson : item.ownerPerson,
          line: patch.line !== undefined ? patch.line : item.line,
        }
      : item
  );
  writeAll(items);

  const meta = readMeta();
  if (meta[id]) {
    meta[id] = { ...meta[id], reassignedBy, reassignedAt: new Date().toISOString() };
    writeMeta(meta);
  }
}

/** Migración suave: si hay plannedDate pero no deliveryDate, copiar plannedDate. */
export function ensureDeliveryDatesMigrated(): void {
  const items = readAll();
  let changed = false;
  const next = items.map((item) => {
    if (!item.deliveryDate && item.plannedDate) {
      changed = true;
      return { ...item, deliveryDate: item.plannedDate };
    }
    return item;
  });
  if (changed) writeAll(next);
}
