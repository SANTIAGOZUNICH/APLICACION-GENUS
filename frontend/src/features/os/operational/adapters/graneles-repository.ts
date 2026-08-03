/**
 * Depósito Graneles — sobrantes de granel (localStorage).
 * Persistencia Neon diferida vía migración 0014 (no aplicar sin autorización).
 */
import type { SectorId } from "@/types/operational/sector";
import { normalizeOptionalReason } from "@/lib/lifecycle";

const STORAGE_KEY = "genus_os_deposito_graneles";
const AUDIT_KEY = "genus_os_deposito_graneles_audit";

export const GRANEL_STATUSES = [
  "BORRADOR",
  "DISPONIBLE",
  "AGOTADO",
  "ANULADO",
  "ARCHIVADO",
] as const;
export type GranelStatus = (typeof GRANEL_STATUSES)[number];

export interface GranelRemainderRecord {
  id: string;
  workItemId: string | null;
  originSector: SectorId | null;
  product: string;
  client: string;
  /** Lote de granel (no confundir con lote PT de Codificado). */
  bulkLot: string;
  kgAvailable: number;
  intakeDate: string;
  reportedBy: string;
  observation: string;
  location: string;
  status: GranelStatus;
  createdAt: string;
  updatedAt: string;
  annulledAt?: string;
  annulledBy?: string;
  annulReason?: string;
}

export interface GranelAuditEntry {
  id: string;
  granelId: string;
  action: "create" | "update" | "annul" | "archive" | "delete" | "delta";
  actorSector: SectorId;
  actorName: string;
  reason?: string;
  beforeKg?: number;
  afterKg?: number;
  at: string;
}

function readAll(): GranelRemainderRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as GranelRemainderRecord[];
  } catch {
    return [];
  }
}

function writeAll(items: GranelRemainderRecord[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function readAudit(): GranelAuditEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(AUDIT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as GranelAuditEntry[];
  } catch {
    return [];
  }
}

function pushAudit(entry: Omit<GranelAuditEntry, "id" | "at">): void {
  const list = readAudit();
  list.unshift({
    ...entry,
    id: `ga-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
  });
  if (typeof window !== "undefined") {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(list.slice(0, 500)));
  }
}

export function listGranelRemainders(options?: {
  includeAnnulled?: boolean;
}): GranelRemainderRecord[] {
  const items = readAll();
  if (options?.includeAnnulled) return items;
  return items.filter((i) => i.status !== "ANULADO" && i.status !== "ARCHIVADO");
}

export function getGranelByWorkItemId(workItemId: string): GranelRemainderRecord | null {
  return (
    readAll().find(
      (i) => i.workItemId === workItemId && i.status !== "ANULADO" && i.status !== "ARCHIVADO"
    ) ?? null
  );
}

export function getGranelById(id: string): GranelRemainderRecord | null {
  return readAll().find((i) => i.id === id) ?? null;
}

export function listGranelAudit(granelId: string): GranelAuditEntry[] {
  return readAudit().filter((a) => a.granelId === granelId);
}

function canMutateGraneles(sector: SectorId): boolean {
  return sector === "DEPOSITO";
}

/** Upsert idempotente por workItemId (envasado → sobrante). */
export function upsertGranelFromEnvasado(input: {
  workItemId: string;
  originSector: SectorId;
  product: string;
  client: string;
  bulkLot: string;
  kg: number;
  reportedBy: string;
  observation?: string;
  actorSector: SectorId;
}): { record: GranelRemainderRecord; created: boolean; duplicated: boolean } {
  const items = readAll();
  const existing = items.find(
    (i) => i.workItemId === input.workItemId && i.status !== "ANULADO"
  );
  const now = new Date().toISOString();

  if (existing) {
    // Una sola vez por workItemId: no duplicar ni reescribir desde Envasado.
    return { record: existing, created: false, duplicated: true };
  }

  const record: GranelRemainderRecord = {
    id: `gr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workItemId: input.workItemId,
    originSector: input.originSector,
    product: input.product,
    client: input.client,
    bulkLot: input.bulkLot || "Sin lote",
    kgAvailable: input.kg,
    intakeDate: now.slice(0, 10),
    reportedBy: input.reportedBy,
    observation: input.observation?.trim() || "",
    location: "",
    status: "DISPONIBLE",
    createdAt: now,
    updatedAt: now,
  };
  items.unshift(record);
  writeAll(items);
  pushAudit({
    granelId: record.id,
    action: "create",
    actorSector: input.actorSector,
    actorName: input.reportedBy,
    afterKg: input.kg,
  });
  return { record, created: true, duplicated: false };
}

export function createManualGranel(input: {
  actorSector: SectorId;
  actorName: string;
  product?: string;
  client?: string;
  bulkLot?: string;
  kg: number;
  intakeDate?: string;
  location?: string;
  observation?: string;
  asDraft?: boolean;
}): { ok: true; record: GranelRemainderRecord } | { ok: false; error: string } {
  if (!canMutateGraneles(input.actorSector)) {
    return { ok: false, error: "Solo Depósito puede crear sobrantes de granel." };
  }
  if (!Number.isFinite(input.kg) || input.kg < 0) {
    return { ok: false, error: "Kg inválidos." };
  }
  const now = new Date().toISOString();
  const record: GranelRemainderRecord = {
    id: `gr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workItemId: null,
    originSector: "DEPOSITO",
    product: input.product?.trim() || "",
    client: input.client?.trim() || "",
    bulkLot: input.bulkLot?.trim() || "",
    kgAvailable: input.kg,
    intakeDate: input.intakeDate || now.slice(0, 10),
    reportedBy: input.actorName,
    observation: input.observation?.trim() || "",
    location: input.location?.trim() || "",
    status: input.asDraft ? "BORRADOR" : input.kg > 0 ? "DISPONIBLE" : "BORRADOR",
    createdAt: now,
    updatedAt: now,
  };
  const items = readAll();
  items.unshift(record);
  writeAll(items);
  pushAudit({
    granelId: record.id,
    action: "create",
    actorSector: input.actorSector,
    actorName: input.actorName,
    afterKg: input.kg,
  });
  return { ok: true, record };
}

export function updateGranel(input: {
  id: string;
  actorSector: SectorId;
  actorName: string;
  patch: Partial<
    Pick<
      GranelRemainderRecord,
      | "product"
      | "client"
      | "bulkLot"
      | "kgAvailable"
      | "intakeDate"
      | "location"
      | "observation"
      | "status"
    >
  >;
  reason?: string;
}): { ok: true; record: GranelRemainderRecord } | { ok: false; error: string } {
  if (!canMutateGraneles(input.actorSector)) {
    return { ok: false, error: "Solo Depósito puede editar graneles." };
  }
  const items = readAll();
  const idx = items.findIndex((i) => i.id === input.id);
  if (idx < 0) return { ok: false, error: "Registro no encontrado." };
  const current = items[idx]!;
  if (current.status === "ANULADO") {
    return { ok: false, error: "No se puede editar un registro anulado." };
  }
  const beforeKg = current.kgAvailable;
  const next = { ...current, ...input.patch, updatedAt: new Date().toISOString() };
  if (next.kgAvailable < 0) return { ok: false, error: "Kg no pueden ser negativos." };
  if (next.kgAvailable === 0 && next.status === "DISPONIBLE") next.status = "AGOTADO";
  items[idx] = next;
  writeAll(items);
  pushAudit({
    granelId: next.id,
    action: beforeKg !== next.kgAvailable ? "delta" : "update",
    actorSector: input.actorSector,
    actorName: input.actorName,
    reason: input.reason,
    beforeKg,
    afterKg: next.kgAvailable,
  });
  return { ok: true, record: next };
}

/**
 * Política Eliminar:
 * - Manual sin workItemId → hard delete si BORRADOR/DISPONIBLE sin movimientos posteriores (simple).
 * - Originado en Envasado → anular con motivo.
 */
export function deleteOrAnnulGranel(input: {
  id: string;
  actorSector: SectorId;
  actorName: string;
  reason: string;
}): { ok: true; action: "eliminar" | "anular" } | { ok: false; error: string } {
  if (!canMutateGraneles(input.actorSector)) {
    return { ok: false, error: "Solo Depósito puede eliminar graneles." };
  }
  const reason = normalizeOptionalReason(input.reason);

  const items = readAll();
  const idx = items.findIndex((i) => i.id === input.id);
  if (idx < 0) return { ok: false, error: "Registro no encontrado." };
  const current = items[idx]!;

  const isManualDraft = !current.workItemId && current.status === "BORRADOR";
  if (isManualDraft) {
    items.splice(idx, 1);
    writeAll(items);
    pushAudit({
      granelId: current.id,
      action: "delete",
      actorSector: input.actorSector,
      actorName: input.actorName,
      reason,
    });
    return { ok: true, action: "eliminar" };
  }

  current.status = "ANULADO";
  current.annulledAt = new Date().toISOString();
  current.annulledBy = input.actorName;
  current.annulReason = reason;
  current.updatedAt = current.annulledAt;
  items[idx] = current;
  writeAll(items);
  pushAudit({
    granelId: current.id,
    action: "annul",
    actorSector: input.actorSector,
    actorName: input.actorName,
    reason,
    beforeKg: current.kgAvailable,
    afterKg: current.kgAvailable,
  });
  return { ok: true, action: "anular" };
}
