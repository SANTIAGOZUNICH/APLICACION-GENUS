-- genus:reconcile-safe
-- Migración 0100 — Portal de Clientes: envío REAL por cliente piloto, resultado por dispositivo y acuse de recepción (ADITIVA / IDEMPOTENTE).
-- No modifica ni borra datos; no toca ninguna tabla operativa.
--
--  - portal_push_client_pilot.real_send_enabled: «Envío REAL a este cliente (prueba)». Lo habilita SOLO Dirección, por cliente: permite el
--    envío real a ESE cliente aunque el interruptor global siga apagado (el resto de los clientes sigue en modo simulado).
--  - portal_push_subscriptions: última verificación del dispositivo, si la suscripción se creó con otra clave VAPID, y el motivo de
--    invalidez cuando el servicio push la rechaza de forma permanente (401/403).
--  - portal_push_deliveries: resultado de CADA intento por dispositivo: «aceptado por el servicio push» (HTTP 2xx) y, aparte,
--    «recepción comprobada en el dispositivo» (acuse que manda el service worker al mostrar la notificación).
--  - portal_push_worker_runs: resultado del último cron (corrió / terminó bien / error), separado del disparo inmediato.
ALTER TABLE "portal_push_client_pilot" ADD COLUMN IF NOT EXISTS "real_send_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "portal_push_client_pilot" ADD COLUMN IF NOT EXISTS "real_send_enabled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "portal_push_client_pilot" ADD COLUMN IF NOT EXISTS "real_send_enabled_by" text;
--> statement-breakpoint
ALTER TABLE "portal_push_subscriptions" ADD COLUMN IF NOT EXISTS "last_verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "portal_push_subscriptions" ADD COLUMN IF NOT EXISTS "key_mismatch" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "portal_push_subscriptions" ADD COLUMN IF NOT EXISTS "invalid_reason" text;
--> statement-breakpoint
ALTER TABLE "portal_push_subscriptions" ADD COLUMN IF NOT EXISTS "invalidated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "portal_push_subscriptions" ADD COLUMN IF NOT EXISTS "last_status" integer;
--> statement-breakpoint
ALTER TABLE "portal_push_worker_runs" ADD COLUMN IF NOT EXISTS "last_cron_ok" boolean;
--> statement-breakpoint
ALTER TABLE "portal_push_worker_runs" ADD COLUMN IF NOT EXISTS "last_cron_error" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_push_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "outbox_id" uuid NOT NULL REFERENCES "portal_push_outbox"("id"),
  "client_id" uuid NOT NULL REFERENCES "portal_clients"("id"),
  "subscription_id" uuid NOT NULL,
  "endpoint_host" text,
  "result" text NOT NULL CHECK ("result" in ('ACEPTADO', 'ERROR', 'BAJA')),
  "http_status" integer,
  "error" text,
  "attempts" integer NOT NULL DEFAULT 1,
  "attempted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "acked_at" timestamp with time zone,
  "ack_agent" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_push_deliveries_outbox_sub_uidx" ON "portal_push_deliveries" ("outbox_id", "subscription_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_push_deliveries_client_idx" ON "portal_push_deliveries" ("client_id", "attempted_at");
