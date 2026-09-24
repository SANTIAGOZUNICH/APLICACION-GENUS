-- Migración 0037 — Detalle por hoja de cada sincronización multi-tab.
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0036).
--
-- Complementa ignored_tabs/sheets_total (0034): un jsonb con, por cada hoja
-- SÍ procesada en la corrida, sus propios rowsRead/created/updated/
-- unchanged/invalid/auxiliary/duplicate/conflict — para poder mostrar
-- "SEPTIEMBRE: 91 filas leídas, 90 registros, 1 auxiliar, 0 perdidas" en vez
-- de solo el agregado de todo el spreadsheet.
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "tab_breakdown" jsonb;
