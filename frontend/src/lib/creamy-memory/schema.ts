import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const creamyUserMemories = pgTable("creamy_user_memories", {
  id: uuid("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  /** Added by deferred migration 0017; email remains the legacy fallback. */
  userId: text("user_id"),
  sector: text("sector").notNull(),
  memoryType: text("memory_type").notNull(),
  content: text("content").notNull(),
  normalizedKey: text("normalized_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  status: text("status").notNull(),
  sourceConversationId: text("source_conversation_id"),
});

export const creamyOperationalMemories = pgTable("creamy_operational_memories", {
  id: uuid("id").primaryKey(), client: text("client").notNull(), product: text("product").notNull(),
  productCode: text("product_code"), materiaPrimaOriginal: text("materia_prima_original").notNull(),
  materiaPrimaUtilizada: text("materia_prima_utilizada").notNull(), codigoMpOriginal: text("codigo_mp_original"),
  codigoMpUtilizado: text("codigo_mp_utilizado"), motivo: text("motivo").notNull(), observacion: text("observacion"),
  cantidadOProporcion: text("cantidad_o_proporcion"), relatedOrderRef: text("related_order_ref"),
  relatedOrderId: text("related_order_id"), fecha: text("fecha"), informadoPor: text("informado_por").notNull(),
  validadoPor: text("validado_por"), estado: text("estado").notNull(), fuente: text("fuente").notNull(),
  evidenceId: text("evidence_id"), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), status: text("status").notNull(),
});

export const creamyMemoryEvidence = pgTable("creamy_memory_evidence", {
  id: uuid("id").primaryKey(), operationalMemoryId: uuid("operational_memory_id").notNull(),
  evidenceType: text("evidence_type").notNull(), evidenceRef: text("evidence_ref").notNull(),
  payload: jsonb("payload").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
});

export const creamyMemoryAuditEvents = pgTable("creamy_memory_audit_events", {
  id: uuid("id").primaryKey(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
  action: text("action").notNull(), actorEmail: text("actor_email").notNull(), actorSector: text("actor_sector"),
  detail: jsonb("detail").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
