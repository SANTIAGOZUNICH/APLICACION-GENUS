"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils/cn";
import type { EntityCardAction } from "@/types/ui/entity-card";
import type { Status } from "@/types/ui/status";

interface EntityHeaderProps {
  entityId: string;
  title: string;
  subtitle?: string;
  status: Status;
  identityIcon?: LucideIcon;
  primaryAction?: EntityCardAction;
  secondaryActions?: readonly EntityCardAction[];
  className?: string;
}

function EntityHeaderAction({ action }: { action: EntityCardAction }) {
  const variant = action.variant ?? "primary";

  if (action.href) {
    return (
      <Button variant={variant} size="sm" asChild disabled={action.disabled}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }

  return (
    <Button
      variant={variant}
      size="sm"
      onClick={action.onClick}
      disabled={action.disabled}
    >
      {action.label}
    </Button>
  );
}

/**
 * EntityHeader — identity block with status badge and contextual actions.
 */
export function EntityHeader({
  entityId,
  title,
  subtitle,
  status,
  identityIcon: IdentityIcon,
  primaryAction,
  secondaryActions = [],
  className,
}: EntityHeaderProps) {
  const hasActions = Boolean(primaryAction || secondaryActions.length > 0);

  return (
    <header
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5",
        className
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {IdentityIcon && (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-item-active-bg)]">
              <IdentityIcon
                className="size-5 text-[var(--color-action)]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </div>
          )}
          <div className="min-w-0">
            <p
              className="font-mono text-[var(--muted-foreground)]"
              style={{ fontSize: "var(--text-caption)" }}
            >
              {entityId}
            </p>
            <h1
              className="font-semibold text-[var(--foreground)]"
              style={{ fontSize: "var(--text-screen-title)" }}
            >
              {title}
            </h1>
            {subtitle && (
              <p
                className="mt-1 text-[var(--muted-foreground)]"
                style={{ fontSize: "var(--text-body)" }}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <StatusBadge status={status} size="md" />
          {hasActions && (
            <div className="flex flex-wrap items-center gap-2">
              {secondaryActions.map((action) => (
                <EntityHeaderAction key={action.label} action={action} />
              ))}
              {primaryAction && (
                <EntityHeaderAction action={primaryAction} />
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
