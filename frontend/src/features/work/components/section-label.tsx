import type { ReactNode } from "react";

/** Minimal section label — F9.1: no explanatory copy. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-[var(--os-space-block)] text-sm font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
      {children}
    </h2>
  );
}

export function WorkOrderDivider() {
  return <div className="my-8 border-t border-[var(--os-border)]" aria-hidden="true" />;
}
