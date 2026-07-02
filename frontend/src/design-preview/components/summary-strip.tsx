interface SummaryStripProps {
  paraHacer: number;
  enProgreso: number;
  terminadas: number;
  bloqueadas: number;
}

const ITEMS = [
  { key: "paraHacer", label: "Para hacer", accent: "text-[var(--os-text)]" },
  { key: "enProgreso", label: "En progreso", accent: "text-blue-600" },
  { key: "terminadas", label: "Terminadas", accent: "text-emerald-600" },
  { key: "bloqueadas", label: "Bloqueadas", accent: "text-rose-600" },
] as const;

/** Resumen operativo del día — 4 contadores rápidos. */
export function SummaryStrip(props: SummaryStripProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ITEMS.map(({ key, label, accent }) => (
        <div
          key={key}
          className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-5 py-4 shadow-[var(--os-shadow-sm)]"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--os-text-muted)]">
            {label}
          </p>
          <p className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${accent}`}>
            {props[key]}
          </p>
        </div>
      ))}
    </div>
  );
}
