-- Migración 0035 — VTO dd/mm/aa + filas auxiliares (hotfix reproducción real).
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0034).
--
-- Nueva columna de reconciliación: cuántas filas sin N° LOTE (notas/filas
-- auxiliares de la planilla, ej. "AGU DEL SECTOR DE ELABORACION") se
-- ignoraron justificadamente en una corrida de sync — nunca se cuentan
-- como inválidas.
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "auxiliary_count" integer NOT NULL DEFAULT 0;
