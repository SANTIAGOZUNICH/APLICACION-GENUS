-- genus:reconcile-safe
-- Migración 0060 — Avisos dirigidos a usuarios (ADITIVA / IDEMPOTENTE).
-- Destinatarios individuales de un aviso, con estado leído/archivado propio de cada persona, y destinatarios
-- individuales opcionales en las notificaciones (null = todo el sector, como hasta ahora). No toca avisos existentes.
CREATE TABLE IF NOT EXISTS "os_internal_message_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" uuid NOT NULL,
  "user_email" text NOT NULL,
  "user_name" text NOT NULL DEFAULT '',
  "sector" text NOT NULL,
  "via" text NOT NULL DEFAULT 'USUARIO',
  "read_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "os_internal_message_users_msg_email_uq" ON "os_internal_message_users" ("message_id", "user_email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "os_internal_message_users_email_idx" ON "os_internal_message_users" ("user_email");
--> statement-breakpoint
ALTER TABLE "os_notifications" ADD COLUMN IF NOT EXISTS "target_emails" jsonb;
