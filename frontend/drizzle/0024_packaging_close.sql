-- Migración 0024 — Cierre físico de acondicionamiento (Envasado/Codificado).
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0021/0023).
--
-- packing_groups (jsonb, ya existente desde 0014) sigue siendo la fuente
-- canónica de la distribución en cajas — no se crea una tabla física
-- paralela para eso (ver informe de esta fase para la justificación).
-- Lo nuevo acá es exclusivamente "muestras" y el snapshot de cierre.
--
-- sample_units / deliverable_units / packaging_closed_at / packaging_closed_by
-- son NULLABLE sin default: un trabajo histórico sin cierre registrado es
-- "desconocido", nunca "0" — no se infieren valores retroactivos.
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "sample_units" integer;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "deliverable_units" double precision;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "packaging_closed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "packaging_closed_by" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  DROP CONSTRAINT IF EXISTS "work_items_sample_units_non_negative";
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD CONSTRAINT "work_items_sample_units_non_negative" CHECK (
    "sample_units" IS NULL OR "sample_units" >= 0
  );
--> statement-breakpoint
ALTER TABLE "work_items"
  DROP CONSTRAINT IF EXISTS "work_items_deliverable_units_non_negative";
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD CONSTRAINT "work_items_deliverable_units_non_negative" CHECK (
    "deliverable_units" IS NULL OR "deliverable_units" >= 0
  );
