import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  operationalOrders,
  orderAuditEvents,
  orderNumberSequences,
  orderTemplates,
  orderVersions,
  osNotifications,
  templateChangeProposals,
} from "@/lib/db/schema";
import type { OrdersRepository } from "@/lib/orders/repository";
import { seedTemplateRecords } from "@/lib/orders/seed-templates";
import type {
  ListOrdersFilters,
  OperationalOrderRecord,
  OrderAuditEventRecord,
  OrderContent,
  OrderDocType,
  OrderTemplateRecord,
  OrderVersionRecord,
  OsNotificationRecord,
  TemplateChangeProposalRecord,
} from "@/lib/orders/types";
import { COMPLETE_STATUSES, PENDING_STATUSES } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function mapTemplate(row: typeof orderTemplates.$inferSelect): OrderTemplateRecord {
  const changeReason = row.changeReason;
  const sourceMatch = changeReason?.match(/origen:\s*(.+)$/i);
  return {
    id: row.id,
    type: row.type,
    productId: row.productId,
    productName: row.productName,
    productCode: row.productCode,
    brandClient: row.brandClient,
    version: row.version,
    status: row.status,
    content: row.content as OrderContent,
    changeReason,
    sourceFile: sourceMatch?.[1]?.trim() ?? null,
    previousVersionId: row.previousVersionId,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

function mapOrder(row: typeof operationalOrders.$inferSelect): OperationalOrderRecord {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    type: row.type,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    templateSnapshot: row.templateSnapshot as OrderContent,
    product: row.product,
    client: row.client,
    code: row.code,
    lot: row.lot,
    assignedSector: row.assignedSector as SectorId,
    status: row.status,
    formData: row.formData as OrderContent,
    completionPercentage: row.completionPercentage,
    revision: row.revision,
    version: row.version,
    linkedWorkItemId: row.linkedWorkItemId,
    reviewedAt: toIso(row.reviewedAt),
    reviewedBy: row.reviewedBy,
    completedAt: toIso(row.completedAt),
    completedBy: row.completedBy,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

export class DrizzleOrdersRepository implements OrdersRepository {
  private seeded = false;

  /**
   * Seed idempotente: inserta plantillas iniciales por (productId, type, version=1).
   * No duplica si ya existen. Usa UUIDs fijos válidos.
   */
  async ensureSeed(): Promise<void> {
    if (this.seeded) return;
    const db = getDb();
    for (const t of seedTemplateRecords()) {
      const existing = await db
        .select({ id: orderTemplates.id })
        .from(orderTemplates)
        .where(
          and(
            eq(orderTemplates.productId, t.productId),
            eq(orderTemplates.type, t.type),
            eq(orderTemplates.version, t.version)
          )
        )
        .limit(1);
      if (existing.length > 0) continue;
      try {
        await db.insert(orderTemplates).values({
          id: t.id,
          type: t.type,
          productId: t.productId,
          productName: t.productName,
          productCode: t.productCode,
          brandClient: t.brandClient,
          version: t.version,
          status: t.status,
          content: t.content,
          changeReason: t.changeReason,
          previousVersionId: t.previousVersionId,
          createdBy: t.createdBy,
          updatedBy: t.updatedBy,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        });
      } catch (err) {
        // Carrera concurrente o id ya presente: re-check por product
        const again = await db
          .select({ id: orderTemplates.id })
          .from(orderTemplates)
          .where(
            and(
              eq(orderTemplates.productId, t.productId),
              eq(orderTemplates.type, t.type),
              eq(orderTemplates.version, t.version)
            )
          )
          .limit(1);
        if (again.length === 0) throw err;
      }
    }
    this.seeded = true;
  }

  async listTemplates(type?: OrderDocType): Promise<OrderTemplateRecord[]> {
    await this.ensureSeed();
    const db = getDb();
    const rows = type
      ? await db
          .select()
          .from(orderTemplates)
          .where(and(eq(orderTemplates.status, "VIGENTE"), eq(orderTemplates.type, type)))
          .orderBy(asc(orderTemplates.productName))
      : await db
          .select()
          .from(orderTemplates)
          .where(eq(orderTemplates.status, "VIGENTE"))
          .orderBy(asc(orderTemplates.productName));
    return rows.map(mapTemplate);
  }

  async listTemplateHistory(
    productId: string,
    type: OrderDocType
  ): Promise<OrderTemplateRecord[]> {
    await this.ensureSeed();
    const db = getDb();
    const rows = await db
      .select()
      .from(orderTemplates)
      .where(and(eq(orderTemplates.productId, productId), eq(orderTemplates.type, type)))
      .orderBy(desc(orderTemplates.version));
    return rows.map(mapTemplate);
  }

  async listAllTemplates(type?: OrderDocType): Promise<OrderTemplateRecord[]> {
    await this.ensureSeed();
    const db = getDb();
    const rows = type
      ? await db
          .select()
          .from(orderTemplates)
          .where(eq(orderTemplates.type, type))
          .orderBy(asc(orderTemplates.productName), desc(orderTemplates.version))
      : await db
          .select()
          .from(orderTemplates)
          .orderBy(asc(orderTemplates.productName), desc(orderTemplates.version));
    return rows.map(mapTemplate);
  }

  async getTemplate(id: string): Promise<OrderTemplateRecord | null> {
    await this.ensureSeed();
    const db = getDb();
    const rows = await db.select().from(orderTemplates).where(eq(orderTemplates.id, id)).limit(1);
    return rows[0] ? mapTemplate(rows[0]) : null;
  }

  async getVigenteTemplate(
    productId: string,
    type: OrderDocType
  ): Promise<OrderTemplateRecord | null> {
    await this.ensureSeed();
    const db = getDb();
    const rows = await db
      .select()
      .from(orderTemplates)
      .where(
        and(
          eq(orderTemplates.productId, productId),
          eq(orderTemplates.type, type),
          eq(orderTemplates.status, "VIGENTE")
        )
      )
      .orderBy(desc(orderTemplates.version))
      .limit(1);
    return rows[0] ? mapTemplate(rows[0]) : null;
  }

  async insertTemplate(template: OrderTemplateRecord): Promise<OrderTemplateRecord> {
    const db = getDb();
    await db.insert(orderTemplates).values({
      id: template.id,
      type: template.type,
      productId: template.productId,
      productName: template.productName,
      productCode: template.productCode,
      brandClient: template.brandClient,
      version: template.version,
      status: template.status,
      content: template.content,
      changeReason: template.changeReason,
      previousVersionId: template.previousVersionId,
      createdBy: template.createdBy,
      updatedBy: template.updatedBy,
      createdAt: new Date(template.createdAt),
      updatedAt: new Date(template.updatedAt),
    });
    return template;
  }

  async markTemplateObsolete(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(orderTemplates)
      .set({ status: "OBSOLETA", updatedAt: new Date() })
      .where(eq(orderTemplates.id, id));
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
    const db = getDb();
    const existing = await this.getTemplate(id);
    if (!existing) return null;
    await db
      .update(orderTemplates)
      .set({
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.productName !== undefined ? { productName: patch.productName } : {}),
        ...(patch.productCode !== undefined ? { productCode: patch.productCode } : {}),
        ...(patch.brandClient !== undefined ? { brandClient: patch.brandClient } : {}),
        ...(patch.changeReason !== undefined ? { changeReason: patch.changeReason } : {}),
        ...(patch.updatedBy !== undefined ? { updatedBy: patch.updatedBy } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orderTemplates.id, id));
    return this.getTemplate(id);
  }

  async nextOrderNumber(type: OrderDocType, year: number): Promise<string> {
    const db = getDb();
    return db.transaction(async (tx) => {
      await tx
        .insert(orderNumberSequences)
        .values({ type, year, lastValue: 0 })
        .onConflictDoNothing({
          target: [orderNumberSequences.type, orderNumberSequences.year],
        });
      const updated = await tx
        .update(orderNumberSequences)
        .set({ lastValue: sql`${orderNumberSequences.lastValue} + 1` })
        .where(
          and(eq(orderNumberSequences.type, type), eq(orderNumberSequences.year, year))
        )
        .returning();
      const value = updated[0]?.lastValue ?? 1;
      return `${type}-${year}-${String(value).padStart(6, "0")}`;
    });
  }

  async insertOrder(order: OperationalOrderRecord): Promise<OperationalOrderRecord> {
    const db = getDb();
    await db.insert(operationalOrders).values({
      id: order.id,
      orderNumber: order.orderNumber,
      type: order.type,
      templateId: order.templateId,
      templateVersion: order.templateVersion,
      templateSnapshot: order.templateSnapshot,
      product: order.product,
      client: order.client,
      code: order.code,
      lot: order.lot,
      assignedSector: order.assignedSector,
      status: order.status,
      formData: order.formData,
      completionPercentage: order.completionPercentage,
      revision: order.revision,
      version: order.version,
      linkedWorkItemId: order.linkedWorkItemId,
      reviewedAt: order.reviewedAt ? new Date(order.reviewedAt) : null,
      reviewedBy: order.reviewedBy,
      completedAt: order.completedAt ? new Date(order.completedAt) : null,
      completedBy: order.completedBy,
      createdBy: order.createdBy,
      updatedBy: order.updatedBy,
      createdAt: new Date(order.createdAt),
      updatedAt: new Date(order.updatedAt),
    });
    return order;
  }

  async getOrder(id: string): Promise<OperationalOrderRecord | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(operationalOrders)
      .where(eq(operationalOrders.id, id))
      .limit(1);
    return rows[0] ? mapOrder(rows[0]) : null;
  }

  async listOrders(filters: ListOrdersFilters): Promise<{
    items: OperationalOrderRecord[];
    total: number;
    pendingCount: number;
    completeCount: number;
  }> {
    const db = getDb();
    const all = await db.select().from(operationalOrders);
    let list = all.map(mapOrder);
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
    if (filters.product) {
      const p = filters.product.toLowerCase();
      list = list.filter((o) => o.product.toLowerCase().includes(p));
    }
    if (filters.client) {
      const c = filters.client.toLowerCase();
      list = list.filter((o) => o.client.toLowerCase().includes(c));
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.product.toLowerCase().includes(q) ||
          o.code.toLowerCase().includes(q) ||
          o.client.toLowerCase().includes(q) ||
          o.lot.toLowerCase().includes(q) ||
          o.status.toLowerCase().includes(q) ||
          o.assignedSector.toLowerCase().includes(q)
      );
    }
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
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
    const total = list.length;
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const start = (page - 1) * pageSize;
    return {
      items: list.slice(start, start + pageSize),
      total,
      pendingCount,
      completeCount,
    };
  }

  async updateOrderOptimistic(
    id: string,
    expectedVersion: number,
    patch: Partial<OperationalOrderRecord>
  ): Promise<OperationalOrderRecord | null> {
    const db = getDb();
    const setValues: Record<string, unknown> = {
      version: sql`${operationalOrders.version} + 1`,
      updatedAt: new Date(),
    };
    if (patch.formData !== undefined) setValues.formData = patch.formData;
    if (patch.completionPercentage !== undefined) {
      setValues.completionPercentage = patch.completionPercentage;
    }
    if (patch.status !== undefined) setValues.status = patch.status;
    if (patch.lot !== undefined) setValues.lot = patch.lot;
    if (patch.client !== undefined) setValues.client = patch.client;
    if (patch.code !== undefined) setValues.code = patch.code;
    if (patch.product !== undefined) setValues.product = patch.product;
    if (patch.updatedBy !== undefined) setValues.updatedBy = patch.updatedBy;
    if (patch.revision !== undefined) setValues.revision = patch.revision;
    if (patch.completedAt !== undefined) {
      setValues.completedAt = patch.completedAt ? new Date(patch.completedAt) : null;
    }
    if (patch.completedBy !== undefined) setValues.completedBy = patch.completedBy;
    if (patch.reviewedAt !== undefined) {
      setValues.reviewedAt = patch.reviewedAt ? new Date(patch.reviewedAt) : null;
    }
    if (patch.reviewedBy !== undefined) setValues.reviewedBy = patch.reviewedBy;

    const rows = await db
      .update(operationalOrders)
      .set(setValues)
      .where(
        and(eq(operationalOrders.id, id), eq(operationalOrders.version, expectedVersion))
      )
      .returning();
    return rows[0] ? mapOrder(rows[0]) : null;
  }

  async insertOrderVersion(version: OrderVersionRecord): Promise<OrderVersionRecord> {
    const db = getDb();
    await db.insert(orderVersions).values({
      id: version.id,
      orderId: version.orderId,
      version: version.version,
      snapshot: version.snapshot,
      event: version.event,
      reason: version.reason,
      createdBy: version.createdBy,
      createdAt: new Date(version.createdAt),
    });
    return version;
  }

  async listOrderVersions(orderId: string): Promise<OrderVersionRecord[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(orderVersions)
      .where(eq(orderVersions.orderId, orderId))
      .orderBy(desc(orderVersions.version));
    return rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      version: r.version,
      snapshot: r.snapshot as OperationalOrderRecord,
      event: r.event,
      reason: r.reason,
      createdBy: r.createdBy,
      createdAt: toIso(r.createdAt)!,
    }));
  }

  async insertProposal(
    proposal: TemplateChangeProposalRecord
  ): Promise<TemplateChangeProposalRecord> {
    const db = getDb();
    await db.insert(templateChangeProposals).values({
      id: proposal.id,
      templateId: proposal.templateId,
      orderId: proposal.orderId,
      proposedChanges: proposal.proposedChanges,
      proposedBy: proposal.proposedBy,
      proposedAt: new Date(proposal.proposedAt),
      status: proposal.status,
      decidedBy: proposal.decidedBy,
      decidedAt: proposal.decidedAt ? new Date(proposal.decidedAt) : null,
      decisionReason: proposal.decisionReason,
    });
    return proposal;
  }

  async getProposal(id: string): Promise<TemplateChangeProposalRecord | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(templateChangeProposals)
      .where(eq(templateChangeProposals.id, id))
      .limit(1);
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      templateId: r.templateId,
      orderId: r.orderId,
      proposedChanges: r.proposedChanges as OrderContent,
      proposedBy: r.proposedBy,
      proposedAt: toIso(r.proposedAt)!,
      status: r.status,
      decidedBy: r.decidedBy,
      decidedAt: toIso(r.decidedAt),
      decisionReason: r.decisionReason,
    };
  }

  async updateProposal(
    id: string,
    patch: Partial<TemplateChangeProposalRecord>
  ): Promise<TemplateChangeProposalRecord | null> {
    const db = getDb();
    const rows = await db
      .update(templateChangeProposals)
      .set({
        status: patch.status,
        decidedBy: patch.decidedBy,
        decidedAt: patch.decidedAt ? new Date(patch.decidedAt) : undefined,
        decisionReason: patch.decisionReason,
      })
      .where(eq(templateChangeProposals.id, id))
      .returning();
    if (!rows[0]) return null;
    return this.getProposal(id);
  }

  async listProposals(status?: string): Promise<TemplateChangeProposalRecord[]> {
    const db = getDb();
    const rows = status
      ? await db
          .select()
          .from(templateChangeProposals)
          .where(eq(templateChangeProposals.status, status as "PENDIENTE"))
      : await db.select().from(templateChangeProposals);
    return rows.map((r) => ({
      id: r.id,
      templateId: r.templateId,
      orderId: r.orderId,
      proposedChanges: r.proposedChanges as OrderContent,
      proposedBy: r.proposedBy,
      proposedAt: toIso(r.proposedAt)!,
      status: r.status,
      decidedBy: r.decidedBy,
      decidedAt: toIso(r.decidedAt),
      decisionReason: r.decisionReason,
    }));
  }

  async appendAudit(
    event: Omit<OrderAuditEventRecord, "id" | "timestamp"> & { timestamp?: string }
  ): Promise<OrderAuditEventRecord> {
    const db = getDb();
    const id = randomUUID();
    const timestamp = event.timestamp ?? new Date().toISOString();
    await db.insert(orderAuditEvents).values({
      id,
      orderId: event.orderId,
      eventType: event.eventType,
      actor: event.actor,
      actorSector: event.actorSector,
      metadata: event.metadata,
      timestamp: new Date(timestamp),
    });
    return { id, ...event, timestamp };
  }

  async insertNotification(
    notification: OsNotificationRecord
  ): Promise<OsNotificationRecord> {
    const db = getDb();
    await db.insert(osNotifications).values({
      id: notification.id,
      kind: notification.kind,
      title: notification.title,
      message: notification.message,
      sectors: notification.sectors,
      href: notification.href,
      orderId: notification.orderId,
      readBy: notification.readBy,
      dismissedBy: notification.dismissedBy,
      createdAt: new Date(notification.createdAt),
    });
    return notification;
  }

  async listNotificationsForSector(
    sector: string,
    actorEmail: string
  ): Promise<OsNotificationRecord[]> {
    const db = getDb();
    const rows = await db.select().from(osNotifications).orderBy(desc(osNotifications.createdAt));
    return rows
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        message: r.message,
        sectors: r.sectors as SectorId[],
        href: r.href,
        orderId: r.orderId,
        readBy: (r.readBy as string[]) ?? [],
        dismissedBy: (r.dismissedBy as string[]) ?? [],
        createdAt: toIso(r.createdAt)!,
      }))
      .filter(
        (n) => n.sectors.includes(sector as SectorId) && !n.dismissedBy.includes(actorEmail)
      );
  }

  async markNotificationRead(id: string, actorEmail: string): Promise<void> {
    const db = getDb();
    const rows = await db
      .select()
      .from(osNotifications)
      .where(eq(osNotifications.id, id))
      .limit(1);
    if (!rows[0]) return;
    const readBy = [...((rows[0].readBy as string[]) ?? [])];
    if (!readBy.includes(actorEmail)) readBy.push(actorEmail);
    await db.update(osNotifications).set({ readBy }).where(eq(osNotifications.id, id));
  }

  async dismissNotification(id: string, actorEmail: string): Promise<void> {
    const db = getDb();
    const rows = await db
      .select()
      .from(osNotifications)
      .where(eq(osNotifications.id, id))
      .limit(1);
    if (!rows[0]) return;
    const dismissedBy = [...((rows[0].dismissedBy as string[]) ?? [])];
    if (!dismissedBy.includes(actorEmail)) dismissedBy.push(actorEmail);
    await db
      .update(osNotifications)
      .set({ dismissedBy })
      .where(eq(osNotifications.id, id));
  }
}
