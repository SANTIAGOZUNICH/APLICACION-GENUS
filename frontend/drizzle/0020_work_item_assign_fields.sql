/**
 * Migración 0020 — Assign packaging/order columns + CODIFICADO check + lotes delete audit.
 *
 * Additive / idempotent. Does NOT touch formula tables.
 *
 * Rollback (manual):
 *   ALTER TABLE work_items DROP CONSTRAINT IF EXISTS work_items_sector_assignment;
 *   -- restore previous CHECK without CODIFICADO
 *   ALTER TABLE work_items DROP COLUMN IF EXISTS order_id;
 *   ALTER TABLE work_items DROP COLUMN IF EXISTS order_number;
 *   ALTER TABLE work_items DROP COLUMN IF EXISTS delivery_date;
 *   ALTER TABLE asignacion_lotes DROP COLUMN IF EXISTS deleted_reason;
 */
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "order_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "order_number" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "delivery_date" date;
--> statement-breakpoint
ALTER TABLE "work_items"
  DROP CONSTRAINT IF EXISTS "work_items_sector_assignment";
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD CONSTRAINT "work_items_sector_assignment" CHECK (
    (
      ("sector" = 'ELABORACION' AND "line" IS NULL AND "branch_owner" IS NOT NULL)
      OR ("sector" = 'ENVASADO_MASIVO' AND "branch_owner" IS NULL AND "line" IN ('Línea 1', 'Línea 2', 'Línea 3', 'Línea 4'))
      OR ("sector" = 'ENVASADO_PREMIUM' AND "branch_owner" IS NULL AND "line" IN ('Línea 1', 'Línea 2'))
      OR ("sector" = 'CODIFICADO' AND "line" IS NULL AND "branch_owner" IS NULL)
    )
  );
--> statement-breakpoint
ALTER TABLE "asignacion_lotes"
  ADD COLUMN IF NOT EXISTS "deleted_reason" text;
