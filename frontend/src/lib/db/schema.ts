import {
  check,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const planningWeekStatusEnum = pgEnum("planning_week_status", [
  "DRAFT",
  "PUBLISHED",
]);

export const workItemSectorEnum = pgEnum("work_item_sector", [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
]);

export const workItemStatusEnum = pgEnum("work_item_status", [
  "BORRADOR",
  "PLANIFICADO",
  "PUBLICADO",
  "ESPERANDO_MATERIALES",
  "LISTO_PARA_INICIAR",
  "EN_PROCESO",
  "BLOQUEADO",
  "TERMINADO_SECTOR",
  "PENDIENTE_CALIDAD",
  "RECHAZADO_CALIDAD",
  "APROBADO_CALIDAD",
  "LIBERADO",
  "CANCELADO",
]);

export const workItemSourceEnum = pgEnum("work_item_source", [
  "native",
  "import_sheets",
]);

export const workItemPriorityEnum = pgEnum("work_item_priority", [
  "URGENTE",
  "HOY",
  "ESTA_SEMANA",
  "NORMAL",
  "BAJA",
]);

export const orderDocTypeEnum = pgEnum("order_doc_type", ["OE", "OA"]);

export const orderTemplateStatusEnum = pgEnum("order_template_status", [
  "VIGENTE",
  "OBSOLETA",
]);

export const operationalOrderStatusEnum = pgEnum("operational_order_status", [
  "BORRADOR",
  "PENDIENTE",
  "EN_PROCESO",
  "COMPLETA",
  "COMPLETA_CON_PENDIENTES",
  "DEVUELTA_PARA_CORRECCION",
  "ANULADA",
  "ARCHIVADA",
]);

export const templateProposalStatusEnum = pgEnum("template_proposal_status", [
  "PENDIENTE",
  "APROBADA",
  "RECHAZADA",
]);

export const planningWeeks = pgTable(
  "planning_weeks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    weekStart: date("week_start").notNull(),
    label: text("label").notNull(),
    status: planningWeekStatusEnum("status").notNull().default("DRAFT"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("planning_weeks_week_start_uidx").on(table.weekStart),
    check(
      "planning_weeks_week_start_monday",
      sql`EXTRACT(ISODOW FROM ${table.weekStart}) = 1`
    ),
  ]
);

export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planningWeekId: uuid("planning_week_id")
      .notNull()
      .references(() => planningWeeks.id, { onDelete: "cascade" }),
    plannedDate: date("planned_date").notNull(),
    client: text("client").notNull(),
    product: text("product").notNull(),
    plannedQuantity: text("planned_quantity").notNull(),
    unit: text("unit").notNull().default("KG"),
    sector: workItemSectorEnum("sector").notNull(),
    line: text("line"),
    branchOwner: text("branch_owner"),
    priority: workItemPriorityEnum("priority").notNull().default("NORMAL"),
    notes: text("notes"),
    status: workItemStatusEnum("status").notNull().default("BORRADOR"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    source: workItemSourceEnum("source").notNull().default("native"),
    originRef: text("origin_ref"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "work_items_branch_owner_values",
      sql`${table.branchOwner} IS NULL OR ${table.branchOwner} IN ('Cristian', 'Nicolás')`
    ),
    check(
      "work_items_line_values",
      sql`${table.line} IS NULL OR ${table.line} IN ('Línea 1', 'Línea 2', 'Línea 3', 'Línea 4')`
    ),
    check(
      "work_items_sector_assignment",
      sql`(
        (${table.sector} = 'ELABORACION' AND ${table.line} IS NULL AND ${table.branchOwner} IS NOT NULL)
        OR (${table.sector} = 'ENVASADO_MASIVO' AND ${table.branchOwner} IS NULL AND ${table.line} IN ('Línea 1', 'Línea 2', 'Línea 3', 'Línea 4'))
        OR (${table.sector} = 'ENVASADO_PREMIUM' AND ${table.branchOwner} IS NULL AND ${table.line} IN ('Línea 1', 'Línea 2'))
      )`
    ),
  ]
);

export const operationalEvents = pgTable("operational_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  workItemId: uuid("work_item_id").references(() => workItems.id, {
    onDelete: "set null",
  }),
  planningWeekId: uuid("planning_week_id").references(() => planningWeeks.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  actorEmail: text("actor_email").notNull(),
  actorSector: text("actor_sector").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Plantilla maestra versionada por producto (OE/OA). Nunca se sobrescribe sin historial. */
export const orderTemplates = pgTable(
  "order_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: orderDocTypeEnum("type").notNull(),
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    productCode: text("product_code").notNull(),
    brandClient: text("brand_client"),
    version: integer("version").notNull().default(1),
    status: orderTemplateStatusEnum("status").notNull().default("VIGENTE"),
    content: jsonb("content").notNull(),
    changeReason: text("change_reason"),
    previousVersionId: uuid("previous_version_id"),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_templates_product_type_version_uidx").on(
      table.productId,
      table.type,
      table.version
    ),
  ]
);

/** Orden operativa con snapshot inmutable de la plantilla usada. */
export const operationalOrders = pgTable(
  "operational_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderNumber: text("order_number").notNull(),
    type: orderDocTypeEnum("type").notNull(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => orderTemplates.id),
    templateVersion: integer("template_version").notNull(),
    templateSnapshot: jsonb("template_snapshot").notNull(),
    product: text("product").notNull(),
    client: text("client").notNull(),
    code: text("code").notNull(),
    lot: text("lot").notNull(),
    assignedSector: text("assigned_sector").notNull(),
    status: operationalOrderStatusEnum("status").notNull().default("PENDIENTE"),
    formData: jsonb("form_data").notNull(),
    completionPercentage: integer("completion_percentage").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    version: integer("version").notNull().default(1),
    linkedWorkItemId: text("linked_work_item_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by"),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("operational_orders_number_uidx").on(table.orderNumber)]
);

export const orderVersions = pgTable("order_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => operationalOrders.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  event: text("event").notNull(),
  reason: text("reason"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const templateChangeProposals = pgTable("template_change_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => orderTemplates.id),
  orderId: uuid("order_id").references(() => operationalOrders.id, {
    onDelete: "set null",
  }),
  proposedChanges: jsonb("proposed_changes").notNull(),
  proposedBy: text("proposed_by").notNull(),
  proposedAt: timestamp("proposed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  status: templateProposalStatusEnum("status").notNull().default("PENDIENTE"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
});

export const orderAuditEvents = pgTable("order_audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").references(() => operationalOrders.id, {
    onDelete: "set null",
  }),
  eventType: text("event_type").notNull(),
  actor: text("actor").notNull(),
  actorSector: text("actor_sector").notNull(),
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Secuencia atómica por tipo+año — nunca COUNT+1. */
export const orderNumberSequences = pgTable(
  "order_number_sequences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: orderDocTypeEnum("type").notNull(),
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (table) => [
    uniqueIndex("order_number_sequences_type_year_uidx").on(table.type, table.year),
  ]
);

export const osNotifications = pgTable("os_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  sectors: jsonb("sectors").notNull(),
  href: text("href"),
  orderId: uuid("order_id").references(() => operationalOrders.id, {
    onDelete: "set null",
  }),
  readBy: jsonb("read_by").notNull().default([]),
  dismissedBy: jsonb("dismissed_by").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PlanningWeekRow = typeof planningWeeks.$inferSelect;
export type WorkItemRow = typeof workItems.$inferSelect;
export type OperationalEventRow = typeof operationalEvents.$inferSelect;
export type OrderTemplateRow = typeof orderTemplates.$inferSelect;
export type OperationalOrderRow = typeof operationalOrders.$inferSelect;
export type OrderVersionRow = typeof orderVersions.$inferSelect;
export type TemplateChangeProposalRow = typeof templateChangeProposals.$inferSelect;
export type OrderAuditEventRow = typeof orderAuditEvents.$inferSelect;
export type OsNotificationRow = typeof osNotifications.$inferSelect;
