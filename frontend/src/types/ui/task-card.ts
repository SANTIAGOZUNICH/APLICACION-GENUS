/**
 * TaskCard — work unit grammar for Bandeja and Object Page headers.
 * Extends EntityCard semantics with task-specific slots.
 * /docs/07-design-system.md §4
 */

import type * as React from "react";
import type {
  EntityCardAction,
  EntityCardVariant,
  EntityMetadataItem,
} from "@/types/ui/entity-card";
import type { Status } from "@/types/ui/status";

export interface TaskCardProps {
  entityId: string;
  title: string;
  status: Status;
  metadata?: readonly EntityMetadataItem[];
  urgency?: React.ReactNode;
  primaryAction?: EntityCardAction;
  variant?: EntityCardVariant;
  onClick?: () => void;
  href?: string;
  className?: string;
}
