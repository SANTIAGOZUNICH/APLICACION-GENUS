import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1
          className="text-[var(--text-screen-title)] font-semibold tracking-tight text-[var(--foreground)]"
          style={{ fontSize: "var(--text-screen-title)" }}
        >
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-[var(--muted-foreground)]" style={{ fontSize: "var(--text-body)" }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
