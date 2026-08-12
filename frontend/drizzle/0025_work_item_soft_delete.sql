-- Migración 0025 — Borrado (soft delete/tombstone) de work_items por Producción.
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0024).
--
-- Producción puede "borrar" trabajos de Elaboración/Envasado Masivo/Envasado
-- Premium/Codificado desde cualquier estado. Nunca es un DELETE físico: se
-- marca deleted_at/deleted_by/delete_reason y las vistas operativas activas
-- excluyen estas filas. Se preserva intacta toda la trazabilidad — OA,
-- packing_groups, muestras, decisiones de Calidad, operational_events y
-- work_item_deliveries — porque la fila de work_items nunca se destruye.
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "deleted_by" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "delete_reason" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_deleted_at_idx" ON "work_items" ("deleted_at");
