/** Fuente de planificación — no mezclar sheets y native. */

export type PlanningSource = "sheets" | "native";

export function getPlanningSource(): PlanningSource {
  const raw =
    process.env.GENUS_PLANNING_SOURCE ??
    process.env.NEXT_PUBLIC_GENUS_PLANNING_SOURCE ??
    "sheets";
  return raw.trim().toLowerCase() === "native" ? "native" : "sheets";
}

export function getClientPlanningSource(): PlanningSource {
  const raw = process.env.NEXT_PUBLIC_GENUS_PLANNING_SOURCE ?? "sheets";
  return raw.trim().toLowerCase() === "native" ? "native" : "sheets";
}

export function isNativePlanningEnabled(): boolean {
  return getPlanningSource() === "native";
}
