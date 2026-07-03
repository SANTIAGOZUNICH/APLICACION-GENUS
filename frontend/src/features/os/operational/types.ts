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
  status: QualityDecisionStatus;
  relatedWorkItemId: string | null;
}

export interface OperationalPlanSnapshot {
  sector: SectorId;
  ownerPerson?: string | null;
  source: "drive" | "demo";
  scannedAt: string;
  workItems: WorkItem[];
  qualityItems: QualityItem[];
  message?: string;
}

export interface QualityDecisionRecord {
  itemId: string;
  status: QualityDecisionStatus;
  decidedAt: string;
  decidedBy?: string;
}

export const OPERATIONAL_POLL_INTERVAL_MS = 30_000;
