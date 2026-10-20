-- genus:reconcile-safe
-- Migración 0062 — Control de facturación (ADITIVA / IDEMPOTENTE). Administración registra, fuera del sistema fiscal,
-- qué entregas reales ya facturó. Una factura puede cubrir varias entregas/productos y una entrega puede facturarse en
-- partes. NO guarda importes ni precios; NO crea movimientos de stock ni modifica entregas, remitos o producción.
-- Sin FKs a propósito: delivery_line_id / work_item_id apuntan a work_item_delivery_lines / work_items para trazabilidad.
CREATE TABLE IF NOT EXISTS "billing_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client" text NOT NULL,
  "client_norm" text NOT NULL,
  "invoice_number" text NOT NULL,
  "invoice_number_norm" text NOT NULL,
  "invoice_date" date NOT NULL,
  "observations" text,
  "status" text DEFAULT 'ACTIVA' NOT NULL,
  "idempotency_key" text,
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "annulled_at" timestamp with time zone,
  "annulled_by" text,
  "annul_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_invoices_client_number_uidx" ON "billing_invoices" ("client_norm", "invoice_number_norm");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_invoices_idem_uidx" ON "billing_invoices" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoices_date_idx" ON "billing_invoices" ("invoice_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_invoice_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL,
  "delivery_line_id" uuid NOT NULL,
  "work_item_id" uuid NOT NULL,
  "quantity" double precision NOT NULL,
  "status" text DEFAULT 'ACTIVA' NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoice_lines_invoice_idx" ON "billing_invoice_lines" ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoice_lines_delivery_idx" ON "billing_invoice_lines" ("delivery_line_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoice_lines_work_item_idx" ON "billing_invoice_lines" ("work_item_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_invoice_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoice_events_invoice_idx" ON "billing_invoice_events" ("invoice_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_work_notes" (
  "work_item_id" uuid PRIMARY KEY NOT NULL,
  "observations" text,
  "updated_by" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
