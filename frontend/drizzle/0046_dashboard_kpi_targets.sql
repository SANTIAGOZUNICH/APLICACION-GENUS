-- genus:reconcile-safe
-- Migración 0046 — Objetivos de los indicadores del Dashboard operativo (semáforo).
-- ADITIVA / IDEMPOTENTE: solo crea una tabla nueva; no toca pedidos, trabajos, entregas, stock ni remitos.
-- No se carga ningún objetivo: la tabla nace vacía y Producción/Dirección los definen desde el Dashboard.
-- Sin fila para un indicador => el semáforo muestra «Sin objetivo definido».
-- direction: 'min' = mejor cuanto MÁS alto (cumple si resultado >= objetivo); 'max' = mejor cuanto MÁS bajo.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_kpi_targets" (
  "key" text PRIMARY KEY NOT NULL,
  "target_value" double precision NOT NULL,
  "direction" text NOT NULL,
  "unit" text NOT NULL,
  "updated_by" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "dashboard_kpi_targets_direction_check" CHECK ("direction" IN ('min', 'max'))
);
