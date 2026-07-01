import type { BandejaDayPulse, BandejaTask } from "@/types/bandeja/bandeja-task";
import type { EntityPageKind, EntityPageModel } from "@/types/entity-page";
import type { WorkspaceTask } from "@/types/workspace/workspace-task";
import type { WorkspacePanoramaMetric } from "@/types/workspace/workspace-task";

export type WorkspaceId =
  | "produccion"
  | "calidad"
  | "comercial"
  | "deposito"
  | "direccion"
  | "dt";

/** Entity page key: "oe:OE-2026-0142" */
export type EntityPageKey = `${EntityPageKind}:${string}`;

export function entityPageKey(
  kind: EntityPageModel["kind"],
  entityId: string
): string {
  return `${kind}:${entityId}`;
}

/**
 * OperationsState — single source of truth for operational UI data.
 * Public interface is adapter-agnostic; today seeded from mocks.
 */
export interface OperationsState {
  entityPages: Record<string, EntityPageModel>;
  bandejaTasks: BandejaTask[];
  workspaceTasks: Record<WorkspaceId, WorkspaceTask[]>;
  dayPulse: BandejaDayPulse;
  workspacePanorama?: Partial<Record<WorkspaceId, WorkspacePanoramaMetric[]>>;
}
