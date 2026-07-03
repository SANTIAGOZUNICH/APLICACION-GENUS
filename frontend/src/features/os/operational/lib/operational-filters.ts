import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";
import type { QualityItem } from "../types";

export function filterWorkItemsByLine(items: WorkItem[], line: string): WorkItem[] {
  const normalized = line.trim().toLowerCase();
  return items.filter((item) => item.line?.trim().toLowerCase() === normalized);
}

export function groupWorkItemsByLine(items: WorkItem[]): Map<string, WorkItem[]> {
  const map = new Map<string, WorkItem[]>();
  for (const item of items) {
    const line = item.line?.trim() || "Sin línea";
    const group = map.get(line) ?? [];
    group.push(item);
    map.set(line, group);
  }
  return map;
}

export function filterQualityByKind(items: QualityItem[], kind: QualityItem["kind"]): QualityItem[] {
  return items.filter((item) => item.kind === kind);
}

export function filterQualityByStatus(
  items: QualityItem[],
  status: QualityItem["status"]
): QualityItem[] {
  return items.filter((item) => item.status === status);
}

export function filterQualityToday(items: QualityItem[], dayLabel = "Hoy"): QualityItem[] {
  return items.filter((item) => item.dayLabel.toLowerCase() === dayLabel.toLowerCase());
}

export function filterWorkItemsPendingElaboracion(items: WorkItem[]): WorkItem[] {
  return items.filter(
    (item) =>
      item.sector === "ELABORACION" &&
      (item.status === "pendiente" || item.status === "en_curso")
  );
}

export function filterWorkItemsPendingEnvasado(items: WorkItem[]): WorkItem[] {
  return items.filter(
    (item) =>
      (item.sector === "ENVASADO_MASIVO" || item.sector === "ENVASADO_PREMIUM") &&
      (item.status === "pendiente" || item.status === "en_curso")
  );
}

export function filterWorkItemsCompletedElaboracion(items: WorkItem[]): WorkItem[] {
  return items.filter(
    (item) => item.sector === "ELABORACION" && item.status === "completo"
  );
}

export function filterWorkItemsCompletedEnvasado(items: WorkItem[]): WorkItem[] {
  return items.filter(
    (item) =>
      (item.sector === "ENVASADO_MASIVO" || item.sector === "ENVASADO_PREMIUM") &&
      item.status === "completo"
  );
}

export function filterQualityReceivedPending(items: QualityItem[]): QualityItem[] {
  return items.filter(
    (item) => item.status === "pendiente" && Boolean(item.receivedFrom && item.completedAt)
  );
}

export function workItemStatusLabel(status: WorkItemStatus): string {
  if (status === "completo") return "Terminado";
  return status.replace(/_/g, " ");
}

export function formatQuantity(item: WorkItem): string {
  if (!item.quantity) return "—";
  return item.unit ? `${item.quantity} ${item.unit}` : item.quantity;
}
