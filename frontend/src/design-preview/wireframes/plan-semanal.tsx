"use client";

import { OsShell } from "@/design-preview/components/os-shell";
import { PLAN_SEMANAL_DAYS } from "@/design-preview/mock-data";

/** SEMANAS 2026 — columnas por día, bloques por línea/cliente/producto. */
export function WireframePlanSemanal() {
  return (
    <OsShell
      sectorLabel="Envasado Masivo"
      sectorEmail="emasivo@laboratoriogenus.com.ar"
      title="Plan semanal"
      activeNav="plan-semanal"
    >
      <div className="grid gap-4 lg:grid-cols-5">
        {PLAN_SEMANAL_DAYS.map((day) => (
          <div
            key={day.day}
            className={`flex min-h-[420px] flex-col rounded-[var(--os-radius)] border p-5 ${
              day.today
                ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)]/30"
                : "border-[var(--os-border)] bg-[var(--os-surface)]"
            }`}
          >
            <div className="mb-6">
              <p className="text-sm font-semibold uppercase tracking-wide">{day.day}</p>
              <p className="text-3xl font-light">{day.date}</p>
            </div>

            <div className="flex flex-1 flex-col gap-3">
              {day.lines.map((line) => (
                <div
                  key={`${line.line}-${line.product}`}
                  className="rounded-[var(--os-radius-sm)] border border-[var(--os-border-subtle)] bg-[var(--os-bg)] px-4 py-4"
                >
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--os-teal)]">
                    {line.line}
                  </p>
                  <p className="mt-2 text-sm font-semibold uppercase">{line.client}</p>
                  <p className="mt-1 text-sm">{line.product}</p>
                  <p className="mt-2 text-lg font-light tabular-nums">{line.qty}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </OsShell>
  );
}
