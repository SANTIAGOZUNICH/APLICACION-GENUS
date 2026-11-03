-- genus:reconcile-safe
-- Migración 0079 — Trazabilidad de correcciones de entregas internas (editar cantidad/observaciones y cancelar). ADITIVA / IDEMPOTENTE.
-- Tabla NUEVA e inmutable (solo inserts): una fila por modificación, con valores anteriores y nuevos, usuario, sector y motivo.
-- No toca entregas a clientes, remitos ni stock de Depósito. Las entregas canceladas siguen existiendo (status ANULADA / CANCELADA).
CREATE TABLE IF NOT EXISTS "internal_delivery_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- PRODUCCION = línea de entrega a Producción (work_item_delivery_lines); CODIFICADO = entrega a Codificado (work_item_codificado_transfers).
  "kind" text NOT NULL,
  "delivery_id" uuid NOT NULL,
  "work_item_id" uuid NOT NULL,
  -- EDITAR | CANCELAR
  "action" text NOT NULL,
  "old_quantity" double precision,
  "new_quantity" double precision,
  "old_observations" text,
  "new_observations" text,
  -- Realizadas del trabajo antes/después (solo cambia cuando una corrección hacia arriba declara más unidades realizadas).
  "finished_before" text,
  "finished_after" text,
  "reason" text,
  "actor_email" text NOT NULL,
  "actor_name" text,
  "actor_sector" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_delivery_changes_delivery_idx" ON "internal_delivery_changes" ("kind", "delivery_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_delivery_changes_item_idx" ON "internal_delivery_changes" ("work_item_id", "created_at");
