-- genus:reconcile-safe
-- Migración 0051 — Fórmulas: índice persistente de la carpeta NUEVA de Drive y vínculos explícitos.
-- ADITIVA / IDEMPOTENTE: crea tres tablas nuevas. No borra, no reescribe ni reinterpreta datos existentes. No toca
-- órdenes (OE/OA emitidas), el banco de fórmulas, work_items, stock, consumos de MP ni lotes.
--
--  - formula_drive_sync_runs: cada actualización del índice (manual, automática o por cron) con su resultado. Una
--    ejecución «ok» sobre la carpeta nueva es la validación que apaga la búsqueda en la ubicación anterior.
--  - formula_drive_index: un registro por archivo (.xlsx/.xls/Google Sheet) visto en la carpeta nueva, con su carpeta
--    de cliente, claves normalizadas y marcas (copia, versión, posible otro cliente…). Un archivo que desaparece de
--    Drive NO se borra: queda con removed_at (trazabilidad de vínculos y OE anteriores).
--  - formula_drive_links: vínculo explícito cliente + producto → archivo, elegido por Producción. Uno activo por par;
--    reemplazar o desvincular conserva la fila anterior (ended_at, motivo).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "formula_drive_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "root_folder_id" text NOT NULL,
  "trigger" text NOT NULL,
  "actor_email" text,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'running',
  "error" text,
  "client_count" integer,
  "file_count" integer,
  "added_count" integer,
  "updated_count" integer,
  "removed_count" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "formula_drive_sync_runs_root_idx" ON "formula_drive_sync_runs" ("root_folder_id", "started_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "formula_drive_index" (
  "file_id" text PRIMARY KEY NOT NULL,
  "root_folder_id" text NOT NULL,
  "client_folder_id" text NOT NULL,
  "client_folder_name" text NOT NULL,
  "client_key" text NOT NULL,
  "sub_path" text NOT NULL DEFAULT '',
  "file_name" text NOT NULL,
  "product_label" text NOT NULL,
  "product_key" text NOT NULL,
  "product_code" text,
  "mime_type" text NOT NULL,
  "modified_time" timestamp with time zone,
  "md5" text,
  "flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "first_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "removed_at" timestamp with time zone,
  "last_run_id" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "formula_drive_index_client_idx" ON "formula_drive_index" ("root_folder_id", "client_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "formula_drive_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_key" text NOT NULL,
  "product_key" text NOT NULL,
  "client_label" text NOT NULL,
  "product_label" text NOT NULL,
  "file_id" text NOT NULL,
  "file_name" text NOT NULL,
  "client_folder_name" text NOT NULL,
  "note" text,
  "linked_by" text NOT NULL,
  "linked_by_sector" text NOT NULL,
  "linked_at" timestamp with time zone NOT NULL DEFAULT now(),
  "ended_at" timestamp with time zone,
  "ended_by" text,
  "end_reason" text,
  "last_validated_at" timestamp with time zone,
  "last_validation" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "formula_drive_links_active_uidx" ON "formula_drive_links" ("client_key", "product_key") WHERE "ended_at" IS NULL;
