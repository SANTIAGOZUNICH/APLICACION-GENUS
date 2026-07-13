import { SECTOR_PERSONNEL } from "@/features/os/operational/lib/sector-personnel";
import type { DomainWorkItem } from "@/lib/domain/work-item/domain-work-item";
import type { WorkItem, WorkItemSource } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";

function mapEstadoToStatus(estado: string | null): WorkItem["status"] {
  if (!estado?.trim()) return "pendiente";
  const n = estado.trim().toLowerCase();
  if (n.includes("entregado") || n.includes("aprobado") || n.includes("completo")) {
    return "completo";
  }
  if (n.includes("revision") || n.includes("revisión")) return "revision";
  if (n.includes("bloqueado")) return "bloqueado";
  if (n.includes("curso") || n.includes("proceso")) return "en_curso";
  return "pendiente";
}

function primarySource(item: DomainWorkItem): WorkItemSource {
  if (item.enrichmentSources.includes("semanas_2026")) return "semanas_2026";
  if (item.enrichmentSources.includes("pedidos_2026")) return "pedidos_2026";
  if (item.enrichmentSources.includes("asignacion_lotes_2026")) {
    return "asignacion_lotes_2026";
  }
  return "semanas_2026";
}

function resolveOwnerPerson(item: DomainWorkItem): string | null {
  if (item.branchOwner) return item.branchOwner;
  if (item.responsable) return item.responsable;
  if (item.sector === "ELABORACION") return null;
  return null;
}

/** Proyecta entidad de dominio → WorkItem API (sin acoplar a Sheets). */
export function projectDomainWorkItem(item: DomainWorkItem): WorkItem | null {
  let sector = item.sector ?? item.ownerSector;
  if (
    !sector &&
    item.enrichmentSources.includes("asignacion_lotes_2026") &&
    item.loteRef
  ) {
    sector = "CALIDAD";
  }
  if (!sector) return null;

  const client = item.client ?? item.plannedClient;
  const product = item.product ?? item.plannedProduct;
  const quantity = item.quantity ?? item.plannedQuantity;

  if (!client && !product && !item.op && !item.loteRef) return null;

  const source = primarySource(item);
  const fileId =
    item.sourceFileIds[source] ??
    item.sourceFileIds.semanas_2026 ??
    item.sourceFileIds.pedidos_2026 ??
    "unknown";

  const originStage =
    item.originStage ??
    (sector === "ELABORACION"
      ? "ELABORACION"
      : sector === "ENVASADO_MASIVO" || sector === "ENVASADO_PREMIUM"
        ? "ACONDICIONAMIENTO"
        : sector === "CALIDAD"
          ? "CALIDAD"
          : "PLANIFICACION");

  return {
    id: item.internalId,
    sector,
    ownerSector: item.ownerSector ?? sector,
    ownerPerson: resolveOwnerPerson(item),
    source,
    sourceFileId: fileId,
    sourceSheet: item.sourceRanges[source]?.split("!")[0] ?? null,
    sourceRange: item.sourceRanges[source] ?? null,
    originStage,
    date: item.date,
    dayLabel: item.dayLabel,
    weekLabel: item.weekLabel,
    client,
    product,
    quantity,
    unit: item.unit,
    line: item.line,
    lineExpectedInSheet: item.lineExpectedInSheet,
    deliveryDate: item.deliveryDate,
    status: mapEstadoToStatus(item.estado ?? item.estadoCalidad),
    priority: item.priority,
    pedidoRef: item.op,
    oeRef: item.oeRef,
    oaRef: item.oaRef,
    loteRef: item.loteRef,
    notes: item.notes ?? item.observacionCalidad,
    actionLabel: originStage === "ELABORACION" ? "Abrir OE" : "Abrir trabajo",
    href: item.oeRef ? `/oe/${encodeURIComponent(item.oeRef)}` : null,
    confidence: item.confidence,
    createdFrom: `Genus WorkItem · ${item.enrichmentSources.join(" + ")}`,
    generatedEntities: [],
    dependsOn: null,
    blockedBy: null,
    unblocks: null,
  };
}

export function projectDomainWorkItems(items: DomainWorkItem[]): WorkItem[] {
  return items
    .map(projectDomainWorkItem)
    .filter((item): item is WorkItem => item !== null);
}

export function projectQualityItemsFromDomain(items: DomainWorkItem[]) {
  return items
    .filter((item) => item.loteRef && (item.sector === "CALIDAD" || item.oeRef || item.oaRef))
    .map((item) => ({
      id: `quality:${item.internalId}`,
      kind: item.oaRef ? ("salida" as const) : ("granel" as const),
      lote: item.loteRef,
      product: item.product ?? item.plannedProduct ?? "—",
      client: item.client ?? item.plannedClient ?? "—",
      oe: item.oeRef,
      oa: item.oaRef,
      line: item.line,
      quantity: item.quantity ?? item.plannedQuantity,
      dayLabel: item.dayLabel ?? item.weekLabel ?? "—",
      status: item.rl?.trim() ? ("aprobado" as const) : ("pendiente" as const),
      relatedWorkItemId: item.internalId,
    }));
}

export function defaultSectorLead(sector: SectorId): string | null {
  switch (sector) {
    case "ELABORACION":
      return SECTOR_PERSONNEL.ELABORACION_ENCARGADO;
    default:
      return null;
  }
}
