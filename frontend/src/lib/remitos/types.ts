import type { SectorId } from "@/types/operational/sector";

export const REMITO_STATUSES = [
  "BORRADOR",
  "GENERADO",
  "ANULADO",
  "ARCHIVADO",
] as const;
export type RemitoStatus = (typeof REMITO_STATUSES)[number];

export type RemitoTab = "borradores" | "generados" | "anulados";

/** Solo PRODUCCIÓN puede ver/mutar remitos (server + UI). */
export function canAccessRemitos(sector: SectorId | string | null | undefined): boolean {
  return String(sector ?? "").toUpperCase() === "PRODUCCION";
}

export type RemitoLine = {
  id: string;
  remitoId: string;
  workItemId: string;
  product: string;
  lote: string;
  vto: string;
  totalUnits: number;
  cajas1: number;
  unidades1: number;
  cajas2: number;
  unidades2: number;
  sortOrder: number;
};

export type RemitoVersionInfo = {
  id?: string;
  version: number;
  motivo: string | null;
  createdBy: string;
  createdAt: string;
  /** true si hay xlsx/pdf disponibles para esa versión. */
  downloadable: boolean;
  /** storage key / legacy id — no exponer URL pública. */
  driveFileIdXlsx?: string | null;
  driveFileIdPdf?: string | null;
};

export type RemitoRecord = {
  id: string;
  /** Correlativo interno (no editable por el usuario). */
  remitoNumber: string | null;
  /** Nombre elegido por Producción al generar. */
  displayName: string | null;
  clientIdNormalized: string;
  clientDisplay: string;
  deliveryDate: string;
  status: RemitoStatus;
  version: number;
  totalUnits: number;
  totalCajas: number;
  totalBultos: number;
  snapshot: Record<string, unknown>;
  createdBy: string | null;
  createdBySector: string | null;
  updatedBy: string | null;
  generatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  generatedAt: string | null;
  lines: RemitoLine[];
  versions: RemitoVersionInfo[];
  /** Si GENERADO y hay aprobación nueva pendiente de nueva versión. */
  offersNewVersion?: boolean;
};

export type RemitoWorkItemStatus = {
  status: "none" | "draft" | "generated";
  remitoId: string | null;
};

export type RemitoApprovalInput = {
  workItemId: string;
  clientId: string;
  clientDisplay?: string;
  deliveryDate: string;
  product: string;
  lote?: string | null;
  vto?: string | null;
  totalUnits: number;
  /** Unidades por caja para bloque 1 (opcional). */
  unitsPerCaja1?: number | null;
  /** Unidades por caja para bloque 2 (opcional). */
  unitsPerCaja2?: number | null;
  cajas1?: number | null;
  unidades1?: number | null;
  cajas2?: number | null;
  unidades2?: number | null;
};

export type RemitoDraftPatch = {
  clientDisplay?: string;
  deliveryDate?: string;
  lines?: Array<{
    id: string;
    product?: string;
    lote?: string;
    vto?: string;
    totalUnits?: number;
    cajas1?: number;
    unidades1?: number;
    cajas2?: number;
    unidades2?: number;
  }>;
  /**
   * Flag opcional: la UI pide confirmación. El servicio NO muta work items
   * silenciosamente; el flag queda registrado en snapshot/audit si viene true.
   */
  applyToWorkItem?: boolean;
};

export type RemitoGenerateOptions = {
  displayName: string;
  filename?: string;
};

export type RemitoEditGeneratedOptions = {
  motivo: string;
  displayName?: string;
  clientDisplay?: string;
  deliveryDate?: string;
  lines?: RemitoDraftPatch["lines"];
  filename?: string;
};

export type RemitoUpsertResult = {
  remito: RemitoRecord;
  created: boolean;
  /** true si el remito ya estaba GENERADO — no se mutó; ofrecer nueva versión */
  immutableOfferNewVersion?: boolean;
  duplicateWorkItem?: boolean;
};

export type RemitoListFilters = {
  tab?: RemitoTab;
  q?: string;
  clientId?: string;
  deliveryDate?: string;
  status?: RemitoStatus;
};
