-- genus:reconcile-safe
-- Migración 0065 — Control semanal de MP guardado (ADITIVA / IDEMPOTENTE).
-- Un registro por semana: el resultado de «Materias primas a resolver» tal como estaba al guardar el control
-- (quién, cuándo y los valores). Es una foto histórica: no modifica stock, fórmulas, OE, controles ni movimientos, y el
-- stock que cambie después se muestra aparte (disponibilidad actual) sin reescribir lo guardado.
CREATE TABLE IF NOT EXISTS "mp_weekly_saved_controls" (
  "week_start" date PRIMARY KEY NOT NULL,
  "snapshot" jsonb NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "saved_by" text NOT NULL,
  "saved_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
