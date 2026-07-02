import type { WorkItem } from "@/types/operational/work-item";
import { personNamesMatch } from "@/lib/operational/display-fields";

export function filterWorkItemsForSector(
  items: WorkItem[],
  sector: WorkItem["sector"]
): WorkItem[] {
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
