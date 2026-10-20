-- genus:reconcile-safe
-- Migración 0064 — Marcas de remito por entrega (ADITIVA / IDEMPOTENTE).
-- «Quitar de pendientes» (la entrega deja de ofrecerse en Generar remitos, reversible) y «Marcar como remito ya creado»
-- (el remito se hizo por fuera de GENUS OS: número/fecha opcionales; NO crea un remito ficticio ni consume numeración).
-- No modifica entregas, remitos, facturas ni stock: es una capa aparte con su historial de eventos.
CREATE TABLE IF NOT EXISTS "delivery_remito_marks" (
  "delivery_line_id" uuid PRIMARY KEY NOT NULL,
  "mark" text NOT NULL,
  "external_remito_number" text,
  "external_remito_date" date,
  "notes" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_remito_marks_active_idx" ON "delivery_remito_marks" ("active", "mark");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_remito_mark_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_line_id" uuid NOT NULL,
  "action" text NOT NULL,
  "actor" text NOT NULL,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_remito_mark_events_line_idx" ON "delivery_remito_mark_events" ("delivery_line_id", "created_at");
