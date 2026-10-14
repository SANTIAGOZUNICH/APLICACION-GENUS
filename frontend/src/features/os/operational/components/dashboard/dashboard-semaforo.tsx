"use client";

import type { DashboardLight } from "@/lib/dashboard/types";
import { LIGHT_LABELS } from "@/lib/dashboard/semaforo";

const STYLES: Record<DashboardLight, { dot: string; text: string; ring: string }> = {
  verde: { dot: "bg-emerald-400", text: "text-emerald-300", ring: "border-emerald-400/40 bg-emerald-400/10" },
  amarillo: { dot: "bg-amber-400", text: "text-amber-300", ring: "border-amber-400/40 bg-amber-400/10" },
  rojo: { dot: "bg-red-400", text: "text-red-300", ring: "border-red-400/40 bg-red-400/10" },
  sin_objetivo: { dot: "bg-slate-400", text: "text-slate-300", ring: "border-slate-400/30 bg-slate-400/10" },
  sin_datos: { dot: "bg-slate-500", text: "text-slate-300", ring: "border-slate-500/30 bg-slate-500/10" },
  no_aplica: { dot: "bg-slate-500", text: "text-slate-300", ring: "border-slate-500/30 bg-slate-500/10" },
};

/** Semáforo visual: punto de color + texto (el estado nunca depende solo del color). */
export function DashboardSemaforo({ light, label }: { light: DashboardLight; label?: string }) {
  const s = STYLES[light];
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${s.ring} ${s.text}`}
      data-testid="dashboard-semaforo"
      data-light={light}
    >
      <span className={`size-2.5 shrink-0 rounded-full ${s.dot}`} aria-hidden="true" />
      <span className="min-w-0 truncate">{label ?? LIGHT_LABELS[light]}</span>
    </span>
  );
}
