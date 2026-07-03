import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import type { CompletionEvent, OperationalActivityEntry, QualityItem } from "../types";
import { formatQuantity } from "./operational-filters";
import { WORK_TRANSFER } from "./work-transfer-labels";

/** ID estable Calidad ↔ WorkItem — preparado para escritura Sheets. */
export function qualityItemIdForWorkItem(workItemId: string): string {
  return `qc:${workItemId}`;
}

export function completionKindForSector(sector: SectorId): QualityItem["kind"] {
  return sector === "ELABORACION" ? "granel" : "salida";
}

export function workItemToCompletionEvent(
  item: WorkItem,
  payload: { finishedQty: string; observation: string; completedBy: string; completedAt?: string }
): CompletionEvent {
  return {
    id: `ce:${item.id}`,
    workItemId: item.id,
    sourceSector: item.sector,
    kind: completionKindForSector(item.sector),
    completedBy: payload.completedBy,
    completedAt: payload.completedAt ?? new Date().toISOString(),
    finishedQty: payload.finishedQty.trim(),
    observation: payload.observation.trim(),
    product: item.product ?? "—",
    client: item.client,
    line: item.line,
    ownerPerson: item.ownerPerson,
    oeRef: item.oeRef,
    oaRef: item.oaRef,
    loteRef: item.loteRef,
    quantityPlanned: item.quantity,
    unit: item.unit,
    dayLabel: item.dayLabel ?? item.deliveryDate,
  };
}

export function completionEventToQualityItem(event: CompletionEvent): QualityItem {
  const qty =
    event.finishedQty && event.unit
      ? `${event.finishedQty} ${event.unit}`
      : event.finishedQty || formatQuantityFromParts(event.quantityPlanned, event.unit);

  return {
    id: qualityItemIdForWorkItem(event.workItemId),
    kind: event.kind,
    lote: event.loteRef,
    product: event.product,
    client: event.client ?? "—",
    oe: event.oeRef,
    oa: event.oaRef,
    line: event.line,
    quantity: qty,
    dayLabel: event.dayLabel ?? "Hoy",
    status: "pendiente",
    relatedWorkItemId: event.workItemId,
    receivedFrom: event.sourceSector,
    completedAt: event.completedAt,
    completedBy: event.completedBy,
    observation: event.observation || null,
  };
}

function formatQuantityFromParts(quantity: string | null, unit: string | null): string | null {
  if (!quantity) return null;
  return unit ? `${quantity} ${unit}` : quantity;
}

/** Combina seed mock/API con terminados reales de localStorage. */
export function mergeQualityItemsWithCompletions(
  seed: QualityItem[],
  events: CompletionEvent[]
): QualityItem[] {
  const completedWorkIds = new Set(events.map((e) => e.workItemId));
  const kept = seed.filter(
    (item) => !item.relatedWorkItemId || !completedWorkIds.has(item.relatedWorkItemId)
  );
  return [...kept, ...events.map(completionEventToQualityItem)];
}

export function buildOperationalActivityFeed(input: {
  completions: CompletionEvent[];
  decisions: Array<{
    itemId: string;
    status: string;
    decidedAt: string;
    decidedBy?: string;
    observation?: string;
    label?: string;
  }>;
  limit?: number;
}): OperationalActivityEntry[] {
  const entries: OperationalActivityEntry[] = [];

  for (const event of input.completions) {
    const sectorLabel =
      event.sourceSector === "ELABORACION"
        ? `Elaboración${event.ownerPerson ? ` · ${event.ownerPerson}` : ""}`
        : event.line ?? event.sourceSector.replace(/_/g, " ");

    entries.push({
      id: event.id,
      at: event.completedAt,
      actor: event.completedBy,
      type: "transfer",
      message: `${sectorLabel} entregó ${event.product}${event.client ? ` (${event.client})` : ""} · ${WORK_TRANSFER.nextResponsibleQuality}`,
    });
  }

  for (const d of input.decisions) {
    if (d.status !== "aprobado" && d.status !== "rechazado") continue;
    entries.push({
      id: `qd:${d.itemId}:${d.decidedAt}`,
      at: d.decidedAt,
      actor: d.decidedBy ?? "Calidad",
      type: d.status === "aprobado" ? "quality_approve" : "quality_reject",
      message: `${d.status === "aprobado" ? "Aprobado" : "Rechazado"}: ${d.label ?? d.itemId}${d.observation ? ` — ${d.observation}` : ""}`,
    });
  }

  return entries
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, input.limit ?? 12);
}
