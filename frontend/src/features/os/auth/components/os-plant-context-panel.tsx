"use client";

import { useEffect, useState } from "react";
import { Activity, CalendarClock, Clock3, Factory, Layers3 } from "lucide-react";
import { buildPlantContextSnapshot, type PlantContextSnapshot } from "../lib/plant-context";

function ContextRow({
  icon: Icon,
  label,
  value,
  delayMs = 0,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  delayMs?: number;
}) {
  return (
    <div
      className="os-fade-in flex items-start gap-3 rounded-[var(--os-radius-sm)] border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--os-radius-sm)] bg-[var(--os-teal)]/15 text-[var(--os-teal-soft)]">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--os-sidebar-muted)]">
          {label}
        </p>
        <p className="mt-0.5 truncate text-sm font-medium text-[var(--os-sidebar-text)]">{value}</p>
      </div>
    </div>
  );
}

/** Panel contextual de planta — información operativa, no dashboard. */
export function OsPlantContextPanel() {
  const [snapshot, setSnapshot] = useState<PlantContextSnapshot>(() => buildPlantContextSnapshot());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSnapshot(buildPlantContextSnapshot());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="space-y-3" aria-label="Contexto operativo de planta">
      <ContextRow icon={CalendarClock} label="Fecha" value={snapshot.dateLabel} delayMs={80} />
      <ContextRow icon={Clock3} label="Hora · Turno" value={`${snapshot.timeLabel} · ${snapshot.shift}`} delayMs={120} />
      <ContextRow
        icon={Activity}
        label="Estado general"
        value={snapshot.plantStatus}
        delayMs={160}
      />
      <ContextRow
        icon={Factory}
        label="Operaciones activas"
        value={`${snapshot.activeOperations} en curso`}
        delayMs={200}
      />
      <ContextRow
        icon={Layers3}
        label="Órdenes en proceso"
        value={`${snapshot.ordersInProgress} órdenes`}
        delayMs={240}
      />
    </div>
  );
}
