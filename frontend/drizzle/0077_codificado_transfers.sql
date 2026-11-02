-- genus:reconcile-safe
-- Migración 0077 — Entregas parciales de Envasado a CODIFICADO (ADITIVA / IDEMPOTENTE).
-- Tabla NUEVA con un movimiento interno por entrega + columna NUEVA que vincula el trabajo de Codificado con el de Envasado.
-- No toca cantidades, entregas a Producción/cliente ni stock de Depósito.
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "parent_work_item_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_parent_work_item_idx" ON "work_items" ("parent_work_item_id") WHERE "parent_work_item_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_codificado_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Trabajo de Envasado que entrega (origen) y trabajo de Codificado que recibe (destino, uno por origen).
  "work_item_id" uuid NOT NULL,
  "codificado_item_id" uuid NOT NULL,
  "seq" integer NOT NULL,
  "quantity" double precision NOT NULL,
  -- Acumulado entregado a Codificado y saldo (de lo asignado) después de esta entrega.
  "cumulative" double precision NOT NULL,
  "pending" double precision NOT NULL,
  "origin_sector" text NOT NULL,
  "lote" text,
  "vto" text,
  "delivered_by" text NOT NULL,
  "delivered_by_name" text,
  "delivered_by_sector" text NOT NULL,
  "delivered_at" timestamp with time zone NOT NULL DEFAULT now(),
  "idempotency_key" text NOT NULL,
  -- ACTIVA | ANULADA
  "status" text NOT NULL DEFAULT 'ACTIVA',
  "note" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_item_codificado_transfers_idem_uq" ON "work_item_codificado_transfers" ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_item_codificado_transfers_seq_uq" ON "work_item_codificado_transfers" ("work_item_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_item_codificado_transfers_dest_idx" ON "work_item_codificado_transfers" ("codificado_item_id");
