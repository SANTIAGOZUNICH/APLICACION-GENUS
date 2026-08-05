/**
 * Migración 0021 — Handoff Envasado→Codificado durable + estados Pedido flujo productivo.
 * ADITIVA / IDEMPOTENTE. Gate: APPLY_MIGRATION_0021=1.
 *
 * - Completa columnas Codificado en work_items (varias ya en 0014; se reaseguran).
 * - home_line / home_branch_owner para cancelar y restaurar Envasado.
 * - revision / cancel / production_pedido_id.
 * - Estados de production_pedidos: EN_ELABORACION, EN_ENVASADO, LISTO_PARA_ENTREGAR.
 * - Auditoría production_pedido_status_events.
 */
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "packaging_total_units" double precision;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "packaging_lote" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "packaging_vto" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "packing_groups" jsonb;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "sent_to_codificado_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "sent_to_codificado_by" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "codificado_origin_sector" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "via_codificado" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "delivered_from_codificado_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "delivered_from_codificado_by" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "codificado_observation" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "bulk_remainder_kg" double precision;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "bulk_remainder_observation" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "bulk_remainder_id" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "home_line" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "home_branch_owner" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "codificado_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "codificado_cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "codificado_cancelled_by" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "codificado_cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "production_pedido_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_via_codificado_idx"
  ON "work_items" ("via_codificado")
  WHERE "via_codificado" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_codificado_origin_idx"
  ON "work_items" ("codificado_origin_sector")
  WHERE "codificado_origin_sector" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_production_pedido_id_idx"
  ON "work_items" ("production_pedido_id");
--> statement-breakpoint
-- Pedidos: ampliar estados del flujo productivo (aliases legacy se migran abajo).
ALTER TABLE "production_pedidos" DROP CONSTRAINT IF EXISTS "production_pedidos_estado_chk";
--> statement-breakpoint
UPDATE "production_pedidos"
SET "estado" = 'EN_ELABORACION'
WHERE "estado" = 'EN_PROCESO';
--> statement-breakpoint
UPDATE "production_pedidos"
SET "estado" = 'LISTO_PARA_ENTREGAR'
WHERE "estado" = 'TERMINADO';
--> statement-breakpoint
ALTER TABLE "production_pedidos"
  ADD CONSTRAINT "production_pedidos_estado_chk" CHECK (
    "estado" IS NULL
    OR "estado" IN (
      'INGRESO',
      'EN_ELABORACION',
      'EN_ENVASADO',
      'LISTO_PARA_ENTREGAR',
      'ENTREGADO',
      -- legacy (lectura defensiva si quedó algo sin migrar)
      'EN_PROCESO',
      'TERMINADO'
    )
  );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_pedido_status_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pedido_id" uuid NOT NULL,
  "work_item_id" uuid,
  "from_estado" text,
  "to_estado" text NOT NULL,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "event" text NOT NULL,
  "motivo" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_pedido_status_events_pedido_idx"
  ON "production_pedido_status_events" ("pedido_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_pedido_status_events_work_item_idx"
  ON "production_pedido_status_events" ("work_item_id");
