import type { ReactNode } from "react";

export interface DesignSystemSectionProps {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}

export function DesignSystemSection({
  id,
  title,
  description,
  children,
}: DesignSystemSectionProps) {
  return (
    <section id={id} className="mb-12 scroll-mt-24">
      <h2
        className="mb-2 font-semibold text-[var(--foreground)]"
        style={{ fontSize: "var(--text-section)" }}
      >
        {title}
      </h2>
      {description && (
        <p className="mb-6 text-sm text-[var(--muted-foreground)]">{description}</p>
      )}
      {children}
    </section>
  );
}

export function DesignSystemPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
