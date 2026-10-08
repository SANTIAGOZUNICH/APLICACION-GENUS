-- Migración 0039 — Auditoría de edición por celda de Asignación de Lotes
-- (grilla tipo Excel). ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que
-- 0019-0038): solo crea una tabla nueva, no toca datos existentes.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asignacion_lotes_cell_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" text NOT NULL,
  "record_id" text NOT NULL,
  "lote" text NOT NULL DEFAULT '',
  "field" text NOT NULL,
  "old_value" text,
  "new_value" text,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "actor_name" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asignacion_lotes_cell_audit_record_idx"
  ON "asignacion_lotes_cell_audit" ("record_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asignacion_lotes_cell_audit_batch_idx"
  ON "asignacion_lotes_cell_audit" ("batch_id");
