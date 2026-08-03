/**
 * Migración 0009 — Procedimientos (carpetas/archivos/versiones) + Métricas de envasado.
 *
 * NO APLICAR hasta autorización explícita: APPLY_MIGRATION_0009=1
 * Compatible con 0001–0008; no modifica tablas existentes. Sin DROP/TRUNCATE.
 *
 * Rollback (manual, solo si se aplicó con gate):
 *   DROP TABLE IF EXISTS procedure_audit_events;
 *   DROP TABLE IF EXISTS procedure_file_versions;
 *   DROP TABLE IF EXISTS procedure_files;
 *   DROP TABLE IF EXISTS procedure_folders;
 *   DROP TABLE IF EXISTS packaging_metrics;
 * (orden respeta FKs; blobs en Vercel Blob deben limpiarse aparte)
 */

-- ========== PROCEDURE FOLDERS ==========
CREATE TABLE IF NOT EXISTS "procedure_folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "parent_id" uuid REFERENCES "procedure_folders"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "relative_path" text NOT NULL DEFAULT '/',
  "status" text NOT NULL DEFAULT 'active'
    CHECK ("status" IN ('active', 'archived', 'deleted')),
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "updated_by" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procedure_folders_parent_idx"
  ON "procedure_folders" ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procedure_folders_parent_name_idx"
  ON "procedure_folders" ("parent_id", "name");
--> statement-breakpoint

-- ========== PROCEDURE FILES ==========
CREATE TABLE IF NOT EXISTS "procedure_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "folder_id" uuid NOT NULL REFERENCES "procedure_folders"("id") ON DELETE RESTRICT,
  "display_name" text NOT NULL,
  "relative_path" text NOT NULL DEFAULT '',
  "mime" text NOT NULL DEFAULT 'application/octet-stream',
  "size_bytes" bigint NOT NULL DEFAULT 0,
  "sha256" text NOT NULL DEFAULT '',
  "current_version" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'active'
    CHECK ("status" IN ('active', 'archived', 'deleted')),
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "updated_by" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procedure_files_folder_name_idx"
  ON "procedure_files" ("folder_id", "display_name");
--> statement-breakpoint

-- ========== PROCEDURE FILE VERSIONS ==========
CREATE TABLE IF NOT EXISTS "procedure_file_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "file_id" uuid NOT NULL REFERENCES "procedure_files"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "storage_provider" text NOT NULL DEFAULT 'VERCEL_BLOB_PRIVATE',
  "storage_key" text NOT NULL,
  "original_name" text NOT NULL,
  "display_name" text NOT NULL,
  "mime" text NOT NULL DEFAULT 'application/octet-stream',
  "size_bytes" bigint NOT NULL DEFAULT 0,
  "sha256" text NOT NULL DEFAULT '',
  "change_reason" text,
  "is_current" boolean NOT NULL DEFAULT false,
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE ("file_id", "version")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procedure_file_versions_file_version_idx"
  ON "procedure_file_versions" ("file_id", "version");
--> statement-breakpoint

-- ========== PACKAGING METRICS ==========
CREATE TABLE IF NOT EXISTS "packaging_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sector" text NOT NULL
    CHECK ("sector" IN ('ENVASADO_MASIVO', 'ENVASADO_PREMIUM')),
  "metric_date" date NOT NULL,
  "product" text,
  "units" integer NOT NULL DEFAULT 0 CHECK ("units" >= 0),
  "responsible_display" text NOT NULL DEFAULT '',
  "responsible_key" text NOT NULL DEFAULT '',
  "work_item_id" uuid,
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "updated_by" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "packaging_metrics_sector_date_responsible_idx"
  ON "packaging_metrics" ("sector", "metric_date", "responsible_key");
--> statement-breakpoint

-- ========== PROCEDURE AUDIT EVENTS ==========
CREATE TABLE IF NOT EXISTS "procedure_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procedure_audit_events_entity_idx"
  ON "procedure_audit_events" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procedure_audit_events_created_at_idx"
  ON "procedure_audit_events" ("created_at");
