-- Migración 0040 — Auditoría de edición por celda de Asignación de Lotes
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
--> statement-breakpoint
-- Operaciones de escritura de vuelta a Google Sheets (opción C, bidireccional):
-- bitácora idempotente de cada celda escrita en la Sheet + su confirmación en Neon.
CREATE TABLE IF NOT EXISTS "asignacion_lotes_writeback_ops" (
  "id" text PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL,
  "record_id" text NOT NULL,
  "lote" text NOT NULL DEFAULT '',
  "field" text NOT NULL,
  "spreadsheet_id" text NOT NULL,
  "sheet_tab" text NOT NULL,
  "a1" text,
  "old_value" text,
  "new_value" text,
  "status" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "actor_name" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asignacion_lotes_writeback_ops_idem_uidx"
  ON "asignacion_lotes_writeback_ops" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asignacion_lotes_writeback_ops_record_idx"
  ON "asignacion_lotes_writeback_ops" ("record_id","status");
--> statement-breakpoint
-- Auditoría/idempotencia de ediciones de celdas de SEMANAS 2026 (grilla Producción → Semanas):
-- la Sheet es la única fuente de verdad; aquí solo queda la bitácora de quién cambió qué celda.
CREATE TABLE IF NOT EXISTS "sheet_cell_edits" (
  "id" text PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL,
  "spreadsheet_id" text NOT NULL,
  "sheet_tab" text NOT NULL,
  "a1" text NOT NULL,
  "old_value" text,
  "new_value" text,
  "status" text NOT NULL,
  "last_error" text,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "actor_name" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sheet_cell_edits_idem_uidx" ON "sheet_cell_edits" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sheet_cell_edits_cell_idx" ON "sheet_cell_edits" ("spreadsheet_id","sheet_tab","a1");
