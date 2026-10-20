-- genus:reconcile-safe
-- Migración 0066 — Control semanal de MP guardado POR CONTROL (ADITIVA / IDEMPOTENTE).
-- Una fila por control guardado (fórmula + producción): cliente, producto, kg y las MP faltantes de ESE control tal como
-- estaban al guardar. Reemplaza el resultado consolidado por semana de 0065 (esa tabla se conserva sin cambios: no se
-- borra nada). No modifica stock, fórmulas, OE, controles ni movimientos.
CREATE TABLE IF NOT EXISTS "mp_weekly_saved_product_controls" (
  "control_id" uuid PRIMARY KEY NOT NULL,
  "week_start" date NOT NULL,
  "client" text NOT NULL DEFAULT '',
  "product" text NOT NULL DEFAULT '',
  "quantity_kg" numeric,
  "linked_oe" text,
  "snapshot" jsonb NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "saved_by" text NOT NULL,
  "saved_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_weekly_saved_product_controls_week_idx" ON "mp_weekly_saved_product_controls" ("week_start");
