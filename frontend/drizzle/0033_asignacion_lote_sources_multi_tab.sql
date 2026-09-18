-- Migración 0033 — Hoja opcional en fuentes de Asignación de Lotes (multi-tab).
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0032).
--
-- sheet_tab pasa a NULLABLE: null = descubrir e importar TODAS las hojas
-- compatibles del spreadsheet (en vez de exigir una sola). Las fuentes que
-- YA tienen sheet_tab configurado siguen sincronizando exactamente esa
-- hoja, sin cambios — esto solo relaja la restricción, no toca datos.
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sources"
  ALTER COLUMN "sheet_tab" DROP NOT NULL;
--> statement-breakpoint
-- Traza de qué hoja/tab originó cada registro (auditoría/diagnóstico) —
-- nullable, nunca se infiere para registros ya existentes.
ALTER TABLE "asignacion_lotes"
  ADD COLUMN IF NOT EXISTS "source_sheet_tab" text;
