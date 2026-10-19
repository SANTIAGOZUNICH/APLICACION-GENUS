-- genus:reconcile-safe
-- Migración 0057 — Equivalencias aprobadas de materias primas (ADITIVA / IDEMPOTENTE).
-- Tabla NUEVA: relaciona códigos/nombres de las fórmulas (y códigos de inventario de otros proveedores) con el código
-- maestro de inventario de una misma materia prima. No modifica stock, lotes, movimientos ni fórmulas.
CREATE TABLE IF NOT EXISTS "mp_master_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "key" text NOT NULL,
  "master_code" text NOT NULL,
  "approved_by" text NOT NULL,
  "approved_at" timestamp with time zone NOT NULL DEFAULT now(),
  "note" text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_master_links_kind_key_uq" ON "mp_master_links" ("kind", "key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_master_links_master_idx" ON "mp_master_links" ("master_code");
