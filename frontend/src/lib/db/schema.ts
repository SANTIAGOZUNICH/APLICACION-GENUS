import {
  check,
  date,
  integer,
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
    /** Avance operativo (Beta Operativa). */
    finishedQuantity: text("finished_quantity"),
    operationalObservation: text("operational_observation"),
    progressUpdatedAt: timestamp("progress_updated_at", { withTimezone: true }),
    progressUpdatedBy: text("progress_updated_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by"),
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

export type PlanningWeekRow = typeof planningWeeks.$inferSelect;
export type WorkItemRow = typeof workItems.$inferSelect;
export type OperationalEventRow = typeof operationalEvents.$inferSelect;
