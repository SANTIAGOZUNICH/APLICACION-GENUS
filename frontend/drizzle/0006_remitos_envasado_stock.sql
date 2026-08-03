-- 0006: Remitos (envasado/stock) — metadata Neon; binarios en Google Drive.
-- NO APLICAR aún en Neon de producción/preview hasta autorización explícita
-- (APPLY_MIGRATION_0006=1). Compatible con 0001–0005; no borra tablas existentes.
--
-- Packaging / envasado fields (cajas UPC, etc.): por ahora viven en el JSON de
-- work items / completion events. No se agregan columnas de packaging aquí.

-- ========== REMITOS ==========
CREATE TABLE IF NOT EXISTS "remitos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "remito_number" text,
  "client_id_normalized" text NOT NULL,
  "client_display" text NOT NULL,
  "delivery_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'BORRADOR',
  "version" integer NOT NULL DEFAULT 1,
  "total_units" double precision NOT NULL DEFAULT 0,
  "total_cajas" double precision NOT NULL DEFAULT 0,
  "total_bultos" double precision NOT NULL DEFAULT 0,
  "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" text,
  "created_by_sector" text,
  "updated_by" text,
  "generated_by" text,
  "audit" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "generated_at" timestamp with time zone,
  CONSTRAINT "remitos_status_chk" CHECK (
    "status" IN ('BORRADOR', 'GENERADO', 'ANULADO', 'ARCHIVADO')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "remitos_client_date_version_uidx"
  ON "remitos" ("client_id_normalized", "delivery_date", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remitos_client_delivery_idx"
  ON "remitos" ("client_id_normalized", "delivery_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remitos_status_idx"
  ON "remitos" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remitos_number_idx"
  ON "remitos" ("remito_number");
--> statement-breakpoint

-- ========== LÍNEAS ==========
CREATE TABLE IF NOT EXISTS "remito_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "remito_id" uuid NOT NULL REFERENCES "remitos"("id") ON DELETE CASCADE,
  "work_item_id" text NOT NULL,
  "product" text NOT NULL DEFAULT '',
  "lote" text NOT NULL DEFAULT '',
  "vto" text NOT NULL DEFAULT '',
  "total_units" double precision NOT NULL DEFAULT 0,
  "cajas1" integer NOT NULL DEFAULT 0,
  "unidades1" integer NOT NULL DEFAULT 0,
  "cajas2" integer NOT NULL DEFAULT 0,
  "unidades2" integer NOT NULL DEFAULT 0,
  "sort_order" integer NOT NULL DEFAULT 0,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "remito_lines_remito_work_uidx"
  ON "remito_lines" ("remito_id", "work_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remito_lines_remito_idx"
  ON "remito_lines" ("remito_id");
--> statement-breakpoint

-- ========== LINK GLOBAL: un work item entra en un solo remito activo ==========
CREATE TABLE IF NOT EXISTS "remito_work_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "remito_id" uuid NOT NULL REFERENCES "remitos"("id") ON DELETE CASCADE,
  "work_item_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "remito_work_links_work_item_uidx"
  ON "remito_work_links" ("work_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remito_work_links_remito_idx"
  ON "remito_work_links" ("remito_id");
--> statement-breakpoint

-- ========== VERSIONES (xlsx/pdf en Drive) ==========
CREATE TABLE IF NOT EXISTS "remito_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "remito_id" uuid NOT NULL REFERENCES "remitos"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "drive_file_id_xlsx" text,
  "drive_file_id_pdf" text,
  "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE ("remito_id", "version")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remito_versions_remito_idx"
  ON "remito_versions" ("remito_id");
--> statement-breakpoint

-- ========== ARCHIVOS METADATA ==========
CREATE TABLE IF NOT EXISTS "remito_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "remito_id" uuid NOT NULL REFERENCES "remitos"("id") ON DELETE CASCADE,
  "version_id" uuid REFERENCES "remito_versions"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "drive_file_id" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL DEFAULT 0,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "audit" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "remito_files_kind_chk" CHECK ("kind" IN ('xlsx', 'pdf'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "remito_files_drive_file_uidx"
  ON "remito_files" ("drive_file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remito_files_remito_idx"
  ON "remito_files" ("remito_id");
