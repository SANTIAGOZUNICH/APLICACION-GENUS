-- genus:reconcile-safe
-- Migración 0073 — Depósito «Entregas Producción» (despachos de producto terminado). ADITIVA e IDEMPOTENTE: solo CREATE TABLE/INDEX IF NOT EXISTS.
-- No toca stock, MP, elaboración ni entregas de Envasado a Producción: es un registro operativo independiente.
CREATE TABLE IF NOT EXISTS "deposito_despachos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "fecha" date NOT NULL,
  "remito" text DEFAULT '' NOT NULL,
  "cliente" text DEFAULT '' NOT NULL,
  "producto" text DEFAULT '' NOT NULL,
  "bultos" numeric DEFAULT 0 NOT NULL CHECK ("bultos" >= 0),
  "cantidad_total" numeric DEFAULT 0 NOT NULL CHECK ("cantidad_total" >= 0),
  "pedido_op" text DEFAULT '' NOT NULL,
  "idempotency_key" text,
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_by" text,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "deleted_at" timestamptz,
  "deleted_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deposito_despachos_idem_uidx" ON "deposito_despachos" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_despachos_fecha_idx" ON "deposito_despachos" ("fecha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_despachos_remito_idx" ON "deposito_despachos" ("remito");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_despachos_pedido_idx" ON "deposito_despachos" ("pedido_op");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deposito_despachos_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "despacho_id" text NOT NULL,
  "action" text NOT NULL,
  "field" text,
  "before_value" text,
  "after_value" text,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "actor_name" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_despachos_audit_despacho_idx" ON "deposito_despachos_audit" ("despacho_id");
