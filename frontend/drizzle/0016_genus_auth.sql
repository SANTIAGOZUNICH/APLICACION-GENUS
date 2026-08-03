/**
 * Migración 0016 — Genus Auth (sesiones enterprise por sector).
 * NO APLICAR hasta autorización explícita: APPLY_MIGRATION_0016=1
 *
 * - genus_auth_users: un usuario por sector (u otros roles futuros), con
 *   password_hash (bcrypt, cost 12) — NUNCA texto plano en esta tabla ni en
 *   ningún script de este repo.
 * - genus_auth_sessions: sesiones opacas (token_hash = sha256(token)); el
 *   token en claro solo vive en la cookie HttpOnly del cliente, nunca en DB.
 * - genus_auth_audit_events: auditoría de LOGIN_OK / LOGIN_FAIL / LOGOUT /
 *   BLOCKED — nunca incluye password ni el token de sesión.
 * - No toca formula_bank ni las migraciones 0004 (fórmulas), 0014
 *   (Codificado/Depósito Graneles) ni 0015 (Creamy memoria).
 * - Sin DROP/TRUNCATE. Idempotente con IF NOT EXISTS.
 *
 * Rollback: ver tmp-mig-0016-deferred/ROLLBACK.md (DROP TABLE IF EXISTS en
 * orden inverso a las FKs; aditiva, no afecta ninguna tabla existente).
 */
CREATE TABLE IF NOT EXISTS "genus_auth_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "email_normalized" text NOT NULL,
  "display_name" text NOT NULL,
  "sector" text NOT NULL,
  "role_id" text NOT NULL,
  "role_label" text NOT NULL,
  "sector_label" text NOT NULL,
  "job_title" text NOT NULL,
  "status" text DEFAULT 'ACTIVO' NOT NULL,
  "password_hash" text NOT NULL,
  "redirect_to" text DEFAULT '/mi-trabajo' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "last_login_at" timestamptz,
  CONSTRAINT "genus_auth_users_email_unique" UNIQUE ("email"),
  CONSTRAINT "genus_auth_users_email_normalized_unique" UNIQUE ("email_normalized")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genus_auth_users_email_normalized_idx"
  ON "genus_auth_users" ("email_normalized");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "genus_auth_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "genus_auth_users"("id"),
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "revoked_at" timestamptz,
  "user_agent" text,
  "ip_hash" text,
  CONSTRAINT "genus_auth_sessions_token_hash_unique" UNIQUE ("token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genus_auth_sessions_token_hash_idx"
  ON "genus_auth_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genus_auth_sessions_user_id_idx"
  ON "genus_auth_sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genus_auth_sessions_expires_at_idx"
  ON "genus_auth_sessions" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "genus_auth_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" text NOT NULL,
  "email_normalized" text,
  "user_id" uuid,
  "detail" jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genus_auth_audit_events_email_normalized_idx"
  ON "genus_auth_audit_events" ("email_normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genus_auth_audit_events_user_id_idx"
  ON "genus_auth_audit_events" ("user_id");
