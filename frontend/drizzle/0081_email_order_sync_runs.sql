-- genus:reconcile-safe
-- Migración 0081 — Historial de sincronizaciones de pedidos por email (Gmail). ADITIVA / IDEMPOTENTE.
-- Tabla NUEVA: una fila por corrida (manual, automática o de recuperación) con lo que REALMENTE pasó: correos encontrados, analizados,
-- borradores creados, omitidos y con error, y el motivo cuando no se creó nada. No toca pedidos, borradores ni correos existentes.
CREATE TABLE IF NOT EXISTS "email_order_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trigger" text NOT NULL,
  "actor" text,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at" timestamp with time zone,
  "window_days" integer,
  "status" text NOT NULL,
  "reason" text,
  "account_email" text,
  "found" integer NOT NULL DEFAULT 0,
  "scanned" integer NOT NULL DEFAULT 0,
  "analyzed" integer NOT NULL DEFAULT 0,
  "drafts" integer NOT NULL DEFAULT 0,
  "omitted" integer NOT NULL DEFAULT 0,
  "excluded" integer NOT NULL DEFAULT 0,
  "without_order" integer NOT NULL DEFAULT 0,
  "already_processed" integer NOT NULL DEFAULT 0,
  "errors" integer NOT NULL DEFAULT 0,
  "error_items" jsonb NOT NULL DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_order_sync_runs_started_idx" ON "email_order_sync_runs" ("started_at" DESC);
