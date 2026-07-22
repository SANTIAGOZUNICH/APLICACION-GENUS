import "server-only";

import type { SectorId } from "@/types/operational/sector";
import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";
import type {
  CompletionEvent,
  QualityDecisionRecord,
  QualityDecisionStatus,
  QualityItem,
} from "@/features/os/operational/types";
import type { DeliveryRecord } from "@/features/os/operational/adapters/delivery-repository";
import { operationalEventBus } from "@/lib/live-sync/operational-event-bus";
import type { WorkProgressPayload } from "@/lib/live-sync/types";

const NOTIFY_ON_PROGRESS: SectorId[] = [
  "PRODUCCION",
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "DIRECCION",
];

const NOTIFY_ON_COMPLETION: SectorId[] = [
  "PRODUCCION",
  "CALIDAD",
  "DIRECCION",
];

const NOTIFY_ON_QUALITY: SectorId[] = [
  "PRODUCCION",
  "CALIDAD",
  "DIRECCION",
];

/** Estado operativo autoritativo del servidor — independiente de Google Sheets. */
class ServerOperationalState {
  private progress = new Map<string, WorkProgressPayload>();
  private decisions = new Map<string, QualityDecisionRecord>();
  private completions = new Map<string, CompletionEvent>();
  private deliveries = new Map<string, DeliveryRecord>();
  private revision = 0;

  getRevision(): number {
    return this.revision;
  }

  snapshot() {
    return {
      revision: this.revision,
      progress: Object.fromEntries(this.progress),
      decisions: Object.fromEntries(this.decisions),
      completions: [...this.completions.values()],
      deliveries: [...this.deliveries.values()],
    };
  }

  saveProgress(
    itemId: string,
    payload: {
      finishedQty: string;
      observation: string;
      updatedBy?: string;
      sector?: SectorId;
    }
  ): WorkProgressPayload {
    const record: WorkProgressPayload = {
      itemId,
      finishedQty: payload.finishedQty.trim(),
      observation: payload.observation.trim(),
      status: "en_curso",
      updatedAt: new Date().toISOString(),
      updatedBy: payload.updatedBy,
      sector: payload.sector,
    };
    this.progress.set(itemId, record);
    this.revision += 1;

    operationalEventBus.publish({
      type: "work.progress",
      revision: this.revision,
      at: record.updatedAt,
      itemId,
      sector: payload.sector ?? "ELABORACION",
      status: "en_curso",
      notifySectors: NOTIFY_ON_PROGRESS,
    });

    return record;
  }

  completeWork(
    item: WorkItem,
    payload: { finishedQty: string; observation: string; completedBy: string }
  ): { progress: WorkProgressPayload; completion: CompletionEvent } {
    const completedAt = new Date().toISOString();
    const progress: WorkProgressPayload = {
      itemId: item.id,
      finishedQty: payload.finishedQty.trim(),
      observation: payload.observation.trim(),
      status: "revision",
      updatedAt: completedAt,
      updatedBy: payload.completedBy,
      completedAt,
      sector: item.sector,
    };
    this.progress.set(item.id, progress);

    const completion: CompletionEvent = {
      id: `completion:${item.id}:${completedAt}`,
      workItemId: item.id,
      sourceSector: item.sector,
      kind: item.oaRef ? "salida" : "granel",
      completedBy: payload.completedBy,
      completedAt,
      finishedQty: progress.finishedQty,
      observation: progress.observation,
      product: item.product ?? "—",
      client: item.client,
      line: item.line,
      ownerPerson: item.ownerPerson,
      oeRef: item.oeRef,
      oaRef: item.oaRef,
      loteRef: item.loteRef,
      quantityPlanned: item.quantity,
      unit: item.unit,
      dayLabel: item.dayLabel,
    };
    this.completions.set(item.id, completion);
    this.revision += 1;

    operationalEventBus.publish({
      type: "work.completed",
      revision: this.revision,
      at: completedAt,
      itemId: item.id,
      sourceSector: item.sector,
      notifySectors: NOTIFY_ON_COMPLETION,
      completion,
    });

    return { progress, completion };
  }

  decideQuality(
    itemId: string,
    status: QualityDecisionStatus,
    options?: { decidedBy?: string; observation?: string }
  ): QualityDecisionRecord {
    const record: QualityDecisionRecord = {
      itemId,
      status,
      decidedAt: new Date().toISOString(),
      decidedBy: options?.decidedBy,
      observation: options?.observation?.trim() || undefined,
    };
    this.decisions.set(itemId, record);
    this.revision += 1;

    if (status === "aprobado" || status === "rechazado") {
      operationalEventBus.publish({
        type: "quality.decided",
        revision: this.revision,
        at: record.decidedAt,
        itemId,
        status,
        notifySectors: NOTIFY_ON_QUALITY,
      });
    }

    return record;
  }

  /**
   * Cancela un trabajo en el overlay server-side (solo PRODUCCION — validado en route).
   * No elimina OE/OA ni decisiones de Calidad.
   */
  cancelWork(
    itemId: string,
    options: { cancelledBy: string; reason: string; sector?: SectorId }
  ): WorkProgressPayload {
    const existing = this.progress.get(itemId);
    const record: WorkProgressPayload = {
      itemId,
      finishedQty: existing?.finishedQty ?? "",
      observation: [existing?.observation, `Cancelado: ${options.reason}`]
        .filter(Boolean)
        .join(" · "),
      status: "cancelado",
      updatedAt: new Date().toISOString(),
      updatedBy: options.cancelledBy,
      sector: options.sector ?? existing?.sector,
    };
    this.progress.set(itemId, record);
    this.revision += 1;

    operationalEventBus.publish({
      type: "work.progress",
      revision: this.revision,
      at: record.updatedAt,
      itemId,
      sector: record.sector ?? "PRODUCCION",
      status: "cancelado",
      notifySectors: NOTIFY_ON_PROGRESS,
    });

    return record;
  }

  deliverWork(record: DeliveryRecord): DeliveryRecord {
    const now = new Date().toISOString();
    const existing = [...this.deliveries.values()].find(
      (d) => d.workItemId === record.workItemId && d.status === "ENTREGADO" && !d.annulledAt
    );
    if (existing) {
      return existing;
    }

    const next: DeliveryRecord = {
      ...record,
      status: "ENTREGADO",
      archived: record.archived ?? false,
      updatedAt: record.updatedAt ?? now,
    };
    this.deliveries.set(next.id, next);

    const prevProgress = this.progress.get(next.workItemId);
    this.progress.set(next.workItemId, {
      itemId: next.workItemId,
      finishedQty: prevProgress?.finishedQty ?? "",
      observation: prevProgress?.observation ?? "",
      status: "entregado",
      updatedAt: now,
      updatedBy: next.deliveredBy,
      completedAt: prevProgress?.completedAt ?? now,
      sector: next.sourceSector,
    });

    this.revision += 1;

    operationalEventBus.publish({
      type: "work.progress",
      revision: this.revision,
      at: now,
      itemId: next.workItemId,
      sector: next.sourceSector,
      status: "entregado",
      notifySectors: ["PRODUCCION", "CALIDAD", "DIRECCION", next.sourceSector],
    });

    return next;
  }

  archiveDelivery(id: string, actorName = "Producción"): DeliveryRecord | null {
    const current = this.deliveries.get(id);
    if (!current) return null;
    const now = new Date().toISOString();
    const next: DeliveryRecord = {
      ...current,
      archived: true,
      archivedAt: now,
      archivedBy: actorName,
      updatedAt: now,
    };
    this.deliveries.set(id, next);
    this.revision += 1;
    return next;
  }

  restoreDelivery(id: string): DeliveryRecord | null {
    const current = this.deliveries.get(id);
    if (!current) return null;
    const next: DeliveryRecord = {
      ...current,
      archived: false,
      archivedAt: null,
      archivedBy: null,
      updatedAt: new Date().toISOString(),
    };
    this.deliveries.set(id, next);
    this.revision += 1;
    return next;
  }

  annulDelivery(id: string, reason: string, actorName = "Producción"): DeliveryRecord | null {
    const current = this.deliveries.get(id);
    if (!current) return null;
    if (current.status === "REGISTRO_ELIMINADO") return null;
    if (current.archived) return null;
    if (current.status === "ANULADO") return current;

    const now = new Date().toISOString();
    const next: DeliveryRecord = {
      ...current,
      status: "ANULADO",
      archived: false,
      annulledAt: now,
      annulledBy: actorName,
      annulReason: reason,
      updatedAt: now,
    };
    this.deliveries.set(id, next);

    const prevProgress = this.progress.get(next.workItemId);
    this.progress.set(next.workItemId, {
      itemId: next.workItemId,
      finishedQty: prevProgress?.finishedQty ?? "",
      observation: prevProgress?.observation ?? "",
      status: "revision",
      updatedAt: now,
      updatedBy: actorName,
      completedAt: prevProgress?.completedAt,
      sector: next.sourceSector,
    });

    this.revision += 1;

    operationalEventBus.publish({
      type: "work.progress",
      revision: this.revision,
      at: now,
      itemId: next.workItemId,
      sector: next.sourceSector,
      status: "revision",
      notifySectors: ["PRODUCCION", "CALIDAD", "DIRECCION", next.sourceSector],
    });

    return next;
  }

  deleteDeliveryRecord(
    id: string,
    options?: { reason?: string; actorName?: string }
  ): DeliveryRecord | null {
    const current = this.deliveries.get(id);
    if (!current) return null;
    if (!current.archived && current.status === "ENTREGADO") return null;

    const now = new Date().toISOString();
    const deleted: DeliveryRecord = {
      ...current,
      status: "REGISTRO_ELIMINADO",
      deletedAt: now,
      deletedBy: options?.actorName ?? "Producción",
      deleteReason: options?.reason ?? "Sin motivo",
      updatedAt: now,
    };
    this.deliveries.delete(id);
    this.revision += 1;
    return deleted;
  }

  applyToWorkItems<T extends WorkItem>(items: T[]): T[] {
    return items.map((item) => {
      const saved = this.progress.get(item.id);
      if (!saved) return item;
      return {
        ...item,
        status: (saved.status as WorkItemStatus) ?? item.status,
        finishedQty: saved.finishedQty || item.finishedQty,
        operationalObservation: saved.observation || item.operationalObservation,
      };
    });
  }

  applyToQualityItems(items: QualityItem[]): QualityItem[] {
    return items.map((item) => {
      const decision = this.decisions.get(item.id);
      if (!decision) return item;
      const completion = [...this.completions.values()].find(
        (c) => c.workItemId === item.relatedWorkItemId
      );
      return {
        ...item,
        status: decision.status,
        observation: decision.observation ?? item.observation,
        completedAt: completion?.completedAt ?? item.completedAt,
        completedBy: completion?.completedBy ?? item.completedBy,
      };
    });
  }

  mergeCompletions(items: QualityItem[]): QualityItem[] {
    const byWorkItem = new Map(
      [...this.completions.values()].map((e) => [e.workItemId, e])
    );
    if (byWorkItem.size === 0) return items;

    const existingIds = new Set(items.map((i) => i.relatedWorkItemId));
    const merged = items.map((item) => {
      const event = item.relatedWorkItemId
        ? byWorkItem.get(item.relatedWorkItemId)
        : undefined;
      if (!event) return item;
      return {
        ...item,
        receivedFrom: event.sourceSector,
        completedAt: event.completedAt,
        completedBy: event.completedBy,
        observation: event.observation || item.observation,
      };
    });

    for (const event of this.completions.values()) {
      if (existingIds.has(event.workItemId)) continue;
      merged.push({
        id: `quality:${event.id}`,
        kind: event.kind,
        lote: event.loteRef,
        product: event.product,
        client: event.client ?? "—",
        oe: event.oeRef,
        oa: event.oaRef,
        line: event.line,
        quantity: event.finishedQty || event.quantityPlanned,
        dayLabel: event.dayLabel ?? "—",
        status: "pendiente",
        relatedWorkItemId: event.workItemId,
        receivedFrom: event.sourceSector,
        completedAt: event.completedAt,
        completedBy: event.completedBy,
        observation: event.observation,
      });
    }

    return merged;
  }
}

export const serverOperationalState = new ServerOperationalState();
