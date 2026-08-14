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
  "entregado",
  "cancelado",
  /** Enviado desde Envasado; pendiente en Codificado. */
  "en_codificado",
  /** Codificado entregó a Calidad/Producción (alias operativo de pendiente calidad). */
  "codificado_completo",
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
  /** Fecha planificada ISO YYYY-MM-DD (zona BA) — inicio del rango asignado. */
  plannedDate: string | null;
  /**
   * Fin inclusive del rango planificado (ISO). Si null, el trabajo cubre solo plannedDate.
   * Un solo workItemId aparece en cada día del rango en Semana; KPIs no se duplican.
   */
  plannedDateTo?: string | null;
  /** Celda del encabezado de fecha en SEMANAS (auditoría). */
  dateHeaderSourceRange?: string | null;
  /** Método de resolución temporal del planner. */
  dateResolutionMethod?:
    | "native_date"
    | "full_human_header"
    | "split_header"
    | "inherited_week_context"
    | null;
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
  /** Lote PT asignado en Producción / Envasado (opcional). */
  packagingLote?: string | null;
  /** Vencimiento PT (opcional, ISO o texto operativo). */
  packagingVto?: string | null;
  /** Total oficial de unidades envasadas (opcional). */
  packagingTotalUnits?: number | null;
  /** Cajas cargadas (opcional) — legacy / grupo[0]. */
  packagingCajas?: number | null;
  /** Unidades por caja (opcional) — legacy / grupo[0]. */
  packagingUnidadesPorCaja?: number | null;
  /**
   * Combinaciones de cajas (fuente canónica).
   * Legacy packagingCajas/unidadesPorCaja = packingGroups[0].
   */
  packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
  /** Observación si producido ≠ embalado (no bloquea entrega). */
  packingMismatchObservation?: string | null;
  /**
   * Cierre físico de acondicionamiento (0024 — PARTE A). Unidades
   * producidas pero no entregables comercialmente. null = no informado
   * (histórico o todavía no cerrado) — nunca se infiere como 0.
   */
  sampleUnits?: number | null;
  /** SUM(packingGroups) al momento del cierre — lo que va al remito, no finishedQty/packagingTotalUnits. */
  deliverableUnits?: number | null;
  packagingClosedAt?: string | null;
  packagingClosedBy?: string | null;
  /** Historial de avances de cantidades (JSON-serializable). */
  packagingQtyHistory?: Array<{
    at: string;
    by: string;
    totalUnits: number | null;
    cajas: number | null;
    unidadesPorCaja: number | null;
    packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
  }> | null;
  /** Flujo Codificado (proyección Neon). */
  viaCodificado?: boolean;
  codificadoOriginSector?: SectorId | null;
  codificadoOriginLabel?: string | null;
  sentToCodificadoAt?: string | null;
  sentToCodificadoBy?: string | null;
  deliveredFromCodificadoAt?: string | null;
  deliveredFromCodificadoBy?: string | null;
  codificadoRevision?: number;
  codificadoCancelledAt?: string | null;
  bulkRemainderKg?: number | null;
  bulkRemainderObservation?: string | null;
  bulkRemainderId?: string | null;
  nativeVersion?: number;
  nativeId?: string;
  /** Datos de finalización (0023 — durable en Neon). */
  completedAt?: string | null;
  completedBy?: string | null;
  progressUpdatedAt?: string | null;
  progressUpdatedBy?: string | null;
  operationalCancelledAt?: string | null;
  operationalCancelledBy?: string | null;
  operationalCancelReason?: string | null;
  /** Decisión de Calidad (0023 — durable en Neon). */
  qualityStatus?: "pendiente" | "aprobado" | "rechazado";
  qualityDecidedAt?: string | null;
  qualityDecidedBy?: string | null;
  qualityDecidedBySector?: string | null;
  qualityObservation?: string | null;
  qualityChangeReason?: string | null;
  /**
   * Rehacer (0027) — Calidad o Producción devuelve el trabajo al sector que
   * lo envió, editable, conservando OA/lote/VTO/historial. Distinto de
   * Rechazar: no es una decisión formal de Calidad. Se limpia cuando el
   * sector vuelve a completar/entregar (completeWorkDurable/deliverFromCodificadoDurable).
   */
  reworkRequestedAt?: string | null;
  reworkRequestedBy?: string | null;
  reworkRequestedBySector?: string | null;
  reworkReason?: string | null;
}

export interface WorkItemsResponse {
  sector: SectorId;
  ownerPerson?: string | null;
  source: "drive" | "demo" | "native";
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
  /** Revision del snapshot en la instancia que respondió — anti-stale en cliente. */
  revision?: number;
  /** Hash SEMANAS aplicado en esa instancia (si existe). */
  semanasVersion?: string | null;
}
