-- genus:reconcile-safe
-- Migración 0052 — Portal de Clientes (https://laboratoriogenus.com.ar/entregas).
-- ADITIVA / IDEMPOTENTE: crea tablas NUEVAS. No modifica ni reinterpreta ninguna tabla existente (pedidos, trabajos,
-- entregas, órdenes, stock, MP, lotes). El portal LEE los datos operativos de GENUS OS (work_items, entregas reales,
-- pedidos) con consultas de solo lectura: acá solo viven la identidad pública del cliente y lo propio del portal.
--
--  - portal_clients: cliente habilitado, con su código público único («GEN-XXXXXX»). No reemplaza ningún identificador
--    interno: GENUS OS no tiene tabla de clientes (el cliente es texto en los trabajos), así que el vínculo es explícito.
--  - portal_client_aliases: nombres de cliente de GENUS OS (normalizados) que pertenecen a cada cliente del portal. Un
--    nombre pertenece a UN solo cliente (índice único): así dos clientes nunca ven los pedidos del otro.
--  - portal_authorized_emails: correos autorizados por Producción/Dirección para ingresar.
--  - portal_login_challenges / portal_sessions: código temporal o enlace seguro y sesiones (solo hashes, nunca el código).
--  - portal_rate_limits: contadores en base (el servidor es serverless: la memoria no se comparte).
--  - portal_notifications / portal_email_outbox: avisos (sin duplicados) y registro de cada correo (enviado o no).
--  - portal_receipt_confirmations: constancia de recepción del cliente (una por entrega; NO toca stock ni estados).
--  - portal_audit_events: auditoría de accesos y acciones.
--  - portal_holiday_overrides: feriados extra o corridos por decreto para la cuenta de días hábiles.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "public_code" text NOT NULL,
  "display_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVO' CHECK ("status" in ('ACTIVO', 'SUSPENDIDO')),
  "internal_notes" text,
  "version" integer NOT NULL DEFAULT 1,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "modified_at" timestamp with time zone NOT NULL DEFAULT now(),
  "suspended_at" timestamp with time zone,
  "suspended_by" text,
  "suspend_reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_clients_public_code_uidx" ON "portal_clients" ("public_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_client_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "portal_clients"("id"),
  "name_key" text NOT NULL,
  "name_label" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "removed_at" timestamp with time zone,
  "removed_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_client_aliases_active_uidx" ON "portal_client_aliases" ("name_key") WHERE "removed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_client_aliases_client_idx" ON "portal_client_aliases" ("client_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_authorized_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "portal_clients"("id"),
  "email" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVO' CHECK ("status" in ('ACTIVO', 'BLOQUEADO')),
  "added_by" text NOT NULL,
  "added_at" timestamp with time zone NOT NULL DEFAULT now(),
  "invited_at" timestamp with time zone,
  "last_login_at" timestamp with time zone,
  "removed_at" timestamp with time zone,
  "removed_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_authorized_emails_active_uidx" ON "portal_authorized_emails" ("client_id", "email") WHERE "removed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_authorized_emails_email_idx" ON "portal_authorized_emails" ("email");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_login_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "portal_clients"("id"),
  "email" text NOT NULL,
  "code_hash" text NOT NULL,
  "link_hash" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "ip_hash" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_login_challenges_lookup_idx" ON "portal_login_challenges" ("client_id", "email", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_login_challenges_link_uidx" ON "portal_login_challenges" ("link_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "portal_clients"("id"),
  "email" text NOT NULL,
  "token_hash" text NOT NULL,
  "ip_hash" text,
  "user_agent" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at" timestamp with time zone,
  "revoked_reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_sessions_token_uidx" ON "portal_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_sessions_client_idx" ON "portal_sessions" ("client_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_rate_limits" (
  "bucket" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "hits" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("bucket", "window_start")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_email_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid REFERENCES "portal_clients"("id"),
  "kind" text NOT NULL CHECK ("kind" in ('LOGIN', 'INVITACION', 'LISTO_PARA_ENTREGAR', 'RECEPCION')),
  "to_email" text NOT NULL,
  "subject" text NOT NULL,
  "body_text" text NOT NULL,
  "body_html" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDIENTE' CHECK ("status" in ('PENDIENTE', 'ENVIADO', 'SIN_PROVEEDOR', 'ERROR', 'CAPTURADO')),
  "provider" text,
  "provider_message_id" text,
  "error" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "dedupe_key" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_email_outbox_dedupe_uidx" ON "portal_email_outbox" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_email_outbox_status_idx" ON "portal_email_outbox" ("status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "portal_clients"("id"),
  "kind" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "email_outbox_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_notifications_dedupe_uidx" ON "portal_notifications" ("client_id", "dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_notifications_client_idx" ON "portal_notifications" ("client_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_receipt_confirmations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "portal_clients"("id"),
  "delivery_key" text NOT NULL,
  "work_item_id" text NOT NULL,
  "product" text NOT NULL,
  "order_ref" text,
  "quantity" text NOT NULL,
  "unit" text,
  "delivered_at" timestamp with time zone NOT NULL,
  "confirmed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_by_email" text NOT NULL,
  "session_id" uuid,
  "ip_hash" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_receipt_confirmations_key_uidx" ON "portal_receipt_confirmations" ("delivery_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_receipt_confirmations_client_idx" ON "portal_receipt_confirmations" ("client_id", "confirmed_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid,
  "event_type" text NOT NULL,
  "actor_kind" text NOT NULL CHECK ("actor_kind" in ('CLIENTE', 'STAFF', 'SISTEMA')),
  "actor" text,
  "ip_hash" text,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_audit_events_client_idx" ON "portal_audit_events" ("client_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_audit_events_type_idx" ON "portal_audit_events" ("event_type", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_holiday_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "holiday_date" date NOT NULL,
  "name" text NOT NULL,
  "action" text NOT NULL CHECK ("action" in ('AGREGAR', 'QUITAR')),
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_holiday_overrides_active_uidx" ON "portal_holiday_overrides" ("holiday_date") WHERE "removed_at" IS NULL;
