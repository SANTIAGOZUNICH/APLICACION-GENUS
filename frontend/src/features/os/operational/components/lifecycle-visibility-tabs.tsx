"use client";

import type { LifecycleVisibilityFilter } from "@/lib/lifecycle";

const OPTIONS: Array<{ id: LifecycleVisibilityFilter; label: string }> = [
  { id: "activos", label: "Activos" },
  { id: "archivados", label: "Archivados" },
  { id: "anulados", label: "Anulados" },
  { id: "todos", label: "Todos" },
];

type Props = {
  value: LifecycleVisibilityFilter;
  onChange: (v: LifecycleVisibilityFilter) => void;
  className?: string;
};

export function LifecycleVisibilityTabs({ value, onChange, className }: Props) {
  return (
    <div
      className={`inline-flex flex-wrap gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-0.5 ${className ?? ""}`}
      role="tablist"
      aria-label="Filtro de visibilidad"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-[var(--os-navy,#0b2636)] text-white"
                : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            }`}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
