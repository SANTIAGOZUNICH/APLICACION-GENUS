import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import type {
  CompletionEvent,
  QualityDecisionRecord,
  QualityItem,
} from "@/features/os/operational/types";

export type LiveSyncEventType =
  | "snapshot.updated"
  | "work.progress"
  | "work.completed"
  | "quality.decided"
  | "heartbeat";

export interface LiveSyncEventBase {
  type: LiveSyncEventType;
  revision: number;
  at: string;
}

export interface SnapshotUpdatedEvent extends LiveSyncEventBase {
  type: "snapshot.updated";
  sectors: SectorId[];
  totalWorkItems: number;
}

export interface WorkProgressEvent extends LiveSyncEventBase {
  type: "work.progress";
  itemId: string;
  sector: SectorId;
  status: string;
  /** Sectores que deben refrescar de inmediato. */
  notifySectors: SectorId[];
}

export interface WorkCompletedEvent extends LiveSyncEventBase {
  type: "work.completed";
  itemId: string;
  sourceSector: SectorId;
  notifySectors: SectorId[];
  completion: CompletionEvent;
}

export interface QualityDecidedEvent extends LiveSyncEventBase {
  type: "quality.decided";
  itemId: string;
  status: "aprobado" | "rechazado";
  notifySectors: SectorId[];
}

export interface HeartbeatEvent extends LiveSyncEventBase {
  type: "heartbeat";
}

export type LiveSyncEvent =
  | SnapshotUpdatedEvent
  | WorkProgressEvent
  | WorkCompletedEvent
  | QualityDecidedEvent
  | HeartbeatEvent;

export interface LiveSyncSnapshot {
  revision: number;
  updatedAt: string;
  sheetsSyncedAt: string | null;
  workItems: WorkItem[];
  qualityItems: QualityItem[];
  warnings: string[];
  sourcesIndexed: {
    semanas_2026: boolean;
    pedidos_2026: boolean;
    asignacion_lotes_2026: boolean;
  };
}

export interface ServerOperationalOverlay {
  progress: Record<string, WorkProgressPayload>;
  decisions: Record<string, QualityDecisionRecord>;
  completions: CompletionEvent[];
}

export interface WorkProgressPayload {
  itemId: string;
  finishedQty: string;
  observation: string;
  status?: string;
  updatedAt: string;
  updatedBy?: string;
  completedAt?: string;
  sector?: SectorId;
}

export interface LiveSyncStatus {
  revision: number;
  updatedAt: string;
  sheetsSyncedAt: string | null;
  subscribers: number;
  snapshotReady: boolean;
  workItemCount: number;
}
