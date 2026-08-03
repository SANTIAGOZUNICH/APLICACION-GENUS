/**
 * Migración 0008 — almacenamiento privado (Vercel Blob) para COA y Remitos.
 * NO aplicar hasta autorización explícita (APPLY_MIGRATION_0008=1).
 * No modifica 0005/0006/0007.
 *
 * Los campos drive_* quedan nullable por compatibilidad; las nuevas cargas
 * usan storage_provider + storage_key (VERCEL_BLOB_PRIVATE).
 */
-- ========== COA folders: virtuales en Neon (sin Drive) ==========
ALTER TABLE "coa_folders"
  ALTER COLUMN "drive_folder_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "coa_folders"
  ADD COLUMN IF NOT EXISTS "storage_provider" text;
--> statement-breakpoint

-- ========== COA files ==========
ALTER TABLE "coa_files"
  ALTER COLUMN "drive_file_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "coa_files"
  ADD COLUMN IF NOT EXISTS "storage_provider" text;
--> statement-breakpoint
ALTER TABLE "coa_files"
  ADD COLUMN IF NOT EXISTS "storage_key" text;
--> statement-breakpoint
ALTER TABLE "coa_files"
  ADD COLUMN IF NOT EXISTS "original_name" text;
--> statement-breakpoint
ALTER TABLE "coa_files"
  ADD COLUMN IF NOT EXISTS "display_name" text;
--> statement-breakpoint
ALTER TABLE "coa_files"
  ADD COLUMN IF NOT EXISTS "sha256" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coa_files_storage_key_idx"
  ON "coa_files" ("storage_key");
--> statement-breakpoint

-- ========== COA file versions ==========
ALTER TABLE "coa_file_versions"
  ALTER COLUMN "drive_file_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "coa_file_versions"
  ADD COLUMN IF NOT EXISTS "storage_provider" text;
--> statement-breakpoint
ALTER TABLE "coa_file_versions"
  ADD COLUMN IF NOT EXISTS "storage_key" text;
--> statement-breakpoint
ALTER TABLE "coa_file_versions"
  ADD COLUMN IF NOT EXISTS "original_name" text;
--> statement-breakpoint
ALTER TABLE "coa_file_versions"
  ADD COLUMN IF NOT EXISTS "display_name" text;
--> statement-breakpoint
ALTER TABLE "coa_file_versions"
  ADD COLUMN IF NOT EXISTS "sha256" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coa_file_versions_storage_key_idx"
  ON "coa_file_versions" ("storage_key");
--> statement-breakpoint

-- ========== Remito versions ==========
ALTER TABLE "remito_versions"
  ADD COLUMN IF NOT EXISTS "storage_provider" text;
--> statement-breakpoint
ALTER TABLE "remito_versions"
  ADD COLUMN IF NOT EXISTS "storage_key_xlsx" text;
--> statement-breakpoint
ALTER TABLE "remito_versions"
  ADD COLUMN IF NOT EXISTS "storage_key_pdf" text;
--> statement-breakpoint
ALTER TABLE "remito_versions"
  ADD COLUMN IF NOT EXISTS "sha256_xlsx" text;
--> statement-breakpoint
ALTER TABLE "remito_versions"
  ADD COLUMN IF NOT EXISTS "sha256_pdf" text;
--> statement-breakpoint

-- ========== Remito files ==========
ALTER TABLE "remito_files"
  ALTER COLUMN "drive_file_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "remito_files"
  ADD COLUMN IF NOT EXISTS "storage_provider" text;
--> statement-breakpoint
ALTER TABLE "remito_files"
  ADD COLUMN IF NOT EXISTS "storage_key" text;
--> statement-breakpoint
ALTER TABLE "remito_files"
  ADD COLUMN IF NOT EXISTS "original_name" text;
--> statement-breakpoint
ALTER TABLE "remito_files"
  ADD COLUMN IF NOT EXISTS "display_name" text;
--> statement-breakpoint
ALTER TABLE "remito_files"
  ADD COLUMN IF NOT EXISTS "sha256" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remito_files_storage_key_idx"
  ON "remito_files" ("storage_key");
