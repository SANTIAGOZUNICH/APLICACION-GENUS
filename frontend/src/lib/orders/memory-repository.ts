import { randomUUID } from "node:crypto";
import type { OrdersRepository } from "@/lib/orders/repository";
import { seedTemplateRecords } from "@/lib/orders/seed-templates";
import type {
  ListOrdersFilters,
  OperationalOrderRecord,
  OrderAuditEventRecord,
  OrderDocType,
  OrderTemplateRecord,
  OrderVersionRecord,
  OsNotificationRecord,
  TemplateChangeProposalRecord,
} from "@/lib/orders/types";
import { COMPLETE_STATUSES, PENDING_STATUSES } from "@/lib/orders/types";

function nowIso(): string {
  return new Date().toISOString();
}

function matchesSearch(order: OperationalOrderRecord, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    order.orderNumber.toLowerCase().includes(q) ||
    order.product.toLowerCase().includes(q) ||
    order.code.toLowerCase().includes(q) ||
    order.client.toLowerCase().includes(q) ||
    order.lot.toLowerCase().includes(q) ||
    order.status.toLowerCase().includes(q) ||
    order.assignedSector.toLowerCase().includes(q) ||
    order.createdAt.toLowerCase().includes(q)
  );
}

/** Repositorio en memoria — unit tests y fallback local de desarrollo sin Neon. */
export class MemoryOrdersRepository implements OrdersRepository {
  templates = new Map<string, OrderTemplateRecord>();
  orders = new Map<string, OperationalOrderRecord>();
  versions: OrderVersionRecord[] = [];
  proposals = new Map<string, TemplateChangeProposalRecord>();
  audits: OrderAuditEventRecord[] = [];
  notifications: OsNotificationRecord[] = [];
  sequences = new Map<string, number>();

  constructor(seed = true) {
    if (seed) {
      for (const t of seedTemplateRecords()) {
        this.templates.set(t.id, structuredClone(t));
      }
    }
  }

  async ensureSeed(): Promise<void> {
    for (const t of seedTemplateRecords()) {
      const hasProduct = [...this.templates.values()].some(
        (x) => x.productId === t.productId && x.type === t.type && x.version === t.version
      );
      if (!hasProduct && !this.templates.has(t.id)) {
        this.templates.set(t.id, structuredClone(t));
      }
    }
  }

  async listTemplates(type?: OrderDocType): Promise<OrderTemplateRecord[]> {
    let list = [...this.templates.values()];
    if (type) list = list.filter((t) => t.type === type);
    return list
      .filter((t) => t.status === "VIGENTE")
      .sort((a, b) => a.productName.localeCompare(b.productName))
      .map((t) => structuredClone(t));
  }

  async listAllTemplates(type?: OrderDocType): Promise<OrderTemplateRecord[]> {
    let list = [...this.templates.values()];
    if (type) list = list.filter((t) => t.type === type);
    return list
      .sort(
        (a, b) =>
          a.productName.localeCompare(b.productName) || b.version - a.version
      )
      .map((t) => structuredClone(t));
  }

  async listTemplateHistory(
    productId: string,
    type: OrderDocType
  ): Promise<OrderTemplateRecord[]> {
    return [...this.templates.values()]
      .filter((t) => t.productId === productId && t.type === type)
      .sort((a, b) => b.version - a.version)
      .map((t) => structuredClone(t));
  }

  async getTemplate(id: string): Promise<OrderTemplateRecord | null> {
    const t = this.templates.get(id);
    return t ? structuredClone(t) : null;
  }

  async getVigenteTemplate(
    productId: string,
    type: OrderDocType
  ): Promise<OrderTemplateRecord | null> {
    const list = [...this.templates.values()].filter(
      (t) => t.productId === productId && t.type === type && t.status === "VIGENTE"
    );
    list.sort((a, b) => b.version - a.version);
    return list[0] ? structuredClone(list[0]) : null;
  }

  async insertTemplate(template: OrderTemplateRecord): Promise<OrderTemplateRecord> {
    this.templates.set(template.id, structuredClone(template));
    return structuredClone(template);
  }

  async markTemplateObsolete(id: string): Promise<void> {
    const t = this.templates.get(id);
    if (t) {
      t.status = "OBSOLETA";
      t.updatedAt = nowIso();
    }
  }

  async updateTemplateContent(
    id: string,
    patch: Partial<
      Pick<
        OrderTemplateRecord,
        "content" | "productName" | "productCode" | "brandClient" | "changeReason" | "updatedBy"
      >
    >
  ): Promise<OrderTemplateRecord | null> {
    const t = this.templates.get(id);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: nowIso() });
    return structuredClone(t);
  }

  async nextOrderNumber(type: OrderDocType, year: number): Promise<string> {
    const key = `${type}:${year}`;
    const next = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, next);
    return `${type}-${year}-${String(next).padStart(6, "0")}`;
  }

  async insertOrder(order: OperationalOrderRecord): Promise<OperationalOrderRecord> {
    this.orders.set(order.id, structuredClone(order));
    return structuredClone(order);
  }

  async getOrder(id: string): Promise<OperationalOrderRecord | null> {
    const o = this.orders.get(id);
    return o ? structuredClone(o) : null;
  }

  async deleteOrder(id: string): Promise<boolean> {
    const existed = this.orders.delete(id);
    this.versions = this.versions.filter((v) => v.orderId !== id);
    return existed;
  }

  async listOrders(filters: ListOrdersFilters): Promise<{
    items: OperationalOrderRecord[];
    total: number;
    pendingCount: number;
    completeCount: number;
  }> {
    let list = [...this.orders.values()];
    if (filters.type) list = list.filter((o) => o.type === filters.type);
    const pendingCount = list.filter((o) => PENDING_STATUSES.includes(o.status)).length;
    const completeCount = list.filter((o) => COMPLETE_STATUSES.includes(o.status)).length;

    if (filters.tab === "pendientes") {
      list = list.filter((o) => PENDING_STATUSES.includes(o.status));
    } else if (filters.tab === "completas") {
      list = list.filter((o) => COMPLETE_STATUSES.includes(o.status));
    }
    if (filters.status) list = list.filter((o) => o.status === filters.status);
    if (filters.assignedSector) {
      list = list.filter((o) => o.assignedSector === filters.assignedSector);
    }
    if (filters.unassigned) {
      list = list.filter((o) => o.assignedSector === "SIN_ASIGNAR");
    }
    if (filters.emptyProduct) list = list.filter((o) => !o.product.trim());
    if (filters.emptyClient) list = list.filter((o) => !o.client.trim());
    if (filters.emptyLot) list = list.filter((o) => !o.lot.trim());
    if (filters.createdBy) {
      list = list.filter((o) => o.createdBy === filters.createdBy);
    }
    if (filters.emptyDraft) {
      list = list.filter(
        (o) =>
          o.status === "BORRADOR" &&
          !o.product.trim() &&
          !o.client.trim() &&
          !o.code.trim() &&
          !o.lot.trim()
      );
    }
    if (filters.product) {
      const p = filters.product.toLowerCase();
      list = list.filter((o) => o.product.toLowerCase().includes(p));
    }
    if (filters.client) {
      const c = filters.client.toLowerCase();
      list = list.filter((o) => o.client.toLowerCase().includes(c));
    }
    if (filters.search) list = list.filter((o) => matchesSearch(o, filters.search!));
    if (filters.year) {
      list = list.filter((o) => new Date(o.createdAt).getFullYear() === filters.year);
    }
    if (filters.month) {
      list = list.filter((o) => new Date(o.createdAt).getMonth() + 1 === filters.month);
    }
    if (filters.dateFrom) {
      list = list.filter((o) => o.createdAt.slice(0, 10) >= filters.dateFrom!);
    }
    if (filters.dateTo) {
      list = list.filter((o) => o.createdAt.slice(0, 10) <= filters.dateTo!);
    }

    const sort = filters.sort ?? "fecha_desc";
    list.sort((a, b) => {
      switch (sort) {
        case "fecha_asc":
          return a.createdAt.localeCompare(b.createdAt);
        case "producto":
          return a.product.localeCompare(b.product);
        case "numero":
          return a.orderNumber.localeCompare(b.orderNumber);
        case "entrega_desc":
          return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
        case "updated_desc":
          return b.updatedAt.localeCompare(a.updatedAt);
        case "fecha_desc":
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });

    const total = list.length;
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize).map((o) => structuredClone(o));
    return { items, total, pendingCount, completeCount };
  }

  async updateOrderOptimistic(
    id: string,
    expectedVersion: number,
    patch: Partial<OperationalOrderRecord>
  ): Promise<OperationalOrderRecord | null> {
    const current = this.orders.get(id);
    if (!current) return null;
    if (current.version !== expectedVersion) return null;
    const next: OperationalOrderRecord = {
      ...current,
      ...patch,
      id: current.id,
      version: current.version + 1,
      updatedAt: nowIso(),
    };
    this.orders.set(id, next);
    return structuredClone(next);
  }

  async insertOrderVersion(version: OrderVersionRecord): Promise<OrderVersionRecord> {
    this.versions.push(structuredClone(version));
    return structuredClone(version);
  }

  async listOrderVersions(orderId: string): Promise<OrderVersionRecord[]> {
    return this.versions
      .filter((v) => v.orderId === orderId)
      .sort((a, b) => b.version - a.version)
      .map((v) => structuredClone(v));
  }

  async insertProposal(
    proposal: TemplateChangeProposalRecord
  ): Promise<TemplateChangeProposalRecord> {
    this.proposals.set(proposal.id, structuredClone(proposal));
    return structuredClone(proposal);
  }

  async getProposal(id: string): Promise<TemplateChangeProposalRecord | null> {
    const p = this.proposals.get(id);
    return p ? structuredClone(p) : null;
  }

  async updateProposal(
    id: string,
    patch: Partial<TemplateChangeProposalRecord>
  ): Promise<TemplateChangeProposalRecord | null> {
    const current = this.proposals.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    this.proposals.set(id, next);
    return structuredClone(next);
  }

  async listProposals(status?: string): Promise<TemplateChangeProposalRecord[]> {
    let list = [...this.proposals.values()];
    if (status) list = list.filter((p) => p.status === status);
    return list
      .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt))
      .map((p) => structuredClone(p));
  }

  async appendAudit(
    event: Omit<OrderAuditEventRecord, "id" | "timestamp"> & { timestamp?: string }
  ): Promise<OrderAuditEventRecord> {
    const row: OrderAuditEventRecord = {
      id: randomUUID(),
      orderId: event.orderId,
      eventType: event.eventType,
      actor: event.actor,
      actorSector: event.actorSector,
      metadata: event.metadata,
      timestamp: event.timestamp ?? nowIso(),
    };
    this.audits.push(row);
    return structuredClone(row);
  }

  async insertNotification(
    notification: OsNotificationRecord
  ): Promise<OsNotificationRecord> {
    this.notifications.unshift(structuredClone(notification));
    return structuredClone(notification);
  }

  async listNotificationsForSector(
    sector: string,
    actorEmail: string
  ): Promise<OsNotificationRecord[]> {
    return this.notifications
      .filter(
        (n) =>
          n.sectors.includes(sector as never) && !n.dismissedBy.includes(actorEmail)
      )
      .map((n) => structuredClone(n));
  }

  async markNotificationRead(id: string, actorEmail: string): Promise<void> {
    const n = this.notifications.find((x) => x.id === id);
    if (n && !n.readBy.includes(actorEmail)) n.readBy.push(actorEmail);
  }

  async dismissNotification(id: string, actorEmail: string): Promise<void> {
    const n = this.notifications.find((x) => x.id === id);
    if (n && !n.dismissedBy.includes(actorEmail)) n.dismissedBy.push(actorEmail);
  }
}
