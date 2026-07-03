/** Contexto operativo simulado para panel de login — UI only, sin backend. */

export type PlantShift = "Mañana" | "Tarde" | "Noche";

export interface PlantContextSnapshot {
  dateLabel: string;
  timeLabel: string;
  shift: PlantShift;
  plantStatus: "Operativa" | "Transición";
  activeOperations: number;
  ordersInProgress: number;
  activeSectors: number;
}

const SHIFT_RANGES = [
  { start: 6, end: 14, label: "Mañana" as const },
  { start: 14, end: 22, label: "Tarde" as const },
  { start: 22, end: 6, label: "Noche" as const },
];

export function resolveShift(hour: number): PlantShift {
  for (const range of SHIFT_RANGES) {
    if (range.start < range.end) {
      if (hour >= range.start && hour < range.end) return range.label;
    } else if (hour >= range.start || hour < range.end) {
      return range.label;
    }
  }
  return "Noche";
}

export function formatPlantDate(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatPlantTime(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Valores estáticos de demostración — reemplazar por telemetría real en fases posteriores. */
export function buildPlantContextSnapshot(now = new Date()): PlantContextSnapshot {
  const hour = now.getHours();
  const shift = resolveShift(hour);

  return {
    dateLabel: formatPlantDate(now),
    timeLabel: formatPlantTime(now),
    shift,
    plantStatus: hour >= 5 && hour < 23 ? "Operativa" : "Transición",
    activeOperations: shift === "Noche" ? 4 : 12,
    ordersInProgress: shift === "Mañana" ? 18 : 11,
    activeSectors: shift === "Tarde" ? 6 : 5,
  };
}
