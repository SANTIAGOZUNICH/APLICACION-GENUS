import type { BandejaTaskPayload } from "@/types/bandeja/bandeja-task";

export interface WorkspaceTask {
  id: string;
  sectionId: string;
  urgencyScore: number;
  payload: BandejaTaskPayload;
}

export interface WorkspacePanoramaMetric {
  id: string;
  label: string;
  value: string;
  hint: string;
  tone: "ok" | "attention" | "problem" | "neutral";
}
