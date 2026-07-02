"use client";

import { OsShell } from "@/design-preview/components/os-shell";
import { SectionLabel } from "@/design-preview/components/section-label";
import { PLAN_SEMANAL_DAYS, PRODUCCION_PROBLEMS, PRODUCCION_SECTORS } from "@/design-preview/mock-data";

function SectorBar({
  label,
  fill,
  delayed,
  stopped,
}: {
  label: string;
  fill: number;
  delayed?: boolean;
  stopped?: boolean;
}) {
  const empty = 6 - fill;
  return (
    <div className="flex items-center gap-4">
      <span className="w-28 text-sm font-medium">{label}</span>
      <span className="font-mono text-xl tracking-tight text-[var(--os-teal)]">
        {"█".repeat(fill)}
        <span className="text-[var(--os-border)]">{"░".repeat(empty)}</span>
      </span>
      {delayed && (
        <span className="text-xs font-medium text-amber-700">Atrasado</span>
      )}
      {stopped && (
        <span className="text-xs font-medium text-red-600">Detenida</span>
      )}
    </div>
  );
}

/** Centro de control — problemas primero, no listas operativas. */
export function WireframeProduccion() {
  return (
    <OsShell
      sectorLabel="Producción"
      sectorEmail="produccion@laboratoriogenus.com.ar"
      title="Control"
      showRestricted
      activeNav="produccion"
    >
      <SectionLabel>Problemas</SectionLabel>
      <ul className="mb-[var(--os-space-section)] space-y-2">
        {PRODUCCION_PROBLEMS.map((p) => (
          <li
            key={p.text}
            className={`rounded-[var(--os-radius-sm)] px-4 py-3 text-sm font-medium ${
              p.type === "urgente"
                ? "bg-red-50 text-red-900"
                : p.type === "accion"
                  ? "bg-[var(--os-teal-soft)] text-[var(--os-teal)]"
                  : "bg-[var(--os-surface)] border border-[var(--os-border)]"
            }`}
          >
            {p.text}
          </li>
        ))}
      </ul>

      <SectionLabel>Hoy</SectionLabel>
      <div className="mb-[var(--os-space-section)] flex flex-col gap-4">
        {PRODUCCION_SECTORS.map((s) => (
          <SectorBar
            key={s.id}
            label={s.label}
            fill={s.fill}
            delayed={s.delayed}
            stopped={s.stopped}
          />
        ))}
      </div>

      <SectionLabel>Plan semanal</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-5">
        {PLAN_SEMANAL_DAYS.map((day) => (
          <div
            key={day.day}
            className={`rounded-[var(--os-radius-sm)] border p-3 ${
              day.today ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)]/40" : "border-[var(--os-border)]"
            }`}
          >
            <p className="text-xs font-semibold">{day.day}</p>
            <p className="text-lg font-bold">{day.date}</p>
            <ul className="mt-2 space-y-1 text-[11px] text-[var(--os-text-muted)]">
              {day.lines.map((l) => (
                <li key={`${l.line}-${l.product}`}>
                  {l.line} · {l.client}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </OsShell>
  );
}
