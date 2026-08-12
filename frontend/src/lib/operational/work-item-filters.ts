import type { WorkItem } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import { personNamesMatch } from "@/lib/operational/display-fields";
import { PRODUCTION_MANAGED_SECTORS } from "@/lib/operational/production-managed-sectors";
import {
  workItemCoversDate,
  workItemOverlapsWeek,
} from "@/lib/operational/work-item-date-range";

/**
 * Sectores que alimentan la vista agregada de Producción (cross-sector):
 * todos los sectores que Producción gestiona (production-managed-sectors.ts)
 * más CALIDAD (Producción también necesita ver "esperando Calidad").
 */
export const PRODUCTION_AGGREGATE_SECTOR_IDS = [
  ...PRODUCTION_MANAGED_SECTORS,
  "CALIDAD",
] as const satisfies readonly SectorId[];

export function filterWorkItemsForProductionView(items: WorkItem[]): WorkItem[] {
  const aggregate = new Set<string>(PRODUCTION_AGGREGATE_SECTOR_IDS);
  return items.filter((item) => aggregate.has(item.sector));
}

export function filterWorkItemsForSector(
  items: WorkItem[],
  sector: WorkItem["sector"]
): WorkItem[] {
  if (sector === "PRODUCCION") {
    return filterWorkItemsForProductionView(items);
  }
  return items.filter((item) => item.sector === sector || item.ownerSector === sector);
}

export function filterWorkItemsForOwnerPerson(
  items: WorkItem[],
  ownerPerson: string | null | undefined
): WorkItem[] {
  if (!ownerPerson?.trim()) return items;
  return items.filter((item) => personNamesMatch(item.ownerPerson, ownerPerson));
}

export function filterWorkItemsForSectorAndPerson(
  items: WorkItem[],
  sector: WorkItem["sector"],
  ownerPerson?: string | null
): WorkItem[] {
  return filterWorkItemsForOwnerPerson(filterWorkItemsForSector(items, sector), ownerPerson);
}

/** Filtra por día cubierto por el rango planificado (plannedDate…plannedDateTo). */
export function filterWorkItemsByDate(items: WorkItem[], date: string): WorkItem[] {
  const target = date.trim();
  if (!target) return items;
  return items.filter((item) => workItemCoversDate(item, target));
}

/**
 * Filtra trabajos que solapan la semana L–V.
 * Incluye weekStart/weekId legacy y rangos plannedDate…plannedDateTo.
 */
export function filterWorkItemsByWeekStart(items: WorkItem[], weekStart: string): WorkItem[] {
  const target = weekStart.trim();
  if (!target) return items;
  return items.filter((item) => workItemOverlapsWeek(item, target));
}

export function partitionMiTrabajoSections(items: WorkItem[]): {
  hoy: WorkItem[];
  semana: WorkItem[];
  pendientes: WorkItem[];
  bloqueados: WorkItem[];
} {
  const hoy: WorkItem[] = [];
  const semana: WorkItem[] = [];
  const pendientes: WorkItem[] = [];
  const bloqueados: WorkItem[] = [];

  for (const item of items) {
    if (item.status === "bloqueado") {
      bloqueados.push(item);
      continue;
    }

    if (item.status === "pendiente") {
      pendientes.push(item);
    }

    if (item.priority === "URGENTE" || item.priority === "HOY") {
      hoy.push(item);
    } else if (item.priority === "ESTA_SEMANA") {
      semana.push(item);
    } else if (item.dayLabel || item.date) {
      semana.push(item);
    }
  }

  return { hoy, semana, pendientes, bloqueados };
}

export function countMiTrabajoSections(items: WorkItem[]) {
  const sections = partitionMiTrabajoSections(items);
  return {
    total: items.length,
    hoy: sections.hoy.length,
    semana: sections.semana.length,
    pendientes: sections.pendientes.length,
    bloqueados: sections.bloqueados.length,
  };
}
