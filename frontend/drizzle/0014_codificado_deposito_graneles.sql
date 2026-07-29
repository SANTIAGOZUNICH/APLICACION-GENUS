/**
 * Migración 0014 — Codificado + Depósito Graneles (ADITIVA).
 *
 * NO APLICAR sin autorización explícita: APPLY_MIGRATION_0014=1
 *
 * - Estados / metadatos de flujo Codificado en work_items (columnas opcionales).
 * - Tabla deposito_graneles + auditoría.
 * - Sin DROP/TRUNCATE. Idempotente con IF NOT EXISTS.
 */
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "packaging_total_units" numeric;
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
  ADD COLUMN IF NOT EXISTS "codificado_observation" text;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "bulk_remainder_kg" numeric;
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "bulk_remainder_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deposito_graneles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" text,
  "origin_sector" text,
  "product" text DEFAULT '' NOT NULL,
  "client" text DEFAULT '' NOT NULL,
  "bulk_lot" text DEFAULT '' NOT NULL,
  "kg_available" numeric NOT NULL DEFAULT 0,
  "intake_date" date NOT NULL,
  "reported_by" text NOT NULL,
  "observation" text DEFAULT '' NOT NULL,
  "location" text DEFAULT '' NOT NULL,
  "status" text NOT NULL DEFAULT 'DISPONIBLE',
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "annulled_at" timestamptz,
  "annulled_by" text,
  "annul_reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deposito_graneles_work_item_active_uidx"
  ON "deposito_graneles" ("work_item_id")
  WHERE "work_item_id" IS NOT NULL AND "status" NOT IN ('ANULADO', 'ARCHIVADO');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_graneles_status_idx"
  ON "deposito_graneles" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deposito_graneles_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "granel_id" text NOT NULL,
  "action" text NOT NULL,
  "actor_sector" text NOT NULL,
  "actor_name" text NOT NULL,
  "reason" text,
  "before_kg" numeric,
  "after_kg" numeric,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_graneles_audit_granel_idx"
  ON "deposito_graneles_audit" ("granel_id");
