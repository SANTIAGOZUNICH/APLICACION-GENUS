"use client";

/**
 * Selector de orden compartido — mismo look que el "Ordenar" ya usado en
 * native-orders-list-view.tsx (OA/OE) y entregados-view.tsx, para que toda
 * pantalla con ordenamiento use el mismo componente en vez de reimplementar
 * el `<select>` cada vez (ver AUDIT_ORDENAMIENTO_GLOBAL).
 */
export interface SortSelectOption {
  key: string;
  label: string;
}

export function SortSelect({
  value,
  onChange,
  options,
  label = "Ordenar",
  testId = "sort-select",
  className,
}: {
  value: string;
  onChange: (key: string) => void;
  options: readonly SortSelectOption[];
  label?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs ${className ?? ""}`}>
      <span className="text-[var(--os-text-muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-2 text-sm"
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
