-- Banco privado de fórmulas + propuestas (Neon Preview).
-- No contiene datos; el import es proceso técnico privado.
CREATE TABLE IF NOT EXISTS "formula_products" (
  "id" uuid PRIMARY KEY,
  "normalized_client" text NOT NULL,
  "normalized_product" text NOT NULL,
  "display_client" text NOT NULL,
  "display_product" text NOT NULL,
  "product_code" text,
  "active_version_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "formula_products_norm_uidx"
  ON "formula_products" ("normalized_client", "normalized_product");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "formula_versions" (
  "id" uuid PRIMARY KEY,
  "product_id" uuid NOT NULL REFERENCES "formula_products"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "status" text NOT NULL,
  "source_file" text,
  "source_sheet" text,
  "source_modified_at" timestamp with time zone,
  "source_hash" text NOT NULL,
  "semantic_hash" text NOT NULL,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  "percentage_total" text,
  "validation_status" text DEFAULT 'OK' NOT NULL,
  "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "previous_version_id" uuid,
  "conflict_code" text,
  "alt_source_paths" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "formula_ingredients" (
  "id" uuid PRIMARY KEY,
  "formula_version_id" uuid NOT NULL REFERENCES "formula_versions"("id") ON DELETE cascade,
  "position" integer NOT NULL,
  "material_name" text NOT NULL,
  "material_code_or_phase" text,
  "percentage" text,
  "notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "formula_procedure_steps" (
  "id" uuid PRIMARY KEY,
  "formula_version_id" uuid NOT NULL REFERENCES "formula_versions"("id") ON DELETE cascade,
  "position" integer NOT NULL,
  "instruction" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "formula_specifications" (
  "id" uuid PRIMARY KEY,
  "formula_version_id" uuid NOT NULL REFERENCES "formula_versions"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "name" text NOT NULL,
  "expected_value" text,
  "unit" text,
  "notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "formula_import_runs" (
  "id" uuid PRIMARY KEY,
  "source_archive_hash" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "status" text NOT NULL,
  "files_scanned" integer DEFAULT 0 NOT NULL,
  "formulas_detected" integer DEFAULT 0 NOT NULL,
  "inserted" integer DEFAULT 0 NOT NULL,
  "duplicated" integer DEFAULT 0 NOT NULL,
  "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "formula_proposals" (
  "id" uuid PRIMARY KEY,
  "product_id" uuid NOT NULL REFERENCES "formula_products"("id") ON DELETE cascade,
  "proposed_version_id" uuid REFERENCES "formula_versions"("id") ON DELETE set null,
  "status" text DEFAULT 'PENDIENTE' NOT NULL,
  "reason" text,
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operational_orders" ADD COLUMN IF NOT EXISTS "formula_product_id" uuid;
--> statement-breakpoint
ALTER TABLE "operational_orders" ADD COLUMN IF NOT EXISTS "formula_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "operational_orders" ADD COLUMN IF NOT EXISTS "formula_version_hash" text;
