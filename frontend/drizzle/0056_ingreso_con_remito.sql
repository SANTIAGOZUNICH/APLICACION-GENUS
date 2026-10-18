-- genus:reconcile-safe
-- Migración 0056 — Ingreso de MP / ME con foto de remito (recepciones).
-- ADITIVA / IDEMPOTENTE: crea tablas nuevas y una columna nueva en inventory_ingreso_adjuntos. No toca datos ni stock.
-- El STOCK sigue saliendo del mecanismo existente (inv_mp_* + libro mayor MP / inv_me_ingresos). Estas tablas solo guardan
-- el comprobante (foto/PDF), el borrador de revisión y el vínculo recepción → ingresos creados.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "module" text NOT NULL,
  "status" text NOT NULL DEFAULT 'BORRADOR',
  "supplier" text NOT NULL DEFAULT '',
  "supplier_key" text NOT NULL DEFAULT '',
  "remito_number" text NOT NULL DEFAULT '',
  "remito_key" text NOT NULL DEFAULT '',
  "remito_date" text NOT NULL DEFAULT '',
  "received_date" text NOT NULL DEFAULT '',
  "notes" text NOT NULL DEFAULT '',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "parent_receipt_id" uuid,
  "confirm_key" text,
  "ingreso_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_by" text,
  "confirmed_at" timestamp with time zone,
  "discarded_by" text,
  "discarded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_receipts_remito_idx" ON "inventory_receipts" ("module","supplier_key","remito_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_receipts_status_idx" ON "inventory_receipts" ("module","status","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_receipts_confirm_key_uidx" ON "inventory_receipts" ("confirm_key") WHERE "confirm_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_receipt_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "receipt_id" uuid NOT NULL,
  "module" text NOT NULL,
  "line_no" integer NOT NULL,
  "supplier_code" text NOT NULL DEFAULT '',
  "supplier_code_key" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "material_code" text NOT NULL,
  "material_label" text NOT NULL DEFAULT '',
  "remito_quantity" double precision,
  "quantity" double precision NOT NULL,
  "unit" text NOT NULL DEFAULT '',
  "packages" double precision,
  "lote" text NOT NULL DEFAULT '',
  "vencimiento" text NOT NULL DEFAULT '',
  "notes" text NOT NULL DEFAULT '',
  "ingreso_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_receipt_lines_receipt_idx" ON "inventory_receipt_lines" ("receipt_id","line_no");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_receipt_lines_ingreso_uidx" ON "inventory_receipt_lines" ("module","ingreso_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_receipt_lines_material_idx" ON "inventory_receipt_lines" ("module","material_code");
--> statement-breakpoint
ALTER TABLE "inventory_ingreso_adjuntos" ADD COLUMN IF NOT EXISTS "receipt_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_ingreso_adjuntos_receipt_idx" ON "inventory_ingreso_adjuntos" ("receipt_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_ingreso_adjuntos_sha_idx" ON "inventory_ingreso_adjuntos" ("module","sha256");
