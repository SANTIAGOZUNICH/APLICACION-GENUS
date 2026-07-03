import {
  OFFICIAL_ATTRIBUTE_SOURCE,
  type AttributeSource,
} from "@/lib/domain/work-item/attribute-sources";
import {
  createEmptyDomainWorkItem,
  type DomainWorkItem,
} from "@/lib/domain/work-item/domain-work-item";

export type DomainWorkItemPatch = Partial<Omit<DomainWorkItem, "internalId" | "enrichmentSources">> & {
  internalId?: string;
};

function normalizeMatchText(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function clientProductKey(client: string | null | undefined, product: string | null | undefined): string {
  return `${normalizeMatchText(client)}::${normalizeMatchText(product)}`;
}

/** Registro de WorkItems de dominio — independiente de Google Sheets. */
export class WorkItemRegistry {
  private readonly items = new Map<string, DomainWorkItem>();
  private readonly byOp = new Map<string, string>();
  private readonly byLote = new Map<string, string>();
  private readonly byClientProduct = new Map<string, string[]>();

  create(
    patch: DomainWorkItemPatch,
    source: AttributeSource,
    meta?: { fileId?: string; range?: string }
  ): DomainWorkItem {
    const internalId =
      patch.internalId ??
      `wi:${source}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;

    const item = createEmptyDomainWorkItem(internalId);
    this.applyPatch(item, patch, source, meta);
    this.register(item);
    return item;
  }

  enrich(
    match: { internalId?: string; op?: string | null; loteRef?: string | null; client?: string | null; product?: string | null },
    patch: DomainWorkItemPatch,
    source: AttributeSource,
    meta?: { fileId?: string; range?: string }
  ): DomainWorkItem {
    const existing = this.resolve(match);
    if (existing) {
      this.applyPatch(existing, patch, source, meta);
      this.register(existing);
      return existing;
    }

    return this.create(
      {
        ...patch,
        op: patch.op ?? match.op ?? null,
        loteRef: patch.loteRef ?? match.loteRef ?? null,
        client: patch.client ?? match.client ?? null,
        product: patch.product ?? match.product ?? null,
      },
      source,
      meta
    );
  }

  resolve(match: {
    internalId?: string;
    op?: string | null;
    loteRef?: string | null;
    client?: string | null;
    product?: string | null;
  }): DomainWorkItem | null {
    if (match.internalId && this.items.has(match.internalId)) {
      return this.items.get(match.internalId)!;
    }

    const op = match.op?.trim();
    if (op && this.byOp.has(op)) {
      return this.items.get(this.byOp.get(op)!) ?? null;
    }

    const lote = match.loteRef?.trim().toUpperCase();
    if (lote && this.byLote.has(lote)) {
      return this.items.get(this.byLote.get(lote)!) ?? null;
    }

    const key = clientProductKey(match.client, match.product);
    if (key !== "::") {
      const ids = this.byClientProduct.get(key);
      if (ids?.length === 1) {
        return this.items.get(ids[0]) ?? null;
      }
    }

    return null;
  }

  list(): DomainWorkItem[] {
    return [...this.items.values()];
  }

  private applyPatch(
    item: DomainWorkItem,
    patch: DomainWorkItemPatch,
    source: AttributeSource,
    meta?: { fileId?: string; range?: string }
  ): void {
    for (const [field, value] of Object.entries(patch)) {
      if (field === "internalId" || value === undefined) continue;

      const official = OFFICIAL_ATTRIBUTE_SOURCE[field];
      if (official && official !== source) continue;

      (item as unknown as Record<string, unknown>)[field] = value;
    }

    if (!item.enrichmentSources.includes(source)) {
      item.enrichmentSources.push(source);
    }

    if (meta?.fileId) {
      item.sourceFileIds[source] = meta.fileId;
    }
    if (meta?.range) {
      item.sourceRanges[source] = meta.range;
    }

    if (item.op && item.loteRef && item.client && item.product) {
      item.confidence = "high";
    } else if (item.op || item.loteRef || (item.client && item.plannedClient)) {
      item.confidence = "medium";
    }
  }

  private register(item: DomainWorkItem): void {
    this.items.set(item.internalId, item);

    if (item.op?.trim()) {
      this.byOp.set(item.op.trim(), item.internalId);
    }

    if (item.loteRef?.trim()) {
      this.byLote.set(item.loteRef.trim().toUpperCase(), item.internalId);
    }

    const displayClient = item.client ?? item.plannedClient;
    const displayProduct = item.product ?? item.plannedProduct;
    const key = clientProductKey(displayClient, displayProduct);
    if (key !== "::") {
      const list = this.byClientProduct.get(key) ?? [];
      if (!list.includes(item.internalId)) {
        list.push(item.internalId);
        this.byClientProduct.set(key, list);
      }
    }
  }
}

export function createWorkItemRegistry(): WorkItemRegistry {
  return new WorkItemRegistry();
}
