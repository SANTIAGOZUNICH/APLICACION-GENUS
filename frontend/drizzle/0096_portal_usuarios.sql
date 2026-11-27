-- genus:reconcile-safe
-- Migración 0096 — Portal de Clientes: ingreso por USUARIO + CONTRASEÑA (ADITIVA / IDEMPOTENTE).
-- No modifica ni reinterpreta ninguna tabla operativa (pedidos, trabajos, entregas, stock, lotes). El ingreso existente por
-- código de cliente + correo autorizado + código temporal sigue funcionando sin cambios.
--
--  - portal_users: usuario de portal asociado a UN cliente (portal_clients). Nombre de usuario normalizado (minúsculas) único entre los
--    no dados de baja, correo OPCIONAL, hash bcrypt de la contraseña (nunca texto plano), estado ACTIVO/DESACTIVADO, contador de
--    intentos fallidos y bloqueo persistente (locked_until), último acceso y marca de cambio obligatorio de contraseña.
--  - portal_sessions.user_id: sesión abierta por un usuario con contraseña (NULL = sesión por correo, como hasta ahora).
--  - portal_sessions.email pasa a admitir NULL: una sesión de un usuario sin correo no tiene correo que guardar.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "portal_clients"("id"),
  "username" text NOT NULL,
  "display_name" text,
  "email" text,
  "password_hash" text NOT NULL,
  "must_change_password" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'ACTIVO' CHECK ("status" in ('ACTIVO', 'DESACTIVADO')),
  "failed_attempts" integer NOT NULL DEFAULT 0,
  "last_failed_at" timestamp with time zone,
  "locked_until" timestamp with time zone,
  "last_login_at" timestamp with time zone,
  "password_changed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "modified_at" timestamp with time zone NOT NULL DEFAULT now(),
  "removed_at" timestamp with time zone,
  "removed_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_users_username_active_uidx" ON "portal_users" ("username") WHERE "removed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_users_client_idx" ON "portal_users" ("client_id");
--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "portal_users"("id");
--> statement-breakpoint
ALTER TABLE "portal_sessions" ALTER COLUMN "email" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_sessions_user_idx" ON "portal_sessions" ("user_id");
