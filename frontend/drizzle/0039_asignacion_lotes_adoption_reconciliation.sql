-- Migración 0039 — Adopción de registros históricos manuales/Excel +
-- aislamiento de errores por fila (hotfix "RECONCILIAR DATOS HISTÓRICOS").
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0038).
--
-- 1) Google Sheets pasa a ser fuente de verdad para los spreadsheets
--    oficiales: cuando una fila de Google coincide inequívocamente (mismo
--    lote+codigo+producto, o lote+marca cuando código/producto históricos
--    estaban vacíos) con un registro YA cargado manualmente o pegado desde
--    Excel (sourceId null), ese registro se ADOPTA — se actualiza con los
--    datos de Google y se vincula a la fuente, en vez de quedar bloqueado
--    para siempre como "conflicto". `adopted_from_manual`/`adopted_at`
--    conservan la trazabilidad de que originalmente fue manual.
-- 2) Aislamiento por fila: antes, una excepción al procesar UNA fila de una
--    hoja podía abortar el resto de esa hoja silenciosamente, dejando
--    filas ya contadas en rowsRead sin ningún bucket conocido
--    ("sin resultado conocido" — demostrado en Production, 2025: 102
--    filas). Ahora cada fila que falla cae en error_count/error_samples,
--    nunca desaparece de la reconciliación.
--> statement-breakpoint
ALTER TABLE "asignacion_lotes"
  ADD COLUMN IF NOT EXISTS "adopted_from_manual" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "asignacion_lotes"
  ADD COLUMN IF NOT EXISTS "adopted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "adopted_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "adopted_samples" jsonb;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "error_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "error_samples" jsonb;
