-- genus:reconcile-safe
-- Migración 0047 — Entregas PARCIALES por trabajo (circuito operativo sin Calidad).
-- ADITIVA / IDEMPOTENTE: crea UNA tabla nueva (work_item_delivery_lines) y agrega dos columnas con valor por defecto
-- a work_item_deliveries. No borra, no reescribe ni reinterpreta ningún dato existente: el índice único parcial
-- "work_item_deliveries_active_uidx" (una fila agregada ENTREGADO por trabajo) NO se toca. Cada entrega física
-- (parcial o final) queda como una línea inmutable con su propia clave de idempotencia; la fila agregada de
-- work_item_deliveries sigue siendo la que leen Entregados/Entregas/Dashboard y acumula lo entregado.
-- Las filas históricas de work_item_deliveries quedan con delivery_complete = true (entrega completa) y sin saldo:
-- exactamente lo que representaban hasta hoy. No mueve stock ni consumo de MP.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_delivery_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id"),
  "delivery_id" uuid REFERENCES "work_item_deliveries"("id"),
  "idempotency_key" text NOT NULL,
  "sequence" integer NOT NULL DEFAULT 1,
  "quantity" double precision NOT NULL,
  "unit" text,
  "kind" text NOT NULL DEFAULT 'PARCIAL',
  "status" text NOT NULL DEFAULT 'ACTIVA',
  "source_sector" text NOT NULL,
  "delivered_by" text NOT NULL,
  "delivered_by_sector" text NOT NULL,
  "actual_delivered_at" timestamp with time zone NOT NULL,
  "remito" text,
  "received_by" text,
  "observations" text,
  "cumulative_after" double precision,
  "pending_after" double precision,
  "annulled_at" timestamp with time zone,
  "annulled_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "work_item_delivery_lines_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "work_item_delivery_lines_kind_check" CHECK ("kind" IN ('PARCIAL', 'FINAL')),
  CONSTRAINT "work_item_delivery_lines_status_check" CHECK ("status" IN ('ACTIVA', 'ANULADA'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_item_delivery_lines_key_uidx" ON "work_item_delivery_lines" ("work_item_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_item_delivery_lines_delivery_idx" ON "work_item_delivery_lines" ("delivery_id");
--> statement-breakpoint
ALTER TABLE "work_item_deliveries" ADD COLUMN IF NOT EXISTS "delivery_complete" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "work_item_deliveries" ADD COLUMN IF NOT EXISTS "pending_balance" double precision;
