-- Migración 0038 — Hotfix "ASIGNACIÓN DE LOTES SIGUE PERDIENDO LOTES".
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0037).
--
-- 1) Un N° LOTE real nunca se vuelve a perder por un campo secundario
--    incompleto/no parseable (PRODUCTO/VTO/FECHA ANÁLISIS) — se importa
--    igual y queda marcado para revisión en vez de desaparecer.
-- 2) Identidad ampliada de (lote,codigo) a (lote,codigo,producto). Causa
--    demostrada con datos reales (lote G26042, AGOSTO 2026, spreadsheet
--    "Asignación de Lotes 2026"): dos productos DISTINTOS ("MILKY TONNER"/
--    THE MINIMAL CO y "CREMA FACIAL"/KORIDERM) comparten el mismo lote y
--    ambos tienen CODIGO vacío — con (lote,codigo) colapsan a la misma
--    identidad y uno se pierde/pisa al otro. Agregar producto a la clave
--    es seguro: todo dato existente ya cumplía la restricción más chica
--    (lote,codigo), así que trivialmente cumple esta (lote,codigo,
--    producto) más grande — no puede fallar por datos ya cargados.
--> statement-breakpoint
ALTER TABLE "asignacion_lotes"
  ADD COLUMN IF NOT EXISTS "datos_incompletos" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "asignacion_lotes"
  ADD COLUMN IF NOT EXISTS "campos_incompletos" jsonb;
--> statement-breakpoint
DROP INDEX IF EXISTS "asignacion_lotes_lote_codigo_active_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asignacion_lotes_lote_codigo_producto_active_uidx"
  ON "asignacion_lotes" ("lote","codigo","producto")
  WHERE "archived" = false;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "incomplete_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "asignacion_lote_sync_runs"
  ADD COLUMN IF NOT EXISTS "incomplete_samples" jsonb;
