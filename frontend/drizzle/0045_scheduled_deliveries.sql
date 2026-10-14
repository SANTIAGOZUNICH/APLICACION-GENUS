-- genus:reconcile-safe
-- Migración 0045 — Entregas PROGRAMADAS a clientes (calendario de Entregas) y su vínculo con los trabajos.
-- ADITIVA / IDEMPOTENTE: solo crea tablas nuevas con sus índices. No toca work_items, work_item_deliveries (entregas
-- REALES), remitos, OE/OA ni el stock. Programar una entrega NO mueve inventario.
-- El historial/auditoría vive en feature_audit_events (dominio 'entregas'), sin tabla paralela.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client" text NOT NULL,
  "client_key" text NOT NULL,
  "delivery_date" date NOT NULL,
  "responsible" text,
  "notes" text,
  "status" text NOT NULL DEFAULT 'programada',
  "reschedule_count" integer NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 1,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" text,
  "cancel_reason" text,
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "scheduled_deliveries_status_values" CHECK ("status" IN ('programada', 'cancelada'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_deliveries_date_idx" ON "scheduled_deliveries" ("delivery_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_deliveries_client_idx" ON "scheduled_deliveries" ("client_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_delivery_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_id" uuid NOT NULL REFERENCES "scheduled_deliveries"("id"),
  "product" text NOT NULL,
  "quantity" text,
  "unit" text,
  "sector" text,
  "planned_production_date" date,
  "lot" text,
  "vto" text,
  "notes" text,
  "position" integer NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamp with time zone,
  "deleted_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "scheduled_delivery_items_sector_values" CHECK ("sector" IS NULL OR "sector" IN ('ENVASADO_MASIVO', 'ENVASADO_PREMIUM'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_delivery_items_delivery_idx" ON "scheduled_delivery_items" ("delivery_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_delivery_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "item_id" uuid NOT NULL REFERENCES "scheduled_delivery_items"("id"),
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id"),
  "linked_by" text NOT NULL,
  "linked_by_sector" text NOT NULL,
  "linked_at" timestamp with time zone NOT NULL DEFAULT now(),
  "unlinked_at" timestamp with time zone,
  "unlinked_by" text,
  "unlink_reason" text,
  -- Foto de lo programado (cantidad, unidad, lote, vencimiento, fecha de entrega) cuando se vinculó el trabajo: sirve para
  -- avisar SOLO de lo que cambió después de la asignación (nunca por diferencias previas ni por ediciones del operario).
  "item_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_delivery_links_item_idx" ON "scheduled_delivery_links" ("item_id");
--> statement-breakpoint
-- Un trabajo cubre como máximo UN producto de entrega a la vez (no se duplica); un producto puede completarse con varios trabajos.
CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_delivery_links_work_item_active_uidx" ON "scheduled_delivery_links" ("work_item_id") WHERE "unlinked_at" IS NULL;
