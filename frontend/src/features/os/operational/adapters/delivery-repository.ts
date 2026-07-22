/**
 * @mock-temp + Live Sync overlay — registros de entrega operativa.
 * Persistencia local inmediata; en modo real también se emite deliver_work / etc.
 */

import type { SectorId } from "@/types/operational/sector";
import { gateDeliveryMutation } from "../lib/delivery-rbac";

const STORAGE_KEY = "genus_os_deliveries";
const AUDIT_KEY = "genus_os_delivery_audit";

export type DeliveryStatus = "ENTREGADO" | "ANULADO" | "REGISTRO_ELIMINADO";

export interface DeliveryRecord {
  id: string;
  workItemId: string;
  qualityItemId?: string | null;
  product: string;
  codigo: string | null;
  client: string | null;
  lote: string | null;
  sourceSector: SectorId;
  quantity: string | null;
  unit: string | null;
  plannedDeliveryDate: string | null;
  actualDeliveredAt: string;
  remito: string | null;
  receivedBy: string | null;
  observations: string | null;
  status: DeliveryStatus;
  deliveredBy: string;
  deliveredBySector: SectorId;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  annulledAt?: string | null;
  annulledBy?: string | null;
  annulReason?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deleteReason?: string | null;
}

export interface DeliveryAuditStub {
  id: string;
  workItemId: string;
  status: "REGISTRO_ELIMINADO";
  deletedAt: string;
  deletedBy: string;
  deleteReason: string;
  referenceHash: string;
  productHint?: string;
  clientHint?: string;
}

export type DeliveryMutationResult =
  | { ok: true; record: DeliveryRecord }
  | { ok: false; error: string; code?: string };

function readAll(): DeliveryRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DeliveryRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: DeliveryRecord[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function readAudit(): DeliveryAuditStub[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(AUDIT_KEY);
    return raw ? (JSON.parse(raw) as DeliveryAuditStub[]) : [];
  } catch {
    return [];
  }
}

function writeAudit(items: DeliveryAuditStub[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUDIT_KEY, JSON.stringify(items));
}

function makeId(): string {
  return `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function hashRef(parts: string[]): string {
  const raw = parts.join("|");
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return `ref-${h.toString(16)}`;
}

export function listActiveDeliveries(): DeliveryRecord[] {
  return readAll()
    .filter((d) => d.status === "ENTREGADO" && !d.archived)
    .sort((a, b) => b.actualDeliveredAt.localeCompare(a.actualDeliveredAt));
}

export function listArchivedDeliveries(): DeliveryRecord[] {
  return readAll()
    .filter((d) => d.status === "ENTREGADO" && d.archived)
    .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
}

export function listAllDeliveries(options?: {
  includeArchived?: boolean;
  includeAnnulled?: boolean;
}): DeliveryRecord[] {
  return readAll().filter((d) => {
    if (d.status === "REGISTRO_ELIMINADO") return false;
    if (d.status === "ANULADO" && !options?.includeAnnulled) return false;
    if (d.archived && !options?.includeArchived) return false;
    return true;
  });
}

export function getDeliveryByWorkItemId(workItemId: string): DeliveryRecord | null {
  return (
    readAll().find(
      (d) => d.workItemId === workItemId && d.status === "ENTREGADO" && !d.annulledAt
    ) ?? null
  );
}

export function getDeliveryById(id: string): DeliveryRecord | null {
  return readAll().find((d) => d.id === id) ?? null;
}

export function listDeliveryAudit(): DeliveryAuditStub[] {
  return [...readAudit()].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export function deliverWork(input: {
  actorSectorId: SectorId;
  actorName: string;
  workItemId: string;
  qualityItemId?: string | null;
  product: string;
  codigo?: string | null;
  client?: string | null;
  lote?: string | null;
  sourceSector: SectorId;
  quantity?: string | null;
  unit?: string | null;
  plannedDeliveryDate?: string | null;
  actualDeliveredAt: string;
  remito?: string | null;
  receivedBy?: string | null;
  observations?: string | null;
}): DeliveryMutationResult {
  const gate = gateDeliveryMutation(input.actorSectorId);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  if (!input.actualDeliveredAt?.trim()) {
    return { ok: false, error: "La fecha y hora real de entrega son obligatorias.", code: "DATE_REQUIRED" };
  }

  const existing = getDeliveryByWorkItemId(input.workItemId);
  if (existing) {
    return { ok: true, record: existing }; // idempotente
  }

  const now = new Date().toISOString();
  const record: DeliveryRecord = {
    id: makeId(),
    workItemId: input.workItemId,
    qualityItemId: input.qualityItemId ?? null,
    product: input.product,
    codigo: input.codigo ?? null,
    client: input.client ?? null,
    lote: input.lote ?? null,
    sourceSector: input.sourceSector,
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
    plannedDeliveryDate: input.plannedDeliveryDate ?? null,
    actualDeliveredAt: input.actualDeliveredAt,
    remito: input.remito?.trim() || null,
    receivedBy: input.receivedBy?.trim() || null,
    observations: input.observations?.trim() || null,
    status: "ENTREGADO",
    deliveredBy: input.actorName,
    deliveredBySector: input.actorSectorId,
    createdAt: now,
    updatedAt: now,
    archived: false,
  };

  writeAll([record, ...readAll()]);
  return { ok: true, record };
}

export function archiveDelivery(input: {
  id: string;
  actorSectorId: SectorId;
  actorName: string;
}): DeliveryMutationResult {
  const gate = gateDeliveryMutation(input.actorSectorId);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const items = readAll();
  const idx = items.findIndex((d) => d.id === input.id);
  if (idx < 0) return { ok: false, error: "Entrega no encontrada.", code: "NOT_FOUND" };
  const current = items[idx]!;
  if (current.status !== "ENTREGADO") {
    return { ok: false, error: "Solo se pueden archivar entregas activas.", code: "INVALID_STATE" };
  }
  if (current.archived) return { ok: true, record: current };

  const now = new Date().toISOString();
  const next: DeliveryRecord = {
    ...current,
    archived: true,
    archivedAt: now,
    archivedBy: input.actorName,
    updatedAt: now,
  };
  items[idx] = next;
  writeAll(items);
  return { ok: true, record: next };
}

export function restoreDelivery(input: {
  id: string;
  actorSectorId: SectorId;
  actorName: string;
}): DeliveryMutationResult {
  const gate = gateDeliveryMutation(input.actorSectorId);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const items = readAll();
  const idx = items.findIndex((d) => d.id === input.id);
  if (idx < 0) return { ok: false, error: "Entrega no encontrada.", code: "NOT_FOUND" };
  const current = items[idx]!;
  if (!current.archived) return { ok: true, record: current };

  const next: DeliveryRecord = {
    ...current,
    archived: false,
    archivedAt: null,
    archivedBy: null,
    updatedAt: new Date().toISOString(),
  };
  items[idx] = next;
  writeAll(items);
  return { ok: true, record: next };
}

export function annulDelivery(input: {
  id: string;
  actorSectorId: SectorId;
  actorName: string;
  reason: string;
}): DeliveryMutationResult {
  const gate = gateDeliveryMutation(input.actorSectorId);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, error: "El motivo de anulación es obligatorio.", code: "REASON_REQUIRED" };
  }

  const items = readAll();
  const idx = items.findIndex((d) => d.id === input.id);
  if (idx < 0) return { ok: false, error: "Entrega no encontrada.", code: "NOT_FOUND" };
  const current = items[idx]!;
  if (current.status === "REGISTRO_ELIMINADO") {
    return { ok: false, error: "No se puede anular una entrega eliminada.", code: "ALREADY_DELETED" };
  }
  if (current.archived) {
    return {
      ok: false,
      error: "Restaurá la entrega desde Archivados antes de anularla.",
      code: "MUST_RESTORE_FIRST",
    };
  }
  if (current.status === "ANULADO") return { ok: true, record: current };

  const now = new Date().toISOString();
  const next: DeliveryRecord = {
    ...current,
    status: "ANULADO",
    annulledAt: now,
    annulledBy: input.actorName,
    annulReason: reason,
    archived: false,
    updatedAt: now,
  };
  items[idx] = next;
  writeAll(items);
  return { ok: true, record: next };
}

export function deleteDeliveryRecord(input: {
  id: string;
  actorSectorId: SectorId;
  actorName: string;
  reason: string;
}): DeliveryMutationResult {
  const gate = gateDeliveryMutation(input.actorSectorId);
  if (!gate.ok) return { ok: false, error: gate.error, code: gate.code };

  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, error: "El motivo de eliminación es obligatorio.", code: "REASON_REQUIRED" };
  }

  const items = readAll();
  const idx = items.findIndex((d) => d.id === input.id);
  if (idx < 0) return { ok: false, error: "Entrega no encontrada.", code: "NOT_FOUND" };
  const current = items[idx]!;

  if (!current.archived && current.status === "ENTREGADO") {
    return {
      ok: false,
      error: "Solo se puede eliminar definitivamente desde Archivados.",
      code: "MUST_ARCHIVE_FIRST",
    };
  }
  if (current.status === "REGISTRO_ELIMINADO") {
    return { ok: false, error: "El registro ya fue eliminado.", code: "ALREADY_DELETED" };
  }

  const now = new Date().toISOString();
  const stub: DeliveryAuditStub = {
    id: `audit-${current.id}`,
    workItemId: current.workItemId,
    status: "REGISTRO_ELIMINADO",
    deletedAt: now,
    deletedBy: input.actorName,
    deleteReason: reason,
    referenceHash: hashRef([current.id, current.workItemId, now, reason]),
    productHint: current.product,
    clientHint: current.client ?? undefined,
  };
  writeAudit([stub, ...readAudit()]);

  // Remover el registro de búsquedas normales; conservar solo auditoría.
  writeAll(items.filter((d) => d.id !== input.id));

  return {
    ok: true,
    record: {
      ...current,
      status: "REGISTRO_ELIMINADO",
      deletedAt: now,
      deletedBy: input.actorName,
      deleteReason: reason,
      updatedAt: now,
    },
  };
}

export function isWorkDelivered(workItemId: string): boolean {
  return Boolean(getDeliveryByWorkItemId(workItemId));
}
