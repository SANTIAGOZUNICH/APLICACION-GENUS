-- genus:reconcile-safe
-- Migración 0090 — INSUMOS: control de stock (stock inicial, ingresos, descuento automático por retiros, ajustes y alerta de stock bajo). ADITIVA / IDEMPOTENTE.
--  * insumo_items (+ columnas)      : unidad de medida, stock mínimo y estado/episodio de la alerta de cada insumo.
--  * insumo_stock_config            : inicio del seguimiento (los retiros anteriores NO descuentan solos: el historial se conserva intacto).
--  * insumo_stock_movements         : libro de movimientos PERSISTENTE por insumo (stock inicial, ingreso, egreso/ajuste por retiro, ajuste manual). Nunca se borra: se anula.
--  * insumo_stock_audit             : auditoría inmutable (antes / después / motivo / quién).
-- No toca stock ME/MP, Cajas Genus, remitos ni retiros ya registrados.
ALTER TABLE "insumo_items" ADD COLUMN IF NOT EXISTS "unit" text NOT NULL DEFAULT 'unidades';
--> statement-breakpoint
ALTER TABLE "insumo_items" ADD COLUMN IF NOT EXISTS "min_stock" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "insumo_items" ADD COLUMN IF NOT EXISTS "alert_state" text NOT NULL DEFAULT 'NORMAL';
--> statement-breakpoint
ALTER TABLE "insumo_items" ADD COLUMN IF NOT EXISTS "alert_episode" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "insumo_items" ADD COLUMN IF NOT EXISTS "alert_since" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insumo_stock_config" (
  "id" text PRIMARY KEY NOT NULL DEFAULT 'main',
  "tracking_started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "insumo_stock_config" ("id") VALUES ('main') ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insumo_stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "insumo_id" text NOT NULL REFERENCES "insumo_items"("id"),
  "kind" text NOT NULL CHECK ("kind" IN ('STOCK_INICIAL', 'INGRESO', 'EGRESO_RETIRO', 'AJUSTE_RETIRO', 'AJUSTE_MANUAL')),
  "delta" integer NOT NULL,
  "occurred_on" date NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "status" text NOT NULL DEFAULT 'ACTIVO' CHECK ("status" IN ('ACTIVO', 'ANULADO')),
  "idempotency_key" text NOT NULL,
  "retiro_id" uuid,
  "note" text,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" text NOT NULL,
  "created_by_name" text,
  "created_by_sector" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "voided_at" timestamp with time zone,
  "voided_by" text,
  "void_reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "insumo_stock_movements_idem_uidx" ON "insumo_stock_movements" ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "insumo_stock_movements_seq_uidx" ON "insumo_stock_movements" ("seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insumo_stock_movements_insumo_idx" ON "insumo_stock_movements" ("insumo_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insumo_stock_movements_retiro_idx" ON "insumo_stock_movements" ("retiro_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insumo_stock_movements_day_idx" ON "insumo_stock_movements" ("occurred_on");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insumo_stock_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action" text NOT NULL,
  "insumo_id" text,
  "target_id" text,
  "before_data" jsonb,
  "after_data" jsonb,
  "reason" text,
  "actor_email" text NOT NULL,
  "actor_name" text,
  "actor_sector" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insumo_stock_audit_insumo_idx" ON "insumo_stock_audit" ("insumo_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insumo_stock_audit_at_idx" ON "insumo_stock_audit" ("created_at");
