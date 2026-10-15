-- genus:reconcile-safe
-- Migración 0050 — Calendario de Entregas: correcciones de Producción.
-- ADITIVA / IDEMPOTENTE: crea UNA tabla nueva y agrega UNA columna. No borra, no reescribe ni reinterpreta datos
-- existentes. No toca work_items, entregas REALES (work_item_deliveries / work_item_delivery_lines), stock ni MP.
--
--  - delivery_calendar_hidden: Producción quita del calendario la aparición «Desde trabajo» de un trabajo (su fecha de
--    entrega programada) con motivo. Es lógica: el trabajo no se toca, la fila queda como historial y se puede restaurar
--    (restored_at). Mientras esté activa, la aparición NO vuelve a mostrarse aunque el trabajo siga teniendo fecha.
--    Las entregas REALES del trabajo siguen viéndose siempre (no se borran desde el calendario).
--  - scheduled_delivery_items.deleted_reason: motivo de la baja lógica de un producto programado (ya existía deleted_at).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_calendar_hidden" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id"),
  "reason" text NOT NULL,
  "hidden_by" text NOT NULL,
  "hidden_by_sector" text NOT NULL,
  "hidden_at" timestamp with time zone NOT NULL DEFAULT now(),
  "restored_at" timestamp with time zone,
  "restored_by" text,
  "restore_reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_calendar_hidden_active_uidx" ON "delivery_calendar_hidden" ("work_item_id") WHERE "restored_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "scheduled_delivery_items" ADD COLUMN IF NOT EXISTS "deleted_reason" text;
