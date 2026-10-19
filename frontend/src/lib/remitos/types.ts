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

/** Producción gestiona remitos; Administración / Facturación solo los consulta (nunca crea, edita ni anula). */
export function canReadRemitos(sector: SectorId | string | null | undefined): boolean {
  const s = String(sector ?? "").toUpperCase();
  return s === "PRODUCCION" || s === "ADMINISTRACION";
}

/** Trazabilidad Cliente → Pedido → Producto → Entrega → Remito de una línea creada desde una entrega real. */
export type RemitoLineTrace = {
  deliveryLineId: string;
  workItemId: string;
  pedido: string | null;
  orderRef: string | null;
  /** Texto de remito que se cargó al registrar la entrega (si había). */
  deliveryRemito?: string | null;
};

export type RemitoCajaCombo = {
  cajas: number;
  unidades: number;
};

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
  /** Tercer tipo de caja (columnas L/N del modelo). */
  cajas3: number;
  unidades3: number;
  /**
   * Combinaciones extra (>3). Las primeras 3 van a columnas oficiales;
   * el resto se anota en la línea L/VTO como EXTRA.
   */
  extraCajas: RemitoCajaCombo[];
  sortOrder: number;
  /** Solo líneas creadas desde una entrega real (Generar remitos). */
  trace?: RemitoLineTrace;
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
  cajas3?: number | null;
  unidades3?: number | null;
  extraCajas?: RemitoCajaCombo[] | null;
  /** Unidades por caja para bloque 3 (opcional). */
  unitsPerCaja3?: number | null;
  trace?: RemitoLineTrace;
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
    cajas3?: number;
    unidades3?: number;
    extraCajas?: RemitoCajaCombo[];
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
