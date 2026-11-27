-- genus:reconcile-safe
-- Migración 0099 — Portal de Clientes: latido (heartbeat) del worker de notificaciones push (ADITIVA / IDEMPOTENTE).
--
-- Una sola fila (id = 1) con la última ejecución del worker (cron o disparo inmediato tras un cambio de estado): cuándo corrió,
-- si terminó bien, el resumen (eventos detectados/enviados/fallidos) y el último error. Es solo diagnóstico para Dirección:
-- nunca interviene en Producción ni en el envío.
CREATE TABLE IF NOT EXISTS "portal_push_worker_runs" (
  "id" integer PRIMARY KEY NOT NULL,
  "last_started_at" timestamp with time zone,
  "last_finished_at" timestamp with time zone,
  "last_ok" boolean,
  "last_error" text,
  "last_trigger" text,
  "last_summary" jsonb,
  "last_cron_at" timestamp with time zone,
  "runs_total" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
