import type { LucideIcon } from "lucide-react";
import type { EntityCardAction } from "@/types/ui/entity-card";
import type { Status } from "@/types/ui/status";

/** Canonical entity kinds supported by the Entity Pages framework. */
export const EntityPageKinds = {
  OE: "oe",
  OA: "oa",
  LOTE: "lote",
  PEDIDO: "pedido",
  LIBERACION: "liberacion",
} as const;

export type EntityPageKind =
  (typeof EntityPageKinds)[keyof typeof EntityPageKinds];

/** A step in an entity lifecycle — rendered by EntityStatusFlow. */
export interface EntityStatusFlowStep {
  id: string;
  label: string;
}

/** Key/value field with optional cross-entity navigation. */
export interface EntityKeyValueItem {
  id: string;
  label: string;
  value: string;
  href?: string;
}

/**
 * Activity log entry — definitive structure for future Comunicación integration.
 * Layout: Hora → Usuario → Acción → Descripción
 */
export interface EntityActivityLogEntry {
  id: string;
  /** Display time, e.g. "14:32" or "Hoy 14:32" */
  timestamp: string;
  user: string;
  action: string;
  description: string;
}

/** Summary card linking to another entity page. */
export interface EntityRelatedObject {
  id: string;
  kind: EntityPageKind;
  entityId: string;
  title: string;
  status: Status;
  subtitle?: string;
}

/** Inline summary card within a section (not a navigation target). */
export interface EntitySectionCard {
  id: string;
  title: string;
  status?: Status;
  description?: string;
  items: EntityKeyValueItem[];
}

/** Audit-only table: consumos, movimientos, renglones. */
export interface EntityAuditTableColumn {
  id: string;
  label: string;
}

export interface EntityAuditTableRow {
  id: string;
  cells: Record<string, string>;
}

export interface EntityAuditTable {
  id: string;
  columns: readonly EntityAuditTableColumn[];
  rows: readonly EntityAuditTableRow[];
}

export type EntityPageSectionContent =
  | { type: "key-values"; items: readonly EntityKeyValueItem[] }
  | { type: "cards"; cards: readonly EntitySectionCard[] }
  | { type: "audit-table"; table: EntityAuditTable };

/** Content section rendered inside EntityPageLayout. */
export interface EntityPageSectionData {
  id: string;
  title: string;
  description?: string;
  content: EntityPageSectionContent;
}

/** Full page model consumed by EntityPageView. */
export interface EntityPageModel {
  kind: EntityPageKind;
  entityId: string;
  title: string;
  subtitle?: string;
  status: Status;
  identityIcon?: LucideIcon;
  statusFlow: readonly EntityStatusFlowStep[];
  currentStageId: string;
  primaryAction?: EntityCardAction;
  secondaryActions?: readonly EntityCardAction[];
  sections: readonly EntityPageSectionData[];
  activityLog: readonly EntityActivityLogEntry[];
  relatedObjects: readonly EntityRelatedObject[];
}
