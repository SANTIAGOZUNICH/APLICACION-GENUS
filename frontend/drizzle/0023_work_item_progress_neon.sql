-- Migración 0023 — Avance operativo durable en Neon (fase de estabilización).
-- ADITIVA / IDEMPOTENTE. No gateada (mismo criterio que 0019/0020/0021: solo
-- ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS, sin backfill destructivo).
--
-- Reemplaza el overlay en memoria de server-operational-state.ts (Map por
-- proceso, se perdía en cold start / no se compartía entre instancias) por
-- columnas reales en work_items + una tabla dedicada de entregas.
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "operational_status" text DEFAULT 'pendiente' NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "finished_qty" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "operational_observation" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "packing_mismatch_observation" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "progress_updated_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "progress_updated_by" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "completed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "completed_by" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "operational_cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "operational_cancelled_by" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "operational_cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "quality_status" text DEFAULT 'pendiente' NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "quality_decided_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "quality_decided_by" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "quality_decided_by_sector" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "quality_observation" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "quality_change_reason" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  DROP CONSTRAINT IF EXISTS "work_items_operational_status_values";
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD CONSTRAINT "work_items_operational_status_values" CHECK (
    "operational_status" IN ('pendiente', 'en_curso', 'bloqueado', 'completo', 'revision', 'entregado', 'cancelado')
  );
--> statement-breakpoint
ALTER TABLE "work_items"
  DROP CONSTRAINT IF EXISTS "work_items_quality_status_values";
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD CONSTRAINT "work_items_quality_status_values" CHECK (
    "quality_status" IN ('pendiente', 'aprobado', 'rechazado')
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_operational_status_idx"
  ON "work_items" ("operational_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_quality_status_idx"
  ON "work_items" ("quality_status")
  WHERE "quality_status" <> 'pendiente';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "work_item_delivery_status" AS ENUM ('ENTREGADO', 'ANULADO', 'REGISTRO_ELIMINADO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE CASCADE,
  "quality_item_id" text,
  "product" text NOT NULL,
  "codigo" text,
  "client" text,
  "lote" text,
  "source_sector" text NOT NULL,
  "quantity" text,
  "unit" text,
  "planned_delivery_date" date,
  "actual_delivered_at" timestamptz NOT NULL,
  "remito" text,
  "received_by" text,
  "observations" text,
  "status" "work_item_delivery_status" NOT NULL DEFAULT 'ENTREGADO',
  "delivered_by" text NOT NULL,
  "delivered_by_sector" text NOT NULL,
  "archived" boolean NOT NULL DEFAULT false,
  "archived_at" timestamptz,
  "archived_by" text,
  "annulled_at" timestamptz,
  "annulled_by" text,
  "annul_reason" text,
  "deleted_at" timestamptz,
  "deleted_by" text,
  "delete_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_item_deliveries_work_item_idx"
  ON "work_item_deliveries" ("work_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_item_deliveries_status_idx"
  ON "work_item_deliveries" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_item_deliveries_active_uidx"
  ON "work_item_deliveries" ("work_item_id")
  WHERE "status" = 'ENTREGADO' AND "archived" = false;
