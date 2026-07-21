import type {
  CreateOrderInput,
  ListOrdersFilters,
  OperationalOrderRecord,
  OrderAuditEventRecord,
  OrderContent,
  OrderDocType,
  OrderTemplateRecord,
  OrderVersionRecord,
  OrdersActor,
  OsNotificationRecord,
  TemplateChangeProposalRecord,
} from "@/lib/orders/types";

export interface OrdersRepository {
  listTemplates(type?: OrderDocType): Promise<OrderTemplateRecord[]>;
  listAllTemplates?(type?: OrderDocType): Promise<OrderTemplateRecord[]>;
  listTemplateHistory?(
    productId: string,
    type: OrderDocType
  ): Promise<OrderTemplateRecord[]>;
  getTemplate(id: string): Promise<OrderTemplateRecord | null>;
  getVigenteTemplate(
    productId: string,
    type: OrderDocType
  ): Promise<OrderTemplateRecord | null>;
  insertTemplate(template: OrderTemplateRecord): Promise<OrderTemplateRecord>;
  markTemplateObsolete(id: string): Promise<void>;
  updateTemplateContent?(
    id: string,
    patch: Partial<
      Pick<
        OrderTemplateRecord,
        "content" | "productName" | "productCode" | "brandClient" | "changeReason" | "updatedBy"
      >
    >
  ): Promise<OrderTemplateRecord | null>;

  nextOrderNumber(type: OrderDocType, year: number): Promise<string>;

  insertOrder(order: OperationalOrderRecord): Promise<OperationalOrderRecord>;
  getOrder(id: string): Promise<OperationalOrderRecord | null>;
  deleteOrder(id: string): Promise<boolean>;
  listOrders(filters: ListOrdersFilters): Promise<{
    items: OperationalOrderRecord[];
    total: number;
    pendingCount: number;
    completeCount: number;
  }>;
  updateOrderOptimistic(
    id: string,
    expectedVersion: number,
    patch: Partial<OperationalOrderRecord>
  ): Promise<OperationalOrderRecord | null>;

  insertOrderVersion(version: OrderVersionRecord): Promise<OrderVersionRecord>;
  listOrderVersions(orderId: string): Promise<OrderVersionRecord[]>;

  insertProposal(
    proposal: TemplateChangeProposalRecord
  ): Promise<TemplateChangeProposalRecord>;
  getProposal(id: string): Promise<TemplateChangeProposalRecord | null>;
  updateProposal(
    id: string,
    patch: Partial<TemplateChangeProposalRecord>
  ): Promise<TemplateChangeProposalRecord | null>;
  listProposals(status?: string): Promise<TemplateChangeProposalRecord[]>;

  appendAudit(
    event: Omit<OrderAuditEventRecord, "id" | "timestamp"> & { timestamp?: string }
  ): Promise<OrderAuditEventRecord>;

  insertNotification(
    notification: OsNotificationRecord
  ): Promise<OsNotificationRecord>;
  listNotificationsForSector(
    sector: string,
    actorEmail: string
  ): Promise<OsNotificationRecord[]>;
  markNotificationRead(id: string, actorEmail: string): Promise<void>;
  dismissNotification(id: string, actorEmail: string): Promise<void>;

  /** Helper for tests / seed */
  ensureSeed?(actor?: OrdersActor, contents?: OrderContent[]): Promise<void>;
}

export type { CreateOrderInput };
