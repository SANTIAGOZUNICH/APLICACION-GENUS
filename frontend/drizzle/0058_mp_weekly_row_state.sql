-- genus:reconcile-safe
-- Migración 0058 — Estado administrativo del Control semanal de MP (ADITIVA / IDEMPOTENTE).
-- Tablas NUEVAS: exclusiones de MP por semana, observaciones y decisión de gestión por MP y semana, y producciones
-- excluidas del cálculo de una semana. No tocan stock, lotes, movimientos, fórmulas, OE ni controles existentes.
CREATE TABLE IF NOT EXISTS "mp_weekly_row_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "week_start" date NOT NULL,
  "row_key" text NOT NULL,
  "material_label" text NOT NULL DEFAULT '',
  "excluded" boolean NOT NULL DEFAULT false,
  "excluded_by" text,
  "excluded_at" timestamp with time zone,
  "excluded_production_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "excluded_requerido" double precision,
  "observacion" text NOT NULL DEFAULT '',
  "observacion_by" text,
  "observacion_at" timestamp with time zone,
  "gestion" text NOT NULL DEFAULT '',
  "gestion_by" text,
  "gestion_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_weekly_row_state_week_key_uq" ON "mp_weekly_row_state" ("week_start", "row_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_weekly_production_exclusions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "week_start" date NOT NULL,
  "work_item_id" text NOT NULL,
  "label" text NOT NULL DEFAULT '',
  "excluded_by" text NOT NULL,
  "excluded_at" timestamp with time zone NOT NULL DEFAULT now(),
  "reason" text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_weekly_production_exclusions_uq" ON "mp_weekly_production_exclusions" ("week_start", "work_item_id");
