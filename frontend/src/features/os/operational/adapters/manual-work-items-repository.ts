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
  /** Inicio del rango planificado (ISO). */
  plannedDate: string;
  /** Fin inclusive del rango planificado (ISO). Default = plannedDate. */
  plannedDateTo?: string;
  /** Fecha de entrega operativa (ISO). Independiente del rango de aparición. */
  deliveryDate: string;
  quantity: string;
  unit: string;
  /** Conservado por compatibilidad; la UI de asignación ya no lo expone. */
  priority?: WorkItemPriority | null;
  oeRef: string | null;
  oaRef: string | null;
  notes: string | null;
  assignedBy: string;
  /** Lote / VTO opcionales (especialmente Envasado). */
  packagingLote?: string | null;
  packagingVto?: string | null;
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

/** Pendientes eliminados lógicamente (meta.deleted) — para pestaña Cancelados y eliminados. */
export function listDeletedManualWorkItems(): WorkItem[] {
  const meta = readMeta();
  return readAll().filter((item) => Boolean(meta[item.id]?.deleted));
}

export type CancelledOrDeletedKind = "eliminado" | "cancelado" | "archivado";

export interface CancelledOrDeletedRow {
  item: WorkItem;
  kind: CancelledOrDeletedKind;
  previousStatus: string;
  at: string;
  actor: string;
  reason: string;
}

/** Lista unificada para la pestaña Cancelados y eliminados. */
export function listCancelledAndDeletedManualWorks(): CancelledOrDeletedRow[] {
  const meta = readMeta();
  const rows: CancelledOrDeletedRow[] = [];
  for (const item of readAll()) {
    const m = meta[item.id];
    if (m?.deleted) {
      rows.push({
        item,
        kind: "eliminado",
        previousStatus: "pendiente",
        at: m.deletedAt ?? "",
        actor: m.deletedBy ?? m.assignedBy ?? "Producción",
        reason: "Eliminado sin avances (baja lógica).",
      });
      continue;
    }
    if (item.status === "cancelado") {
      rows.push({
        item,
        kind: "cancelado",
        previousStatus: "en_curso / con avances",
        at: m?.cancelledAt ?? "",
        actor: m?.cancelledBy ?? m?.assignedBy ?? "Producción",
        reason: m?.cancelReason ?? "Sin motivo registrado.",
      });
      continue;
    }
    if (m?.archived) {
      rows.push({
        item,
        kind: "archivado",
        previousStatus: item.status,
        at: m.archivedAt ?? "",
        actor: m.archivedBy ?? m.assignedBy ?? "Producción",
        reason: "Archivado por Producción.",
      });
    }
  }
  return rows.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

/**
 * Restaura un trabajo eliminado o cancelado si no hay conflicto de ID activo.
 * No restaura entregas ni toca OE/OA/Calidad/lotes.
 */
export function restoreManualWorkItem(input: {
  id: string;
  actorSectorId: SectorId;
  actorName: string;
}): ManualWorkMutationResult {
  const gate = gateWorkMutation(input.actorSectorId);
  if (!gate.ok) {
    return { ok: false, error: gate.error, code: gate.code };
  }

  const items = readAll();
  const idx = items.findIndex((item) => item.id === input.id);
  if (idx < 0) {
    return { ok: false, error: "No encontramos ese trabajo.", code: "NOT_FOUND" };
  }

  const item = items[idx]!;
  const meta = readMeta();
  const current = meta[input.id];
  if (!current?.deleted && item.status !== "cancelado" && !current?.archived) {
    return { ok: true, item, action: "restaurar" };
  }

  // Conflicto: otro trabajo activo con mismo producto+cliente+sector+fecha (heurística suave)
  const activeConflict = listAllManualWorkItems().find(
    (other) =>
      other.id !== item.id &&
      other.sector === item.sector &&
      other.product === item.product &&
      other.client === item.client &&
      (other.deliveryDate ?? other.plannedDate) === (item.deliveryDate ?? item.plannedDate)
  );
  if (activeConflict) {
    return {
      ok: false,
      error:
        "No se puede restaurar: ya existe un trabajo activo similar (mismo producto, cliente, sector y fecha). Revisá Asignar trabajos.",
      code: "RESTORE_CONFLICT",
    };
  }

  const now = new Date().toISOString();
  const restored: WorkItem = {
    ...item,
    status: item.status === "cancelado" ? "pendiente" : item.status,
  };
  items[idx] = restored;
  writeAll(items);

  meta[input.id] = {
    ...current,
    assignedBy: current?.assignedBy ?? input.actorName,
    assignedAt: current?.assignedAt ?? now,
    deleted: false,
    deletedAt: undefined,
    deletedBy: undefined,
    archived: false,
    archivedAt: undefined,
    archivedBy: undefined,
    cancelledAt: undefined,
    cancelledBy: undefined,
    cancelReason: undefined,
    cancelSector: undefined,
    reassignedBy: input.actorName,
    reassignedAt: now,
  };
  writeMeta(meta);

  return { ok: true, item: restored, action: "restaurar" };
}

export function getManualWorkItemMeta(id: string): ManualWorkItemMeta | null {
  return readMeta()[id] ?? null;
}

export function getManualWorkItemById(id: string): WorkItem | null {
  return readAll().find((item) => item.id === id) ?? null;
}

export type ManualWorkMutationResult =
  | { ok: true; item: WorkItem; action: "eliminar" | "cancelar" | "archivar" | "restaurar" }
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
    plannedDateTo: (input.plannedDateTo?.trim() || input.plannedDate) || null,
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
    loteRef: input.packagingLote?.trim() || null,
    notes: input.notes,
    actionLabel: null,
    href: null,
    confidence: "high",
    createdFrom: "manual_assignment",
    generatedEntities: [],
    dependsOn: null,
    blockedBy: null,
    unblocks: null,
    packagingLote: input.packagingLote?.trim() || null,
    packagingVto: input.packagingVto?.trim() || null,
    packagingTotalUnits: null,
    packagingCajas: null,
    packagingUnidadesPorCaja: null,
    packagingQtyHistory: [],
  };

  const items = [...readAll(), item];
  writeAll(items);

  const meta = readMeta();
  meta[id] = { assignedBy: input.assignedBy, assignedAt: new Date().toISOString() };
  writeMeta(meta);

  return item;
}

/** Actualiza lote/VTO y cantidades de envasado (parcial permitido). */
export function updateManualWorkItemPackaging(input: {
  id: string;
  actorName: string;
  packagingLote?: string | null;
  packagingVto?: string | null;
  packagingTotalUnits?: number | null;
  packagingCajas?: number | null;
  packagingUnidadesPorCaja?: number | null;
  packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
  packingMismatchObservation?: string | null;
}): WorkItem | null {
  const items = readAll();
  const idx = items.findIndex((i) => i.id === input.id);
  if (idx < 0) return null;
  const prev = items[idx]!;

  let packingGroups =
    input.packingGroups !== undefined
      ? input.packingGroups
      : prev.packingGroups ?? null;
  let packagingCajas =
    input.packagingCajas !== undefined
      ? input.packagingCajas
      : prev.packagingCajas ?? null;
  let packagingUnidadesPorCaja =
    input.packagingUnidadesPorCaja !== undefined
      ? input.packagingUnidadesPorCaja
      : prev.packagingUnidadesPorCaja ?? null;

  // Una sola fuente: packingGroups manda; legacy = grupo[0].
  if (input.packingGroups !== undefined) {
    const g0 = packingGroups?.[0];
    packagingCajas = g0 ? g0.cajas : null;
    packagingUnidadesPorCaja = g0 ? g0.unidadesPorCaja : null;
  } else if (
    input.packagingCajas !== undefined ||
    input.packagingUnidadesPorCaja !== undefined
  ) {
    packingGroups = [
      {
        cajas: packagingCajas ?? 0,
        unidadesPorCaja: packagingUnidadesPorCaja ?? 0,
      },
      ...(prev.packingGroups?.slice(1) ?? []),
    ];
  }

  const next: WorkItem = {
    ...prev,
    packagingLote:
      input.packagingLote !== undefined
        ? input.packagingLote?.trim() || null
        : prev.packagingLote ?? null,
    packagingVto:
      input.packagingVto !== undefined
        ? input.packagingVto?.trim() || null
        : prev.packagingVto ?? null,
    packagingTotalUnits:
      input.packagingTotalUnits !== undefined
        ? input.packagingTotalUnits
        : prev.packagingTotalUnits ?? null,
    packagingCajas,
    packagingUnidadesPorCaja,
    packingGroups,
    packingMismatchObservation:
      input.packingMismatchObservation !== undefined
        ? input.packingMismatchObservation?.trim() || null
        : prev.packingMismatchObservation ?? null,
    loteRef:
      input.packagingLote !== undefined
        ? input.packagingLote?.trim() || null
        : prev.loteRef,
  };
  const hist = [...(prev.packagingQtyHistory ?? [])];
  if (
    input.packagingTotalUnits !== undefined ||
    input.packagingCajas !== undefined ||
    input.packagingUnidadesPorCaja !== undefined ||
    input.packingGroups !== undefined
  ) {
    hist.push({
      at: new Date().toISOString(),
      by: input.actorName,
      totalUnits: next.packagingTotalUnits ?? null,
      cajas: next.packagingCajas ?? null,
      unidadesPorCaja: next.packagingUnidadesPorCaja ?? null,
      packingGroups: next.packingGroups ?? null,
    });
    next.packagingQtyHistory = hist;
  }
  items[idx] = next;
  writeAll(items);
  return next;
}

export function reassignManualWorkItem(
  id: string,
  patch: {
    plannedDate?: string;
    plannedDateTo?: string;
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
          plannedDateTo:
            patch.plannedDateTo !== undefined
              ? patch.plannedDateTo
              : (item.plannedDateTo ?? item.plannedDate),
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
