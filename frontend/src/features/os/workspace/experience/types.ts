import type { SectorId } from "@/types/operational/sector";

export type WorkCardStatus = "ready" | "active" | "blocked" | "waiting_quality" | "waiting_approval";

export type AttentionKind =
  | "blocked"
  | "missing_materials"
  | "waiting_quality"
  | "waiting_approval";

export interface WorkCardData {
  id: string;
  reference: string;
  lot?: string;
  product: string;
  client?: string;
  status: WorkCardStatus;
  priority?: "urgent" | "today" | "normal";
  meta?: string;
}

export interface AttentionItemData {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
}

export interface NextItemData {
  id: string;
  label: string;
  hint?: string;
}

export interface ActivityItemData {
  id: string;
  text: string;
  time: string;
}

/** View-model premium — capa visual, desacoplada del WorkspaceResolver. */
export interface WorkspaceExperienceView {
  sectorId: SectorId;
  heroCtaLabel: string;
  workSectionTitle: string;
  workItems: WorkCardData[];
  attentionItems: AttentionItemData[];
  nextItems: NextItemData[];
  recentActivity: ActivityItemData[];
}
