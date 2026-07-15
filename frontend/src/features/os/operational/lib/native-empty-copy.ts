import type { SectorId } from "@/types/operational/sector";

/** Copy operativo cuando GENUS_PLANNING_SOURCE=native — nunca mencionar Sheets. */

export function nativeEmptyPlanMessage(options: {
  date?: string | null;
  weekStart?: string | null;
  sector?: SectorId | null;
}): string {
  if (options.date) return "Hoy no hay trabajos publicados.";
  if (options.weekStart) return "Esta semana no hay trabajos publicados.";
  if (options.sector === "PRODUCCION" || options.sector === "DIRECCION") {
    return "Todavía no hay una planificación publicada.";
  }
  return "Producción todavía no publicó una planificación.";
}

export function nativeDayEmptyMessage(ramaOrLine?: string | null): string {
  if (ramaOrLine?.trim()) {
    return `Hoy no hay trabajos publicados para ${ramaOrLine.trim()}.`;
  }
  return "Hoy no hay trabajos publicados.";
}
