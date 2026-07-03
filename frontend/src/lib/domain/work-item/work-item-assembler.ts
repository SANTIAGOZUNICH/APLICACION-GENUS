import {
  OFFICIAL_ATTRIBUTE_SOURCE,
  type AttributeSource,
} from "@/lib/domain/work-item/attribute-sources";
import {
  createEmptyDomainWorkItem,
  type DomainWorkItem,
} from "@/lib/domain/work-item/domain-work-item";
import type { WorkItemRegistry } from "@/lib/domain/work-item/work-item-registry";
import {
  workItemResolver,
  type WorkItemMatchCriteria,
} from "@/lib/domain/work-item/work-item-resolver";

export type DomainWorkItemPatch = Partial<Omit<DomainWorkItem, "internalId" | "enrichmentSources">> & {
  internalId?: string;
};

export interface EnrichmentMeta {
  fileId?: string;
  range?: string;
}

/**
 * Ensambla enriquecimientos sobre el registry aplicando fuente oficial por atributo.
 * No parsea Sheets — solo orquesta resolver + registry.
 */
export class WorkItemAssembler {
  constructor(private readonly resolver = workItemResolver) {}

  apply(
    registry: WorkItemRegistry,
    criteria: WorkItemMatchCriteria,
    patch: DomainWorkItemPatch,
    source: AttributeSource,
    meta?: EnrichmentMeta
  ): DomainWorkItem {
    const existing = this.resolver.resolve(registry, criteria);

    if (existing) {
      const updated = this.mergePatch(existing, patch, source, meta);
      registry.upsert(updated);
      return updated;
    }

    const internalId =
      patch.internalId ??
      criteria.internalId ??
      `wi:${source}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;

    const created = createEmptyDomainWorkItem(internalId);
    const merged = this.mergePatch(
      {
        ...created,
        op: patch.op ?? criteria.op ?? null,
        loteRef: patch.loteRef ?? criteria.loteRef ?? null,
        client: patch.client ?? criteria.client ?? null,
        product: patch.product ?? criteria.product ?? null,
        plannedClient: patch.plannedClient ?? criteria.client ?? null,
        plannedProduct: patch.plannedProduct ?? criteria.product ?? null,
      },
      patch,
      source,
      meta
    );

    registry.upsert(merged);
    return merged;
  }

  private mergePatch(
    item: DomainWorkItem,
    patch: DomainWorkItemPatch,
    source: AttributeSource,
    meta?: EnrichmentMeta
  ): DomainWorkItem {
    const next: DomainWorkItem = { ...item };

    for (const [field, value] of Object.entries(patch)) {
      if (field === "internalId" || value === undefined) continue;

      const official = OFFICIAL_ATTRIBUTE_SOURCE[field];
      if (official && official !== source) continue;

      (next as unknown as Record<string, unknown>)[field] = value;
    }

    if (!next.enrichmentSources.includes(source)) {
      next.enrichmentSources = [...next.enrichmentSources, source];
    }

    if (meta?.fileId) {
      next.sourceFileIds = { ...next.sourceFileIds, [source]: meta.fileId };
    }
    if (meta?.range) {
      next.sourceRanges = { ...next.sourceRanges, [source]: meta.range };
    }

    next.confidence = this.inferConfidence(next);
    return next;
  }

  private inferConfidence(item: DomainWorkItem): DomainWorkItem["confidence"] {
    if (item.op && item.loteRef && item.client && item.product) return "high";
    if (item.op || item.loteRef || (item.client && item.plannedClient)) return "medium";
    return item.confidence ?? "low";
  }
}

export const workItemAssembler = new WorkItemAssembler();
