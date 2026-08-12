-- Migración 0027 — Acción "Rehacer" (Calidad y Producción). ADITIVA /
-- IDEMPOTENTE / sin gate (mismo criterio que 0019-0026).
--
-- Rehacer devuelve un work_item al sector que lo envió (sector NO cambia,
-- solo se reabre) — distinto de qualityStatus='rechazado' (decisión formal)
-- y distinto de un work_item nuevo (mismo id, mismo OA/lote/VTO/historial).
-- Se implementa reutilizando operationalStatus/completedAt/
-- deliveredFromCodificadoAt existentes (ver reworkWorkItemDurable) más estas
-- 4 columnas nuevas, solo para que el sector que recibe el trabajo de vuelta
-- pueda ver quién lo pidió, cuándo y por qué sin tener que consultar
-- operational_events.
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "rework_requested_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "rework_requested_by" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "rework_requested_by_sector" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "rework_reason" text;
