import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils/cn";
import type {
  EntityCardAction,
  EntityCardProps,
  EntityCardVariant,
} from "@/types/ui/entity-card";

const variantStyles: Record<EntityCardVariant, string> = {
  default: "p-4 gap-3",
  compact: "p-3 gap-2",
  featured: "p-6 gap-4 border-[var(--color-action)]/20 shadow-md",
};

function EntityCardActionButton({ action }: { action: EntityCardAction }) {
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
 * EntityCard — base card for all GMP entities.
 * Reusable in Bandeja decks, Workspaces and Object Page sections.
 */
export function EntityCard({
  entityId,
  title,
  status,
  identityIcon: IdentityIcon,
  subtitle,
  metadata = [],
  urgency,
  primaryAction,
  secondaryActions = [],
  variant = "default",
  onClick,
  href,
  className,
}: EntityCardProps) {
  const isInteractive = Boolean(onClick || href);

  const content = (
    <>
      {/* Header: identity + title + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {IdentityIcon && (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-item-active-bg)]">
              <IdentityIcon
                className="size-4.5 text-[var(--color-action)]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p
              className="font-mono text-[var(--text-caption)] text-[var(--muted-foreground)]"
            >
              {entityId}
            </p>
            <h3
              className={cn(
                "truncate font-medium text-[var(--foreground)]",
                variant === "featured" && "text-base"
              )}
              style={{
                fontSize:
                  variant === "featured"
                    ? "var(--text-section)"
                    : "var(--text-card-title)",
              }}
            >
              {title}
            </h3>
            {subtitle && (
              <p
                className="mt-0.5 truncate text-[var(--muted-foreground)]"
                style={{ fontSize: "var(--text-meta)" }}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <StatusBadge status={status} size={variant === "compact" ? "sm" : "md"} />
      </div>

      {/* Metadata row */}
      {metadata.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--muted-foreground)]"
          style={{ fontSize: "var(--text-meta)" }}
        >
          {metadata.map((item, index) => (
            <React.Fragment key={item.id}>
              {index > 0 && (
                <span className="text-[var(--border)]" aria-hidden="true">
                  ·
                </span>
              )}
              <span>
                <span className="sr-only">{item.label}: </span>
                {item.value}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Footer: urgency + actions */}
      {(urgency || primaryAction || secondaryActions.length > 0) && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="min-w-0 flex-1">{urgency}</div>
          <div className="flex shrink-0 items-center gap-2">
            {secondaryActions.map((action) => (
              <EntityCardActionButton key={action.label} action={action} />
            ))}
            {primaryAction && (
              <EntityCardActionButton action={primaryAction} />
            )}
          </div>
        </div>
      )}
    </>
  );

  const baseClassName = cn(
    "flex flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] text-left transition-colors",
    variantStyles[variant],
    isInteractive &&
      "cursor-pointer hover:border-[var(--color-action)]/30 hover:bg-[var(--sidebar-item-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
    className
  );

  if (href) {
    return (
      <Link href={href} className={baseClassName} onClick={onClick}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" className={cn(baseClassName, "w-full")} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <article className={baseClassName}>{content}</article>;
}
