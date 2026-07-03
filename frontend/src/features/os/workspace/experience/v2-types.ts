import type { SectorId } from "@/types/operational/sector";
import type { WorkCardStatus } from "./types";

export type QueueSectionId = "blocked" | "queued" | "waiting_others" | "completed";

export type WorkspaceExperienceMode =
  | "operations"
  | "quality_decision"
  | "direction_panorama"
  | "warehouse";

export interface FocusBlockData {
  greetingContext: string;
  reference: string;
  workLine: string;
  metaLine?: string;
  ctaLabel: string;
  calmState?: {
    title: string;
    subtitle: string;
  };
}

export interface QualityContextLink {
  id: string;
  label: string;
}

export interface QualityDecisionFocus extends FocusBlockData {
  contextLinks: QualityContextLink[];
  decisions: Array<{ id: "reject" | "release"; label: string }>;
  queueSectionLabel: string;
}

export interface QueueCardData {
  id: string;
  reference: string;
  product: string;
  workLine: string;
  metaLine?: string;
  status: WorkCardStatus;
  ctaLabel?: string;
  ageLabel?: string;
}

export interface QueueSectionData {
  id: QueueSectionId;
  title: string;
  items: QueueCardData[];
  defaultOpen?: boolean;
}

export interface StatusCounts {
  blocked: number;
  urgent: number;
  inProgress: number;
  pending: number;
}

export interface PanoramaMetric {
  value: string;
  label: string;
}

export interface PanoramaData {
  calm: boolean;
  calmTitle?: string;
  calmSubtitle?: string;
  metrics?: PanoramaMetric[];
}

export interface ActivityRowData {
  id: string;
  text: string;
  time?: string;
}

/** View-model v2 — instrumento de precisión + sistema vivo (mock). */
export interface WorkspaceExperienceV2 {
  sectorId: SectorId;
  mode: WorkspaceExperienceMode;
  focus: FocusBlockData | QualityDecisionFocus;
  statusCounts?: StatusCounts;
  queues: QueueSectionData[];
  completedTodayCount?: number;
  completedTodayLabel?: string;
  panorama?: PanoramaData;
  recentActivity?: ActivityRowData[];
}

export function isQualityDecisionFocus(
  focus: FocusBlockData | QualityDecisionFocus
): focus is QualityDecisionFocus {
  return "decisions" in focus;
}
