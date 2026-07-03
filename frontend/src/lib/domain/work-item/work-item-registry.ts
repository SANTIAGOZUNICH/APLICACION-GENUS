import type { DomainWorkItem } from "@/lib/domain/work-item/domain-work-item";

function normalizeIndexText(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function clientProductIndexKey(
  client: string | null | undefined,
  product: string | null | undefined
): string {
  return `${normalizeIndexText(client)}::${normalizeIndexText(product)}`;
}

/**
 * Registro de WorkItems de dominio.
 * Solo almacena, indexa y actualiza — sin parsear, matchear ni resolver conflictos.
 */
export class WorkItemRegistry {
  private readonly items = new Map<string, DomainWorkItem>();
  private readonly byOp = new Map<string, string>();
  private readonly byLote = new Map<string, string>();
  private readonly byClientProduct = new Map<string, string[]>();

  getById(internalId: string): DomainWorkItem | undefined {
    return this.items.get(internalId);
  }

  getByOp(op: string): DomainWorkItem | undefined {
    const id = this.byOp.get(op.trim());
    return id ? this.items.get(id) : undefined;
  }

  getByLote(loteRef: string): DomainWorkItem | undefined {
    const id = this.byLote.get(loteRef.trim().toUpperCase());
    return id ? this.items.get(id) : undefined;
  }

  getIdsByClientProduct(key: string): readonly string[] {
    return this.byClientProduct.get(key) ?? [];
  }

  list(): DomainWorkItem[] {
    return [...this.items.values()];
  }

  /** Inserta o reemplaza un WorkItem completo y reconstruye índices. */
  upsert(item: DomainWorkItem): void {
    this.items.set(item.internalId, item);
    this.indexItem(item);
  }

  /** Actualiza campos de un WorkItem existente y refresca índices. */
  update(internalId: string, patch: Partial<DomainWorkItem>): DomainWorkItem | undefined {
    const current = this.items.get(internalId);
    if (!current) return undefined;

    const next: DomainWorkItem = { ...current, ...patch, internalId: current.internalId };
    this.upsert(next);
    return next;
  }

  private indexItem(item: DomainWorkItem): void {
    if (item.op?.trim()) {
      this.byOp.set(item.op.trim(), item.internalId);
    }

    if (item.loteRef?.trim()) {
      this.byLote.set(item.loteRef.trim().toUpperCase(), item.internalId);
    }

    const key = clientProductIndexKey(
      item.client ?? item.plannedClient,
      item.product ?? item.plannedProduct
    );
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
