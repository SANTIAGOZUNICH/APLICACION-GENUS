-- 0005: Avisos internos, Control MP v2, movimientos stock MP, COAs metadata.
-- NO APLICAR aún en Neon de producción/preview hasta autorización explícita.
-- Compatible con 0001–0004; no borra ni altera tablas existentes.

-- ========== AVISOS INTERNOS ==========
CREATE TABLE IF NOT EXISTS "os_internal_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "body" text NOT NULL,
  "priority" text NOT NULL DEFAULT 'NORMAL',
  "from_sector" text NOT NULL,
  "from_email" text NOT NULL,
  "to_sectors" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "audit" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "os_internal_messages_from_sector_idx"
  ON "os_internal_messages" ("from_sector");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "os_internal_messages_created_at_idx"
  ON "os_internal_messages" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "os_internal_message_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id" uuid NOT NULL REFERENCES "os_internal_messages"("id") ON DELETE CASCADE,
  "sector" text NOT NULL,
  "read_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE ("message_id", "sector")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "os_internal_message_recipients_sector_idx"
  ON "os_internal_message_recipients" ("sector");
--> statement-breakpoint
-- ========== CONTROL MP (snapshot por control + filas) ==========
CREATE TABLE IF NOT EXISTS "mp_weekly_controls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "status" text NOT NULL DEFAULT 'BORRADOR',
  "client" text NOT NULL DEFAULT '',
  "product" text NOT NULL DEFAULT '',
  "quantity_kg" double precision,
  "linked_oe_id" uuid,
  "drive_file_id" text,
  "drive_modified_time" text,
  "drive_checksum" text,
  "formula_snapshot" jsonb,
  "source" text,
  "created_by" text NOT NULL,
  "updated_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "audit" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_weekly_control_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "control_id" uuid NOT NULL REFERENCES "mp_weekly_controls"("id") ON DELETE CASCADE,
  "sort_order" integer NOT NULL DEFAULT 0,
  "codigo" text NOT NULL DEFAULT '',
  "materia_prima" text NOT NULL DEFAULT '',
  "formula_pct" double precision,
  "kg_necesarios" double precision,
  "kg_editados" double precision,
  "stock_actual" double precision,
  "stock_proyectado" double precision,
  "diferencia" double precision,
  "estado" text NOT NULL DEFAULT 'Sin código',
  "lote" text NOT NULL DEFAULT '',
  "preparado" boolean NOT NULL DEFAULT false,
  "observacion" text NOT NULL DEFAULT '',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_weekly_control_lines_control_idx"
  ON "mp_weekly_control_lines" ("control_id");
--> statement-breakpoint
-- ========== STOCK MP — movimientos / ledger ==========
CREATE TABLE IF NOT EXISTS "mp_stock_balances" (
  "codigo" text PRIMARY KEY,
  "descripcion" text NOT NULL DEFAULT '',
  "saldo_inicial" double precision NOT NULL DEFAULT 0,
  "saldo_inicial_seeded_at" timestamp with time zone,
  "stock_actual" double precision NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "codigo" text NOT NULL,
  "kind" text NOT NULL,
  "quantity" double precision NOT NULL,
  "balance_after" double precision,
  "reason" text NOT NULL DEFAULT '',
  "ref_type" text,
  "ref_id" text,
  "lote" text,
  "proveedor" text,
  "documento" text,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "reversed" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_stock_movements_idempotency_uidx"
  ON "mp_stock_movements" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_stock_movements_codigo_idx"
  ON "mp_stock_movements" ("codigo");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_stock_movements_ref_idx"
  ON "mp_stock_movements" ("ref_type", "ref_id");
--> statement-breakpoint

-- ========== COA metadata (binarios en Drive) ==========
CREATE TABLE IF NOT EXISTS "coa_folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "parent_id" uuid REFERENCES "coa_folders"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "drive_folder_id" text NOT NULL,
  "path" text NOT NULL DEFAULT '/',
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived" boolean NOT NULL DEFAULT false,
  "audit" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coa_folders_drive_folder_uidx"
  ON "coa_folders" ("drive_folder_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coa_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "folder_id" uuid NOT NULL REFERENCES "coa_folders"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL DEFAULT 0,
  "drive_file_id" text NOT NULL,
  "current_version" integer NOT NULL DEFAULT 1,
  "created_by" text NOT NULL,
  "updated_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived" boolean NOT NULL DEFAULT false,
  "audit" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coa_files_drive_file_uidx"
  ON "coa_files" ("drive_file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coa_files_folder_idx"
  ON "coa_files" ("folder_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coa_file_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "file_id" uuid NOT NULL REFERENCES "coa_files"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "drive_file_id" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL DEFAULT 0,
  "uploaded_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "checksum" text,
  UNIQUE ("file_id", "version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "domain" text NOT NULL,
  "action" text NOT NULL,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "entity_id" text,
  "idempotency_key" text,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_audit_events_idempotency_uidx"
  ON "feature_audit_events" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
