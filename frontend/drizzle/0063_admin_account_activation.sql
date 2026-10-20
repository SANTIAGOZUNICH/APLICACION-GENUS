-- genus:reconcile-safe
-- Migración 0063 — Activación inicial de la cuenta de Administración (ADITIVA / IDEMPOTENTE).
-- Enlace de UN SOLO USO que emite el superadministrador autenticado. Se guarda solo el hash sha256 del token (nunca el token),
-- con vencimiento, uso y revocación. No crea usuarios ni toca cuentas existentes.
CREATE TABLE IF NOT EXISTS "genus_auth_activations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purpose" text NOT NULL,
  "email_normalized" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "genus_auth_activations_token_uidx" ON "genus_auth_activations" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "genus_auth_activations_email_idx" ON "genus_auth_activations" ("email_normalized");
