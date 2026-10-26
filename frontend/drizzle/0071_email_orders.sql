-- genus:reconcile-safe
-- Migración 0071 — Importación de pedidos desde email (piloto, Gmail solo lectura). ADITIVA / IDEMPOTENTE: tablas nuevas.
-- No modifica pedidos, stock, OE/OA, trabajos ni entregas: los borradores solo crean un pedido cuando Producción aprueba.
-- Una sentencia por bloque: el migrador de producción ejecuta cada una por separado.
CREATE TABLE IF NOT EXISTS "email_integrations" (
  "id" text PRIMARY KEY,
  "provider" text NOT NULL DEFAULT 'gmail',
  "account_email" text NOT NULL,
  "refresh_token_enc" text,
  "scope" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'desconectado',
  "connected_by" text,
  "connected_at" timestamptz,
  "disconnected_by" text,
  "disconnected_at" timestamptz,
  "last_error" text,
  "last_analyzed_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_order_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gmail_message_id" text NOT NULL,
  "gmail_thread_id" text,
  "from_addr" text,
  "subject" text,
  "received_at" timestamptz,
  "classification" text,
  "outcome" text NOT NULL,
  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error" text,
  "ai_ms" integer,
  "analyzed_by" text,
  "analyzed_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_order_messages_gmail_uidx" ON "email_order_messages" ("gmail_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_order_messages_thread_idx" ON "email_order_messages" ("gmail_thread_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_order_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gmail_message_id" text NOT NULL,
  "gmail_thread_id" text,
  "kind" text NOT NULL DEFAULT 'NUEVO',
  "status" text NOT NULL DEFAULT 'PENDIENTE',
  "payload" jsonb NOT NULL,
  "original" jsonb NOT NULL,
  "source" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "related" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "was_edited" boolean NOT NULL DEFAULT false,
  "reviewed_by" text,
  "reviewed_at" timestamptz,
  "discard_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_order_drafts_gmail_uidx" ON "email_order_drafts" ("gmail_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_order_drafts_status_idx" ON "email_order_drafts" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_order_drafts_thread_idx" ON "email_order_drafts" ("gmail_thread_id");
