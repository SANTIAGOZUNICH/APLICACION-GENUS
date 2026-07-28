import type { SectorId } from "@/types/operational/sector";
import type { MpControlLineEstado } from "./calcs";

export type MpWeeklyControlStatus =
  | "BORRADOR"
  | "COMPLETADO"
  | "ANULADO"
  | "ARCHIVADO";

/** Metadatos de lifecycle persistidos en audit (Neon) o memoria. */
export type MpWeeklyControlLifecycleMeta = {
  previousStatus?: MpWeeklyControlStatus;
  annulReason?: string;
  annulledAt?: string;
  annulledBy?: string;
  archivedAt?: string;
  archivedBy?: string;
  restoredAt?: string;
  restoredBy?: string;
};

export type MpWeeklyControlLine = {
  id: string;
  sortOrder: number;
  codigo: string;
  materiaPrima: string;
  formulaPct: number | null;
  kgNecesarios: number | null;
  kgEditados: number | null;
  stockActual: number | null;
  stockProyectado: number | null;
  diferencia: number | null;
  estado: MpControlLineEstado;
  lote: string;
  preparado: boolean;
  observacion: string;
};

export type MpFormulaSnapshot = {
  client: string;
  product: string;
  source: "DRIVE" | "CACHE_NEON" | string;
  driveFileId?: string;
  driveModifiedTime?: string | null;
  driveChecksum?: string;
  materials: Array<{
    materiaPrima: string;
    codigo: string;
    formulaPct: number | null;
  }>;
  capturedAt: string;
};

export type MpWeeklyControl = {
  id: string;
  status: MpWeeklyControlStatus;
  client: string;
  product: string;
  quantityKg: number | null;
  linkedOeId: string | null;
  driveFileId: string | null;
  driveModifiedTime: string | null;
  driveChecksum: string | null;
  formulaSnapshot: MpFormulaSnapshot | null;
  source: string | null;
  lines: MpWeeklyControlLine[];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lifecycle?: MpWeeklyControlLifecycleMeta;
};

export type MpControlActor = { email: string; sector: SectorId };

export function canWriteMpControl(sector: SectorId): boolean {
  return sector === "MATERIA_PRIMA";
}

export function canReadMpControl(sector: SectorId): boolean {
  return (
    sector === "MATERIA_PRIMA" ||
    sector === "PRODUCCION" ||
    sector === "CALIDAD" ||
    sector === "DIRECCION"
  );
}
