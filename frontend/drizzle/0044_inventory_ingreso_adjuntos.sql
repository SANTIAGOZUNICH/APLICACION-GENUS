-- genus:reconcile-safe
-- Migración 0044 — Fotos/archivos de remito adjuntos a los ingresos de MP y de ME.
-- ADITIVA / IDEMPOTENTE: solo crea una tabla nueva con sus índices; no toca datos existentes ni el stock.
-- Por qué es una tabla aparte: editar un ingreso reconstruye su payload; las fotos no deben perderse al editar.
-- Los archivos viven en Vercel Blob privado (storage_key); acá solo la referencia, quién la subió y cuándo.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_ingreso_adjuntos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "module" text NOT NULL,
  "ingreso_id" uuid NOT NULL,
  "storage_provider" text NOT NULL,
  "storage_key" text NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "uploaded_by" text NOT NULL,
  "uploaded_by_sector" text NOT NULL,
  "uploaded_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "deleted_by" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_ingreso_adjuntos_ingreso_idx" ON "inventory_ingreso_adjuntos" ("module","ingreso_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_ingreso_adjuntos_storage_key_uidx" ON "inventory_ingreso_adjuntos" ("storage_key");
