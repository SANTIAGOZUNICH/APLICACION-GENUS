import "server-only";

import type { SectorId } from "@/types/operational/sector";
import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";
import type {
  CompletionEvent,
  QualityDecisionRecord,
  QualityDecisionStatus,
  QualityItem,
} from "@/features/os/operational/types";
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
