import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
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
    formulaProductId: uuid("formula_product_id"),
    formulaVersionId: uuid("formula_version_id"),
    formulaVersionHash: text("formula_version_hash"),
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

/** Inventario ME/MP — documento JSON por fila (columnas comerciales en payload). */
export const invMeIngresos = pgTable("inv_me_ingresos", {
  id: uuid("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invMeSalidas = pgTable("inv_me_salidas", {
  id: uuid("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invMeMaterials = pgTable("inv_me_materials", {
  id: uuid("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invMeAlerts = pgTable("inv_me_alerts", {
  id: uuid("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invMeAlertReads = pgTable(
  "inv_me_alert_reads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    alertId: uuid("alert_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    payload: jsonb("payload").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("inv_me_alert_reads_alert_email_uidx").on(table.alertId, table.actorEmail),
  ]
);

export const invMpStock = pgTable("inv_mp_stock", {
  id: uuid("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invMpIngresos = pgTable("inv_mp_ingresos", {
  id: uuid("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invMpControl = pgTable("inv_mp_control", {
  id: uuid("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invMpCompras = pgTable("inv_mp_compras", {
  id: uuid("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invAjustes = pgTable("inv_ajustes", {
  id: uuid("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invAudit = pgTable("inv_audit", {
  id: uuid("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

/** Banco privado de fórmulas (Neon) — sin endpoint de listado completo. */
export const formulaProducts = pgTable(
  "formula_products",
  {
    id: uuid("id").primaryKey(),
    normalizedClient: text("normalized_client").notNull(),
    normalizedProduct: text("normalized_product").notNull(),
    displayClient: text("display_client").notNull(),
    displayProduct: text("display_product").notNull(),
    productCode: text("product_code"),
    activeVersionId: uuid("active_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("formula_products_norm_uidx").on(t.normalizedClient, t.normalizedProduct),
  ]
);

export const formulaVersions = pgTable("formula_versions", {
  id: uuid("id").primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .references(() => formulaProducts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: text("status").notNull(), // VIGENTE | HISTORICA | CONFLICTO | BORRADOR_PROPUESTA
  sourceFile: text("source_file"),
  sourceSheet: text("source_sheet"),
  sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true }),
  sourceHash: text("source_hash").notNull(),
  semanticHash: text("semantic_hash").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  percentageTotal: text("percentage_total"),
  validationStatus: text("validation_status").notNull().default("OK"),
  warnings: jsonb("warnings").notNull().default([]),
  previousVersionId: uuid("previous_version_id"),
  conflictCode: text("conflict_code"),
  altSourcePaths: jsonb("alt_source_paths").notNull().default([]),
});

export const formulaIngredients = pgTable("formula_ingredients", {
  id: uuid("id").primaryKey(),
  formulaVersionId: uuid("formula_version_id")
    .notNull()
    .references(() => formulaVersions.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  materialName: text("material_name").notNull(),
  materialCodeOrPhase: text("material_code_or_phase"),
  percentage: text("percentage"),
  notes: text("notes"),
});

export const formulaProcedureSteps = pgTable("formula_procedure_steps", {
  id: uuid("id").primaryKey(),
  formulaVersionId: uuid("formula_version_id")
    .notNull()
    .references(() => formulaVersions.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  instruction: text("instruction").notNull(),
});

export const formulaSpecifications = pgTable("formula_specifications", {
  id: uuid("id").primaryKey(),
  formulaVersionId: uuid("formula_version_id")
    .notNull()
    .references(() => formulaVersions.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  expectedValue: text("expected_value"),
  unit: text("unit"),
  notes: text("notes"),
});

export const formulaImportRuns = pgTable("formula_import_runs", {
  id: uuid("id").primaryKey(),
  sourceArchiveHash: text("source_archive_hash").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").notNull(),
  filesScanned: integer("files_scanned").notNull().default(0),
  formulasDetected: integer("formulas_detected").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  duplicated: integer("duplicated").notNull().default(0),
  warnings: jsonb("warnings").notNull().default([]),
  errors: jsonb("errors").notNull().default([]),
});

export const formulaProposals = pgTable("formula_proposals", {
  id: uuid("id").primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .references(() => formulaProducts.id, { onDelete: "cascade" }),
  proposedVersionId: uuid("proposed_version_id").references(() => formulaVersions.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("PENDIENTE"),
  reason: text("reason"),
  createdBy: text("created_by").notNull(),
  createdBySector: text("created_by_sector").notNull(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Avisos internos (mensajería por sector) — migración 0005. */
export const osInternalMessages = pgTable("os_internal_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  priority: text("priority").notNull().default("NORMAL"),
  fromSector: text("from_sector").notNull(),
  fromEmail: text("from_email").notNull(),
  toSectors: jsonb("to_sectors").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  audit: jsonb("audit").notNull().default({}),
});

export const osInternalMessageRecipients = pgTable(
  "os_internal_message_recipients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => osInternalMessages.id, { onDelete: "cascade" }),
    sector: text("sector").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("os_internal_message_recipients_msg_sector_uidx").on(
      table.messageId,
      table.sector
    ),
  ]
);

/** Control semanal MP v2 — migración 0005. */
export const mpWeeklyControls = pgTable("mp_weekly_controls", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: text("status").notNull().default("BORRADOR"),
  client: text("client").notNull().default(""),
  product: text("product").notNull().default(""),
  quantityKg: doublePrecision("quantity_kg"),
  linkedOeId: uuid("linked_oe_id"),
  driveFileId: text("drive_file_id"),
  driveModifiedTime: text("drive_modified_time"),
  driveChecksum: text("drive_checksum"),
  formulaSnapshot: jsonb("formula_snapshot"),
  source: text("source"),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  audit: jsonb("audit").notNull().default({}),
});

export const mpWeeklyControlLines = pgTable("mp_weekly_control_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  controlId: uuid("control_id")
    .notNull()
    .references(() => mpWeeklyControls.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  codigo: text("codigo").notNull().default(""),
  materiaPrima: text("materia_prima").notNull().default(""),
  formulaPct: doublePrecision("formula_pct"),
  kgNecesarios: doublePrecision("kg_necesarios"),
  kgEditados: doublePrecision("kg_editados"),
  stockActual: doublePrecision("stock_actual"),
  stockProyectado: doublePrecision("stock_proyectado"),
  diferencia: doublePrecision("diferencia"),
  estado: text("estado").notNull().default("Sin código"),
  lote: text("lote").notNull().default(""),
  preparado: boolean("preparado").notNull().default(false),
  observacion: text("observacion").notNull().default(""),
  payload: jsonb("payload").notNull().default({}),
});

/** Ledger stock MP — migración 0005. */
export const mpStockBalances = pgTable("mp_stock_balances", {
  codigo: text("codigo").primaryKey(),
  descripcion: text("descripcion").notNull().default(""),
  saldoInicial: doublePrecision("saldo_inicial").notNull().default(0),
  saldoInicialSeededAt: timestamp("saldo_inicial_seeded_at", { withTimezone: true }),
  stockActual: doublePrecision("stock_actual").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").notNull().default({}),
});

export const mpStockMovements = pgTable(
  "mp_stock_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codigo: text("codigo").notNull(),
    kind: text("kind").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    balanceAfter: doublePrecision("balance_after"),
    reason: text("reason").notNull().default(""),
    refType: text("ref_type"),
    refId: text("ref_id"),
    lote: text("lote"),
    proveedor: text("proveedor"),
    documento: text("documento"),
    actorEmail: text("actor_email").notNull(),
    actorSector: text("actor_sector").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    reversed: boolean("reversed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
  },
  (table) => [
    uniqueIndex("mp_stock_movements_idempotency_uidx").on(table.idempotencyKey),
  ]
);

/** COA metadata — binarios en Drive; migración 0005. */
export const coaFolders = pgTable(
  "coa_folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    driveFolderId: text("drive_folder_id").notNull(),
    path: text("path").notNull().default("/"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archived: boolean("archived").notNull().default(false),
    audit: jsonb("audit").notNull().default({}),
  },
  (table) => [
    uniqueIndex("coa_folders_drive_folder_uidx").on(table.driveFolderId),
  ]
);

export const coaFiles = pgTable(
  "coa_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => coaFolders.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    driveFileId: text("drive_file_id").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archived: boolean("archived").notNull().default(false),
    audit: jsonb("audit").notNull().default({}),
  },
  (table) => [uniqueIndex("coa_files_drive_file_uidx").on(table.driveFileId)]
);

export const coaFileVersions = pgTable(
  "coa_file_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => coaFiles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    driveFileId: text("drive_file_id").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    checksum: text("checksum"),
  },
  (table) => [
    uniqueIndex("coa_file_versions_file_version_uidx").on(table.fileId, table.version),
  ]
);

export const featureAuditEvents = pgTable("feature_audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  domain: text("domain").notNull(),
  action: text("action").notNull(),
  actorEmail: text("actor_email").notNull(),
  actorSector: text("actor_sector").notNull(),
  entityId: text("entity_id"),
  idempotencyKey: text("idempotency_key"),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Remitos — migración 0006 (diferida). Packaging fields viven en work items JSON. */
export const remitos = pgTable(
  "remitos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    remitoNumber: text("remito_number"),
    /** Nombre elegido por Producción (migración 0007). */
    displayName: text("display_name"),
    clientIdNormalized: text("client_id_normalized").notNull(),
    clientDisplay: text("client_display").notNull(),
    deliveryDate: date("delivery_date").notNull(),
    status: text("status").notNull().default("BORRADOR"),
    version: integer("version").notNull().default(1),
    totalUnits: doublePrecision("total_units").notNull().default(0),
    totalCajas: doublePrecision("total_cajas").notNull().default(0),
    totalBultos: doublePrecision("total_bultos").notNull().default(0),
    snapshot: jsonb("snapshot").notNull().default({}),
    createdBy: text("created_by"),
    createdBySector: text("created_by_sector"),
    updatedBy: text("updated_by"),
    generatedBy: text("generated_by"),
    audit: jsonb("audit").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("remitos_client_date_version_uidx").on(
      table.clientIdNormalized,
      table.deliveryDate,
      table.version
    ),
  ]
);

export const remitoLines = pgTable(
  "remito_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    remitoId: uuid("remito_id")
      .notNull()
      .references(() => remitos.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id").notNull(),
    product: text("product").notNull().default(""),
    lote: text("lote").notNull().default(""),
    vto: text("vto").notNull().default(""),
    totalUnits: doublePrecision("total_units").notNull().default(0),
    cajas1: integer("cajas1").notNull().default(0),
    unidades1: integer("unidades1").notNull().default(0),
    cajas2: integer("cajas2").notNull().default(0),
    unidades2: integer("unidades2").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    payload: jsonb("payload").notNull().default({}),
  },
  (table) => [
    uniqueIndex("remito_lines_remito_work_uidx").on(table.remitoId, table.workItemId),
  ]
);

export const remitoWorkLinks = pgTable(
  "remito_work_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    remitoId: uuid("remito_id")
      .notNull()
      .references(() => remitos.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("remito_work_links_work_item_uidx").on(table.workItemId)]
);

export const remitoVersions = pgTable(
  "remito_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    remitoId: uuid("remito_id")
      .notNull()
      .references(() => remitos.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Motivo de edición / nueva versión (migración 0007). */
    motivo: text("motivo"),
    driveFileIdXlsx: text("drive_file_id_xlsx"),
    driveFileIdPdf: text("drive_file_id_pdf"),
    snapshot: jsonb("snapshot").notNull().default({}),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("remito_versions_remito_version_uidx").on(table.remitoId, table.version),
  ]
);

export const remitoFiles = pgTable(
  "remito_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    remitoId: uuid("remito_id")
      .notNull()
      .references(() => remitos.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => remitoVersions.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    driveFileId: text("drive_file_id").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    audit: jsonb("audit").notNull().default({}),
  },
  (table) => [uniqueIndex("remito_files_drive_file_uidx").on(table.driveFileId)]
);

/** Preferencias "Archivar de mi vista" — migración 0007 (diferida). */
export const workViewArchives = pgTable(
  "work_view_archives",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sector: text("sector").notNull(),
    workItemId: text("work_item_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("work_view_archives_sector_work_actor_uidx").on(
      table.sector,
      table.workItemId,
      table.actorEmail
    ),
  ]
);

