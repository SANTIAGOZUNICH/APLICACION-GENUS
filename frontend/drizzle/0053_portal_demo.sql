-- genus:reconcile-safe
-- Migración 0053 — Modo demostración del Portal de Clientes (ADITIVA / IDEMPOTENTE).
-- Crea tablas NUEVAS y aisladas. No tiene vínculo alguno con clientes, pedidos, entregas, stock ni órdenes reales:
-- la demostración usa datos ficticios generados por la aplicación y acá solo viven el token de un solo uso y la sesión demo.
--
--  - portal_demo_tokens: token temporal de un solo uso, emitido a un usuario interno autorizado (solo el hash).
--  - portal_demo_sessions: sesión demo temporal (solo el hash) con el estado ficticio de las recepciones simuladas.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_demo_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "ip_hash" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_demo_tokens_hash_uidx" ON "portal_demo_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_demo_tokens_user_idx" ON "portal_demo_tokens" ("created_by", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_demo_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at" timestamp with time zone,
  "confirmations" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ip_hash" text,
  "user_agent" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_demo_sessions_token_uidx" ON "portal_demo_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_demo_sessions_user_idx" ON "portal_demo_sessions" ("created_by", "created_at");
