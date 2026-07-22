import type { WorkItem } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";

export type QualityDecisionStatus = "pendiente" | "aprobado" | "rechazado";

export type QualityItemKind = "granel" | "salida";

export interface QualityItem {
  id: string;
  kind: QualityItemKind;
  lote: string | null;
  product: string;
  client: string;
  oe: string | null;
  oa: string | null;
  line: string | null;
  quantity: string | null;
  dayLabel: string;
  deliveryDate?: string | null;
  status: QualityDecisionStatus;
  relatedWorkItemId: string | null;
  /** Sector que entregó el trabajo — transferencia cross-sector. */
  receivedFrom?: SectorId | null;
  completedAt?: string | null;
  completedBy?: string | null;
  observation?: string | null;
}

/** Registro de transferencia de trabajo — demo localStorage; futuro POST Sheets. */
export interface CompletionEvent {
  id: string;
  workItemId: string;
  sourceSector: SectorId;
  kind: QualityItemKind;
  completedBy: string;
  completedAt: string;
  finishedQty: string;
  observation: string;
  product: string;
  client: string | null;
  line: string | null;
  ownerPerson: string | null;
  oeRef: string | null;
  oaRef: string | null;
  loteRef: string | null;
  quantityPlanned: string | null;
  unit: string | null;
  dayLabel: string | null;
  deliveryDate?: string | null;
}

export interface OperationalActivityEntry {
  id: string;
  at: string;
  actor: string;
  message: string;
  type: "transfer" | "quality_approve" | "quality_reject";
}

export interface OperationalPlanSnapshot {
  sector: SectorId;
  ownerPerson?: string | null;
  source: "drive" | "demo" | "native";
  scannedAt: string;
  workItems: WorkItem[];
  qualityItems: QualityItem[];
  message?: string;
  operationalOverlay?: OperationalOverlay;
  /** Version SEMANAS / revision Live Sync — anti-stale. */
  semanasVersion?: string | null;
  revision?: number;
}

/** Overlay operativo autoritativo del servidor (Live Sync). */
export interface OperationalOverlay {
  revision: number;
  progress: Record<string, WorkProgressOverlay>;
  decisions: Record<string, QualityDecisionRecord>;
  completions: CompletionEvent[];
}

export interface WorkProgressOverlay {
  itemId: string;
  finishedQty: string;
  observation: string;
  status?: string;
  updatedAt: string;
  updatedBy?: string;
  completedAt?: string;
  sector?: SectorId;
}

export interface QualityDecisionRecord {
  itemId: string;
  status: QualityDecisionStatus;
  decidedAt: string;
  decidedBy?: string;
  observation?: string;
}

export const OPERATIONAL_POLL_INTERVAL_MS = 0;
/** @deprecated Reemplazado por Live Sync SSE — mantener 0. */
export const OPERATIONAL_POLL_LEGACY_MS = 30_000;
