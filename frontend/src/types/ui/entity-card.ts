/**
 * EntityCard — shared contract for cards across Bandeja, Workspaces and Object Pages.
 * /docs/07-design-system.md §4, §5
 */

import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import type { Status } from "@/types/ui/status";

export type EntityCardVariant = "default" | "compact" | "featured";

export interface EntityMetadataItem {
  /** Stable key for React lists and Object Page sections. */
  id: string;
  label: string;
  value: string;
}

export interface EntityCardAction {
  label: string;
  /** E6 — dispatches through the action pipeline when set. */
  actionId?: import("@/types/actions").ActionId;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary" | "tertiary";
  disabled?: boolean;
}

export interface EntityCardProps {
  /** Domain identifier, e.g. OE-2024-0142 */
  entityId: string;
  /** Primary title in plain language */
  title: string;
  /** Canonical status — never a free-form string */
  status: Status;
  /** Optional identity icon (domain-specific) */
  identityIcon?: LucideIcon;
  /** Secondary line under title */
  subtitle?: string;
  /** 1–3 metadata items for body row */
  metadata?: readonly EntityMetadataItem[];
  /** Urgency signal — progress, expiry, severity, etc. */
  urgency?: React.ReactNode;
  /** Single primary action per card grammar */
  primaryAction?: EntityCardAction;
  /** Optional secondary actions (overflow / Object Page toolbar) */
  secondaryActions?: EntityCardAction[];
  /** Visual density — featured for Bandeja Foco, compact for lists */
  variant?: EntityCardVariant;
  /** Navigate to Object Page */
  onClick?: () => void;
  href?: string;
  className?: string;
}
