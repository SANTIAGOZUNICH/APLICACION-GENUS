import type { BandejaDayPulse } from "@/types/bandeja/bandeja-task";

export interface BandejaDayPulseProps {
  pulse: BandejaDayPulse;
}

export function BandejaDayPulse({ pulse }: BandejaDayPulseProps) {
  const total = pulse.completed + pulse.pending;
  const percent = total > 0 ? Math.round((pulse.completed / total) * 100) : 0;

  return (
    <div
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
      aria-label="Pulso del día"
    >
      <div className="mb-2 flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-[var(--foreground)]">Pulso del día</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          {pulse.completed} hecho · {pulse.pending} pendiente
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--border-subtle)]">
        <div
          className="h-full rounded-full bg-[var(--color-ok)] transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
