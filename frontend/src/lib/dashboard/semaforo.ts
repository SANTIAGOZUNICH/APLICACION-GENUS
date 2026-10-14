/**
 * Semáforo de los indicadores del Dashboard — regla EXPLÍCITA y documentada.
 * No existen objetivos por defecto: sin objetivo cargado el estado es «Sin objetivo definido» (gris).
 *
 *  direction 'min' (mejor cuanto más alto):
 *     verde     resultado >= objetivo                       → «Cumple»
 *     amarillo  resultado >= objetivo × 0,90 (hasta 10 %)   → «Atención»
 *     rojo      resultado <  objetivo × 0,90                → «Crítico»
 *  direction 'max' (mejor cuanto más bajo):
 *     verde     resultado <= objetivo                       → «Cumple»
 *     amarillo  resultado <= objetivo × 1,10 (hasta 10 %)   → «Atención»
 *     rojo      resultado >  objetivo × 1,10                → «Crítico»
 *  El 10 % es relativo al objetivo. Con objetivo 0 el margen es 0 (solo verde o rojo).
 */
import type { DashboardLight, DashboardTarget, DashboardUnit } from "./types";

export const SEMAFORO_TOLERANCE = 0.1;

export const LIGHT_LABELS: Record<DashboardLight, string> = {
  verde: "Cumple",
  amarillo: "Atención",
  rojo: "Crítico",
  sin_objetivo: "Sin objetivo definido",
  sin_datos: "Sin datos suficientes",
  no_aplica: "No aplica a este período",
};

export function evaluateLight(
  result: number | null,
  target: Pick<DashboardTarget, "targetValue" | "direction"> | null
): DashboardLight {
  if (result == null || !Number.isFinite(result)) return "sin_datos";
  if (!target) return "sin_objetivo";
  const t = target.targetValue;
  if (!Number.isFinite(t)) return "sin_objetivo";
  if (target.direction === "min") {
    if (result >= t) return "verde";
    if (result >= t * (1 - SEMAFORO_TOLERANCE)) return "amarillo";
    return "rojo";
  }
  if (result <= t) return "verde";
  if (result <= t * (1 + SEMAFORO_TOLERANCE)) return "amarillo";
  return "rojo";
}

export type TargetInputError = string;

/** Valida un objetivo antes de guardarlo. Devuelve el motivo de rechazo o null. */
export function validateTargetInput(input: {
  value: unknown;
  direction: unknown;
  unit: DashboardUnit;
}): TargetInputError | null {
  if (input.direction !== "min" && input.direction !== "max") return "La dirección debe ser «min» o «max».";
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) return "El objetivo debe ser un número.";
  if (input.value < 0) return "El objetivo no puede ser negativo.";
  if (input.unit === "percent" && input.value > 100) return "Un objetivo en % no puede superar 100.";
  if (input.unit === "days" && input.value > 3650) return "El objetivo en días es demasiado grande.";
  return null;
}
