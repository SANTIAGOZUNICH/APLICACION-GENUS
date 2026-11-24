-- genus:reconcile-safe
-- Migración 0087 — CAJAS GENUS (stock propio de cajas de Laboratorio Genus). ADITIVA / IDEMPOTENTE (sin DROP ni cambios de datos existentes).
--  * cajas_genus_config            : umbral de alerta (300), inicio del seguimiento y estado/episodio de la alerta (una sola fila `main`).
--  * cajas_genus_movements         : libro de movimientos PERSISTENTE (stock inicial, ingresos, egresos por entrega final, ajustes). Nunca se borra: se anula.
--  * cajas_genus_line_review       : entregas finales que no pudieron descontarse (sin cliente / sin detalle de cajas): pendientes de revisión.
--  * cajas_genus_client_settings   : «UTILIZA CAJAS PROPIAS» por cliente (clave normalizada + vínculo opcional al maestro de clientes del portal).
--  * cajas_genus_audit             : auditoría inmutable de acciones administrativas.
CREATE TABLE IF NOT EXISTS "cajas_genus_config" (
  "id" text PRIMARY KEY NOT NULL DEFAULT 'main',
  "low_stock_threshold" integer NOT NULL DEFAULT 300,
  "tracking_started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "alert_state" text NOT NULL DEFAULT 'NORMAL',
  "alert_episode" integer NOT NULL DEFAULT 0,
  "alert_since" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
INSERT INTO "cajas_genus_config" ("id") VALUES ('main') ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "cajas_genus_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "kind" text NOT NULL,
  "delta" integer NOT NULL,
  "occurred_on" date NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "status" text NOT NULL DEFAULT 'ACTIVO',
  "idempotency_key" text NOT NULL,
  "bultos" integer,
  "cantidad_por_bulto" integer,
  "delivery_line_id" uuid,
  "work_item_id" uuid,
  "client_key" text,
  "client_name" text,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "note" text,
  "created_by" text NOT NULL,
  "created_by_sector" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "voided_at" timestamp with time zone,
  "voided_by" text,
  "void_reason" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "cajas_genus_movements_idem_uidx" ON "cajas_genus_movements" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "cajas_genus_movements_seq_uidx" ON "cajas_genus_movements" ("seq");
CREATE INDEX IF NOT EXISTS "cajas_genus_movements_line_idx" ON "cajas_genus_movements" ("delivery_line_id");
CREATE INDEX IF NOT EXISTS "cajas_genus_movements_kind_idx" ON "cajas_genus_movements" ("kind", "status");
CREATE INDEX IF NOT EXISTS "cajas_genus_movements_day_idx" ON "cajas_genus_movements" ("occurred_on");

CREATE TABLE IF NOT EXISTS "cajas_genus_line_review" (
  "delivery_line_id" uuid PRIMARY KEY NOT NULL,
  "work_item_id" uuid,
  "reason" text NOT NULL,
  "client_name" text,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolved_by" text,
  "resolution" text
);
CREATE INDEX IF NOT EXISTS "cajas_genus_line_review_open_idx" ON "cajas_genus_line_review" ("resolved_at");

CREATE TABLE IF NOT EXISTS "cajas_genus_client_settings" (
  "client_key" text PRIMARY KEY NOT NULL,
  "display_name" text NOT NULL,
  "uses_own_boxes" boolean NOT NULL DEFAULT false,
  "portal_client_id" uuid,
  "source" text NOT NULL DEFAULT 'ADMIN',
  "updated_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
-- Los seis clientes que usan cajas propias (clave = nombre en minúsculas, sin acentos, sin signos ni espacios, sin sufijo societario).
INSERT INTO "cajas_genus_client_settings" ("client_key", "display_name", "uses_own_boxes", "source", "updated_by") VALUES
  ('bioesencia', 'BIOESENCIA', true, 'INICIAL', 'migración 0087'),
  ('originalblack', 'ORIGINAL BLACK', true, 'INICIAL', 'migración 0087'),
  ('trc', 'TRC', true, 'INICIAL', 'migración 0087'),
  ('jactans', 'JACTANS', true, 'INICIAL', 'migración 0087'),
  ('blcosmetics', 'BL COSMETICS', true, 'INICIAL', 'migración 0087'),
  ('bahiaevans', 'BAHIA EVANS', true, 'INICIAL', 'migración 0087')
ON CONFLICT ("client_key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "cajas_genus_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action" text NOT NULL,
  "target_id" text,
  "before" jsonb,
  "after" jsonb,
  "reason" text,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "cajas_genus_audit_at_idx" ON "cajas_genus_audit" ("created_at");
