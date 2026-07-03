import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-5">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-1 text-sm text-[var(--os-text-muted)]">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}
