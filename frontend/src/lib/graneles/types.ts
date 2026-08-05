/** Tipos de dominio — Depósito Graneles (sobrantes de granel; migración 0014). */
import type { SectorId } from "@/types/operational/sector";

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
  annulledAt: string | null;
  annulledBy: string | null;
  annulReason: string | null;
}

export type GranelAuditAction = "create" | "update" | "annul" | "archive" | "delete" | "delta";

export interface GranelAuditEntry {
  id: string;
  granelId: string;
  action: GranelAuditAction;
  actorSector: SectorId;
  actorName: string;
  reason: string | null;
  beforeKg: number | null;
  afterKg: number | null;
  createdAt: string;
}

export type GranelesActor = {
  email: string;
  sector: SectorId;
  displayName: string;
};

export type CreateManualGranelInput = {
  product?: string;
  client?: string;
  bulkLot?: string;
  kg: number;
  intakeDate?: string;
  location?: string;
  observation?: string;
  asDraft?: boolean;
};

export type UpsertGranelFromEnvasadoInput = {
  workItemId: string;
  originSector: SectorId;
  product: string;
  client: string;
  bulkLot: string;
  kg: number;
  reportedBy: string;
  observation?: string;
};

export type UpdateGranelPatch = Partial<
  Pick<
    GranelRemainderRecord,
    "product" | "client" | "bulkLot" | "kgAvailable" | "intakeDate" | "location" | "observation" | "status"
  >
>;

export type UpdateGranelInput = {
  patch: UpdateGranelPatch;
  reason?: string;
};

export type ListGranelesFilters = {
  /** Incluye ANULADO y ARCHIVADO en el listado. */
  includeAnnulled?: boolean;
  /** Filtro explícito por estado (tiene prioridad sobre la exclusión por defecto). */
  status?: GranelStatus;
};

export type UpsertGranelResult = {
  record: GranelRemainderRecord;
  created: boolean;
  duplicated: boolean;
};

export type DeleteOrAnnulResult = {
  action: "eliminar" | "anular";
  record: GranelRemainderRecord | null;
};
