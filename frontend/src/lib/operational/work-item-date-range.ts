import type { WorkItem } from "@/types/operational/work-item";
import { addDaysIso } from "@/lib/operational/operational-calendar";

/** Fin del rango planificado (inclusive). Sin fin → solo plannedDate. */
export function workItemPlannedEnd(item: Pick<WorkItem, "plannedDate" | "plannedDateTo">): string | null {
  const start = item.plannedDate?.trim() || null;
  if (!start) return null;
  const end = item.plannedDateTo?.trim() || null;
  if (end && end < start) return start;
  return end ?? start;
}

/** El trabajo cubre el día ISO (aparece en Semana/Día sin clonar identidad). */
export function workItemCoversDate(
  item: Pick<WorkItem, "plannedDate" | "plannedDateTo">,
  date: string
): boolean {
  const start = item.plannedDate?.trim();
  if (!start) return false;
  const target = date.trim();
  if (!target) return false;
  const end = workItemPlannedEnd(item)!;
  return target >= start && target <= end;
}

/** Solapa L–V de la semana operativa (weekStart = lunes). */
export function workItemOverlapsWeek(
  item: Pick<WorkItem, "plannedDate" | "plannedDateTo" | "weekStart" | "weekId">,
  weekStart: string
): boolean {
  const target = weekStart.trim();
  if (!target) return false;
  if (item.weekStart === target || item.weekId === target) return true;
  const start = item.plannedDate?.trim();
  if (!start) return false;
  const end = workItemPlannedEnd(item)!;
  const weekEnd = addDaysIso(target, 4); // viernes
  return start <= weekEnd && end >= target;
}
