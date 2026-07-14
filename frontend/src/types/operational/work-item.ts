import type { SectorId } from "@/types/operational/sector";

export const WORK_ITEM_SOURCES = [
  "semanas_2026",
  "pedidos_2026",
  "asignacion_lotes_2026",
] as const;
export type WorkItemSource = (typeof WORK_ITEM_SOURCES)[number];

export const ORIGIN_STAGES = [
  "DESARROLLO",
  "PLANIFICACION",
  "ELABORACION",
  "ACONDICIONAMIENTO",
  "CODIFICADO",
  "CALIDAD",
  "DESPACHO",
] as const;
export type OriginStage = (typeof ORIGIN_STAGES)[number];

export const WORK_ITEM_PRIORITIES = [
  "URGENTE",
  "HOY",
  "ESTA_SEMANA",
  "NORMAL",
  "BAJA",
] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

export const WORK_ITEM_STATUSES = [
  "pendiente",
  "en_curso",
  "bloqueado",
  "completo",
  "revision",
  "cancelado",
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export type WorkItemConfidence = "high" | "medium" | "low";

/** Canonical operational task — center of Genus OS (doc 22). */
export interface WorkItem {
  id: string;
  sector: SectorId;
  ownerSector: SectorId;
  /** Elaborador / responsable del bloque visual en SEMANAS — F10.1. */
  ownerPerson: string | null;
  source: WorkItemSource;
  sourceFileId: string;
  sourceSheet: string | null;
  /** Fila de cierre del slot columnar en SEMANAS (flush boundary). */
  sourceRange: string | null;
  productSourceRange: string | null;
  quantitySourceRange: string | null;
  originStage: OriginStage;
  /** Fecha textual legacy del planner (ej. "14 julio"). */
  date: string | null;
  /** Fecha planificada ISO YYYY-MM-DD (zona BA). */
  plannedDate: string | null;
  dayLabel: string | null;
  dayOfWeek: string | null;
  weekLabel: string | null;
  /** Lunes de la semana operativa (YYYY-MM-DD). */
  weekStart: string | null;
  weekId: string | null;
  client: string | null;
  product: string | null;
  quantity: string | null;
  unit: string | null;
  line: string | null;
  /** Auditoría: el bloque SEMANAS define líneas explícitas (L1–L4). */
  lineExpectedInSheet?: boolean | null;
  deliveryDate: string | null;
  status: WorkItemStatus;
  priority: WorkItemPriority | null;
  pedidoRef: string | null;
  oeRef: string | null;
  oaRef: string | null;
  loteRef: string | null;
  notes: string | null;
  actionLabel: string | null;
  href: string | null;
  confidence: WorkItemConfidence;
  createdFrom: string;
  generatedEntities: string[];
  dependsOn: string[] | null;
  blockedBy: string[] | null;
  unblocks: string[] | null;
  /** Avance operativo en vivo (Genus OS — no Sheets). */
  finishedQty?: string | null;
  operationalObservation?: string | null;
}

export interface WorkItemsResponse {
  sector: SectorId;
  ownerPerson?: string | null;
  source: "drive" | "demo";
  scannedAt: string;
  workItems: WorkItem[];
  counts: {
    total: number;
    hoy: number;
    semana: number;
    pendientes: number;
    bloqueados: number;
  };
  message?: string;
  warnings?: string[];
  qualityItems?: import("@/features/os/operational/types").QualityItem[];
  /** Estado operativo server-side — propagación cross-usuario vía Live Sync. */
  operationalOverlay?: import("@/features/os/operational/types").OperationalOverlay;
}
