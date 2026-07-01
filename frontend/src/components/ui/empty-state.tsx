import type { LucideIcon } from "lucide-react";
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
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "neutral",
  className,
  ...props
}: EmptyStateProps) {
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
