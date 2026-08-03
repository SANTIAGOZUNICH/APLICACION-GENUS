import type { SectorId } from "@/types/operational/sector";

/** Sectores operativos con acceso a procedimientos (lectura/subida). */
export const PROCEDURE_SECTORS = [
  "PRODUCCION",
  "CALIDAD",
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "MATERIA_PRIMA",
  "CODIFICADO",
  "DEPOSITO",
] as const satisfies readonly SectorId[];

export type ProcedureSector = (typeof PROCEDURE_SECTORS)[number];

export const PROCEDURE_ADMIN_SECTORS: SectorId[] = ["CALIDAD", "PRODUCCION"];

export type ProcedureFolderStatus = "active" | "archived" | "deleted";
export type ProcedureFileStatus = "active" | "archived" | "deleted";

export type ProcedureFolderRecord = {
  id: string;
  parentId: string | null;
  name: string;
  relativePath: string;
  status: ProcedureFolderStatus;
  createdBy: string;
  createdBySector: SectorId;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
};

export type ProcedureFileRecord = {
  id: string;
  folderId: string;
  displayName: string;
  relativePath: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  currentVersion: number;
  status: ProcedureFileStatus;
  createdBy: string;
  createdBySector: SectorId;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
};

export type ProcedureVersionRecord = {
  id: string;
  fileId: string;
  version: number;
  storageProvider: string;
  storageKey: string;
  originalName: string;
  displayName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  changeReason: string | null;
  isCurrent: boolean;
  createdBy: string;
  createdBySector: SectorId;
  createdAt: string;
};

export type ProcedureActor = { email: string; sector: SectorId };

export type ProcedureListFilters = {
  q?: string;
  mimeFilter?: string;
  includeArchived?: boolean;
};

export type VersionUploadMode = "new_version" | "keep_separate";

export function canAccessProcedimientos(sector: SectorId): boolean {
  return (PROCEDURE_SECTORS as readonly SectorId[]).includes(sector);
}

export function isProcedureAdmin(sector: SectorId): boolean {
  return PROCEDURE_ADMIN_SECTORS.includes(sector);
}

export function canMutateProcedureEntity(
  actor: ProcedureActor,
  ownerEmail: string
): boolean {
  if (isProcedureAdmin(actor.sector)) return true;
  return actor.email.toLowerCase() === ownerEmail.toLowerCase();
}
