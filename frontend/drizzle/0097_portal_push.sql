-- genus:reconcile-safe
-- Migración 0097 — Portal de Clientes: notificaciones Web Push + modalidad piloto (ADITIVA / IDEMPOTENTE).
-- No modifica ninguna tabla operativa. Postgres es la única fuente de verdad: configuración, suscripciones, estado ya
-- notificado por pedido, cola (outbox) con idempotencia y lecturas del historial.
--
--  - portal_push_settings: configuración global (una sola fila, id = 1, se crea al primer uso). `global_send_enabled` es el
--    interruptor de envío REAL (por defecto apagado: el worker registra los eventos como «simulados» sin llamar a web-push).
--    `elaboracion_days` / `envasado_days`: plazos estimados en días hábiles que se informan al cliente (iniciales 8 y 3).
--  - portal_push_client_pilot: habilitación individual del piloto por cliente (al habilitar se hace el «baseline»).
--  - portal_push_subscriptions: dispositivos suscriptos (endpoint único) de un usuario/correo del portal.
--  - portal_push_order_state: último estado comercial ya notificado por pedido (evita retroactivos y reenvíos).
--  - portal_push_outbox: cola persistente; clave única (cliente + pedido + tipo de evento + producto) = idempotencia.
--  - portal_push_reads: lectura del historial por usuario.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_push_settings" (
  "id" smallint PRIMARY KEY DEFAULT 1 NOT NULL CHECK ("id" = 1),
  "global_send_enabled" boolean NOT NULL DEFAULT false,
  "elaboracion_days" integer NOT NULL DEFAULT 8 CHECK ("elaboracion_days" BETWEEN 1 AND 60),
  "envasado_days" integer NOT NULL DEFAULT 3 CHECK ("envasado_days" BETWEEN 1 AND 60),
  "updated_by" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_push_client_pilot" (
  "client_id" uuid PRIMARY KEY NOT NULL REFERENCES "portal_clients"("id"),
  "enabled" boolean NOT NULL DEFAULT false,
  "enabled_at" timestamp with time zone,
  "enabled_by" text,
  "baseline_at" timestamp with time zone,
  "baseline_orders" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "portal_clients"("id"),
  "owner_key" text NOT NULL,
  "user_id" uuid REFERENCES "portal_users"("id"),
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_ok_at" timestamp with time zone,
  "failures" integer NOT NULL DEFAULT 0,
  "last_error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_push_subscriptions_endpoint_uidx" ON "portal_push_subscriptions" ("endpoint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_push_subscriptions_client_idx" ON "portal_push_subscriptions" ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_push_subscriptions_owner_idx" ON "portal_push_subscriptions" ("owner_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_push_order_state" (
  "client_id" uuid NOT NULL REFERENCES "portal_clients"("id"),
  "order_key" text NOT NULL,
  "order_ref" text,
  "last_rank" integer NOT NULL,
  "baseline" boolean NOT NULL DEFAULT false,
  "last_notified_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("client_id", "order_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_push_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "portal_clients"("id"),
  "order_key" text NOT NULL,
  "order_ref" text,
  "order_opaque_id" text,
  "product_key" text NOT NULL DEFAULT '',
  "event_type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "url" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDIENTE' CHECK ("status" in ('PENDIENTE', 'PROCESANDO', 'ENVIADA', 'SIN_DISPOSITIVOS', 'SIMULADA', 'FALLIDA', 'EXPIRADA')),
  "mode" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "claimed_at" timestamp with time zone,
  "sent_count" integer NOT NULL DEFAULT 0,
  "failed_count" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_push_outbox_dedupe_uidx" ON "portal_push_outbox" ("client_id", "order_key", "event_type", "product_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_push_outbox_pending_idx" ON "portal_push_outbox" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_push_outbox_client_idx" ON "portal_push_outbox" ("client_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_push_reads" (
  "owner_key" text NOT NULL,
  "outbox_id" uuid NOT NULL REFERENCES "portal_push_outbox"("id"),
  "read_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("owner_key", "outbox_id")
);
