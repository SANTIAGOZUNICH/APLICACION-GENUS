import { clientProductIndexKey } from "@/lib/domain/work-item/work-item-registry";
import type { WorkItemRegistry } from "@/lib/domain/work-item/work-item-registry";
import type { DomainWorkItem } from "@/lib/domain/work-item/domain-work-item";

export interface WorkItemMatchCriteria {
  internalId?: string;
  op?: string | null;
  loteRef?: string | null;
  client?: string | null;
  product?: string | null;
}

/**
 * Resuelve WorkItems existentes por clave de matching.
 * Prioridad: OP → Lote → internalId → Cliente+Producto (solo si hay match único).
 */
export class WorkItemResolver {
  resolve(registry: WorkItemRegistry, criteria: WorkItemMatchCriteria): DomainWorkItem | null {
    if (criteria.internalId) {
      const byId = registry.getById(criteria.internalId);
      if (byId) return byId;
    }

    const op = criteria.op?.trim();
    if (op) {
      const byOp = registry.getByOp(op);
      if (byOp) return byOp;
    }

    const lote = criteria.loteRef?.trim().toUpperCase();
    if (lote) {
      const byLote = registry.getByLote(lote);
      if (byLote) return byLote;
    }

    const key = clientProductIndexKey(criteria.client, criteria.product);
    if (key !== "::") {
      const ids = registry.getIdsByClientProduct(key);
      if (ids.length === 1) {
        return registry.getById(ids[0]) ?? null;
      }
    }

    return null;
  }
}

export const workItemResolver = new WorkItemResolver();
