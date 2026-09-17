-- Migración 0032 — Fuentes configurables de Asignación de Lotes (Google Sheets).
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0031).
--
-- Objetivo: eliminar el copiado manual desde la planilla real de Asignación
-- de Lotes, sin hardcodear un spreadsheetId por año. Conectar "Asignación
-- de Lotes 2027" es una fila nueva en asignacion_lote_sources, nunca un
-- deploy. El sync escribe en la MISMA tabla asignacion_lotes de siempre, a
-- través del mismo AsignacionLotesService — toda la protección existente
-- (fill-once de WorkItem, resolver de PR #95, no-clobber de una corrección
-- manual) sigue aplicando sin cambios.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asignacion_lote_sources" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "period" text NOT NULL DEFAULT '',
  "spreadsheet_id" text NOT NULL,
  "sheet_tab" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "priority" integer NOT NULL DEFAULT 0,
  "last_sync_at" timestamptz,
  "last_successful_sync_at" timestamptz,
  "sync_status" text NOT NULL DEFAULT 'nunca_sincronizado',
  "last_error" text,
  "created_by" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asignacion_lote_sources_enabled_idx" ON "asignacion_lote_sources" ("enabled");
--> statement-breakpoint
-- Auditoría por ejecución de sync (ISO 9001: quién/cuándo/cuántas filas).
-- No reutiliza operational_events — ese log tiene FK work_item_id y esto es
-- a nivel fuente, sin WorkItem involucrado.
CREATE TABLE IF NOT EXISTS "asignacion_lote_sync_runs" (
  "id" text PRIMARY KEY,
  "source_id" text REFERENCES "asignacion_lote_sources"("id") ON DELETE CASCADE,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "status" text NOT NULL DEFAULT 'en_progreso',
  "rows_read" integer NOT NULL DEFAULT 0,
  "created_count" integer NOT NULL DEFAULT 0,
  "updated_count" integer NOT NULL DEFAULT 0,
  "unchanged_count" integer NOT NULL DEFAULT 0,
  "invalid_count" integer NOT NULL DEFAULT 0,
  "archived_count" integer NOT NULL DEFAULT 0,
  "conflict_count" integer NOT NULL DEFAULT 0,
  "error_message" text,
  "triggered_by" text NOT NULL DEFAULT '',
  "trigger_kind" text NOT NULL DEFAULT 'manual'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asignacion_lote_sync_runs_source_idx" ON "asignacion_lote_sync_runs" ("source_id", "started_at");
--> statement-breakpoint
-- Nullable: null = carga manual o "Pegar desde Excel" (comportamiento
-- actual, sin cambios). Solo las filas creadas/actualizadas por el sync de
-- Google Sheets tienen este valor — permite mostrar "Origen: Google Sheets
-- · <fuente>" y detectar conflicto entre fuentes.
ALTER TABLE "asignacion_lotes"
  ADD COLUMN IF NOT EXISTS "source_id" text REFERENCES "asignacion_lote_sources"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asignacion_lotes_source_id_idx" ON "asignacion_lotes" ("source_id");
