/**
 * Migración 0015 — Creamy memoria personal/operativa (ADITIVA).
 * NO APLICAR hasta autorización explícita: APPLY_MIGRATION_0015=1
 *
 * - Memoria personal por usuario (creamy_user_memories): aislada por user_email.
 * - Memoria operativa compartida (creamy_operational_memories): hechos operativos
 *   reportados desde el chat (sustituciones de MP usadas, motivos, etc.), con
 *   ciclo de vida REPORTADA -> VALIDADA / REVOCADA controlado por RBAC de sector.
 * - Evidencia (creamy_memory_evidence) y auditoría (creamy_memory_audit_events)
 *   para trazabilidad de cada hecho operativo.
 * - No toca formula_bank ni las migraciones 0004 (fórmulas) ni 0014 (Codificado/Graneles).
 * - Sin DROP/TRUNCATE. Idempotente con IF NOT EXISTS.
 */
CREATE TABLE IF NOT EXISTS "creamy_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_email" text NOT NULL,
  "sector" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_conversations_user_email_idx"
  ON "creamy_conversations" ("user_email");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "creamy_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "creamy_conversations"("id"),
  "role" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_messages_conversation_id_idx"
  ON "creamy_messages" ("conversation_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "creamy_user_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_email" text NOT NULL,
  "sector" text NOT NULL,
  "memory_type" text NOT NULL,
  "content" text NOT NULL,
  "normalized_key" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "last_used_at" timestamptz,
  "status" text DEFAULT 'active' NOT NULL,
  "source_conversation_id" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_user_memories_user_email_idx"
  ON "creamy_user_memories" ("user_email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "creamy_user_memories_email_key_active_uidx"
  ON "creamy_user_memories" ("user_email", "normalized_key")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "creamy_operational_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client" text NOT NULL,
  "product" text NOT NULL,
  "product_code" text,
  "materia_prima_original" text NOT NULL,
  "materia_prima_utilizada" text NOT NULL,
  "codigo_mp_original" text,
  "codigo_mp_utilizado" text,
  "motivo" text NOT NULL,
  "observacion" text,
  "cantidad_o_proporcion" text,
  "related_order_ref" text,
  "related_order_id" text,
  "fecha" date,
  "informado_por" text NOT NULL,
  "validado_por" text,
  "estado" text NOT NULL DEFAULT 'REPORTADA', -- REPORTADA|VALIDADA|REVOCADA
  "fuente" text NOT NULL DEFAULT 'CHAT', -- CHAT|OE|OA|OBSERVACION
  "evidence_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_operational_memories_client_idx"
  ON "creamy_operational_memories" ("client");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_operational_memories_product_idx"
  ON "creamy_operational_memories" ("product");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_operational_memories_product_code_idx"
  ON "creamy_operational_memories" ("product_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_operational_memories_related_order_id_idx"
  ON "creamy_operational_memories" ("related_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_operational_memories_related_order_ref_idx"
  ON "creamy_operational_memories" ("related_order_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_operational_memories_estado_idx"
  ON "creamy_operational_memories" ("estado");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "creamy_memory_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operational_memory_id" uuid NOT NULL REFERENCES "creamy_operational_memories"("id"),
  "evidence_type" text NOT NULL,
  "evidence_ref" text NOT NULL,
  "payload" jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_memory_evidence_operational_memory_id_idx"
  ON "creamy_memory_evidence" ("operational_memory_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "creamy_memory_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "action" text NOT NULL,
  "actor_email" text NOT NULL,
  "actor_sector" text,
  "detail" jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_memory_audit_events_entity_idx"
  ON "creamy_memory_audit_events" ("entity_type", "entity_id");
