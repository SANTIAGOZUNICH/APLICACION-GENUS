import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "tertiary";
}

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  /** Positive tone when work queue is clear */
  tone?: "neutral" | "positive";
  /**
   * legacy — app workspaces (tokens doc 07)
   * operational — Digital Twin / Genus OS (tokens --genus-*)
   */
  variant?: "legacy" | "operational";
  /** Alias de description para compat preview */
  message?: string;
  /** Contenido de acción custom (preview) */
  actionSlot?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  message,
  action,
  actionSlot,
  tone = "neutral",
  variant = "legacy",
  className,
  ...props
}: EmptyStateProps) {
  const body = description ?? message;
  const OperationalIcon = Icon ?? Inbox;

  if (variant === "operational") {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center rounded-[var(--genus-radius-xl)] border border-dashed border-[var(--genus-neutral-200)] bg-[var(--genus-surface-muted)] px-8 py-16 text-center os-fade-in",
          className
        )}
        {...props}
      >
        <div className="flex size-16 items-center justify-center rounded-full bg-[var(--genus-brand-primary-soft)]">
          <OperationalIcon
            className="size-7 text-[var(--genus-brand-primary)]"
            aria-hidden="true"
          />
        </div>
        <p className="mt-6 text-lg font-semibold text-[var(--genus-text-primary)]">{title}</p>
        {body && (
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--genus-text-secondary)]">
            {body}
          </p>
        )}
        {actionSlot && <div className="mt-6">{actionSlot}</div>}
        {action && !actionSlot && (
          <div className="mt-6">
            <Button variant={action.variant ?? "primary"} onClick={action.onClick}>
              {action.label}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      {Icon && (
        <div
          className={cn(
            "mb-4 flex size-12 items-center justify-center rounded-xl",
            tone === "positive"
              ? "bg-[var(--badge-ok-bg)]"
              : "bg-[var(--sidebar-item-active-bg)]"
          )}
        >
          <Icon
            className={cn(
              "size-6",
              tone === "positive"
                ? "text-[var(--color-ok)]"
                : "text-[var(--color-action)]"
            )}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </div>
      )}
      <h3
        className="mb-2 max-w-sm font-semibold text-[var(--foreground)]"
        style={{ fontSize: "var(--text-section)" }}
      >
        {title}
      </h3>
      {description && (
        <p
          className="mb-6 max-w-md text-[var(--muted-foreground)]"
          style={{ fontSize: "var(--text-body)" }}
        >
          {description}
        </p>
      )}
      {action && (
        <Button
          variant={action.variant ?? "primary"}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
