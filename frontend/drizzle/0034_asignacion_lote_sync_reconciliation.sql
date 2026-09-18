-- Migración 0034 — Reconciliación obligatoria de sincronización (hotfix).
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0033).
--
-- Nuevas columnas de auditoría en asignacion_lote_sync_runs: cuántas filas
-- se ignoraron por estar vacías, cuántos duplicados EXACTOS entre hojas se
-- vieron, si la corrida reconcilió matemáticamente (rowsRead = suma de
-- todos los buckets), qué hojas quedaron ignoradas (protegidas contra
-- archivado automático) y el detalle de conflictos/inválidos para "VER
-- DETALLE" en la UI.
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "blank_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "duplicate_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "reconciled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "ignored_tabs" jsonb;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "sheets_total" integer;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "conflict_samples" jsonb;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "invalid_samples" jsonb;
