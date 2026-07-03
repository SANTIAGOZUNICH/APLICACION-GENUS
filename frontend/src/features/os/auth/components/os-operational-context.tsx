"use client";

import { buildPlantContextSnapshot } from "../lib/plant-context";

const OPERATIONAL_HOURS = "08:00 — 17:00 hs";

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-white/[0.06] py-4 last:border-b-0">
      <span className="text-[0.8125rem] text-[var(--os-sidebar-muted)]">{label}</span>
      <span className="text-right text-[0.9375rem] font-medium tracking-tight text-[var(--os-sidebar-text)]">
        {value}
      </span>
    </div>
  );
}

/** Contexto operativo mínimo — sin sensación de dashboard. */
export function OsOperationalContext() {
  const { plantStatus } = buildPlantContextSnapshot();

  return (
    <div className="mt-auto pt-12" aria-label="Estado operativo">
      <StatusLine label="Estado operativo" value={plantStatus} />
      <StatusLine label="Horario operativo" value={OPERATIONAL_HOURS} />
    </div>
  );
}
