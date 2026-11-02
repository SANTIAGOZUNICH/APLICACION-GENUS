-- genus:reconcile-safe
-- Migración 0076 — Control inteligente de materiales de empaque (ME) vs. planificación de Envasado (ADITIVA / IDEMPOTENTE).
-- Tablas NUEVAS. No toca inventario, stock, pedidos, fórmulas ni la planificación: la configuración por producto y las alertas
-- son datos propios del control.

-- Materiales de empaque por producto (cliente + producto). Una fila = un material (o un rol pendiente de identificar).
CREATE TABLE IF NOT EXISTS "me_product_materials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_key" text NOT NULL,
  "product_key" text NOT NULL,
  "client" text NOT NULL DEFAULT '',
  "product" text NOT NULL DEFAULT '',
  -- NULL = rol pendiente de identificar (no se inventa un SKU).
  "material_codigo" text,
  -- ENVASE | CIERRE | DISPENSADOR | ETIQUETA | ESTUCHE | PRECINTO | OTRO
  "role" text NOT NULL DEFAULT 'OTRO',
  "qty_per_unit" double precision NOT NULL DEFAULT 1,
  "required" boolean NOT NULL DEFAULT true,
  -- CONFIRMADO | SUGERIDO | PENDIENTE | RECHAZADO
  "status" text NOT NULL DEFAULT 'SUGERIDO',
  -- MANUAL | IA | INVENTARIO | COMPATIBILIDAD
  "source" text NOT NULL DEFAULT 'MANUAL',
  "reason" text NOT NULL DEFAULT '',
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_by" text,
  "confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "me_product_materials_uq" ON "me_product_materials" ("client_key", "product_key", "role", (coalesce("material_codigo", '')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "me_product_materials_product_idx" ON "me_product_materials" ("client_key", "product_key");
--> statement-breakpoint

-- Compatibilidades entre piezas (envase ↔ cierre/dispensador) registradas por una persona.
CREATE TABLE IF NOT EXISTS "me_material_compat" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "base_codigo" text NOT NULL,
  "accessory_codigo" text NOT NULL,
  -- COMPATIBLE | INCOMPATIBLE
  "status" text NOT NULL DEFAULT 'COMPATIBLE',
  "note" text NOT NULL DEFAULT '',
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "me_material_compat_uq" ON "me_material_compat" ("base_codigo", "accessory_codigo");
--> statement-breakpoint

-- Alertas persistentes de faltantes / materiales sin identificar. Una por (semana, cliente, producto).
CREATE TABLE IF NOT EXISTS "me_control_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "alert_key" text NOT NULL,
  "week_start" text NOT NULL,
  "client" text NOT NULL DEFAULT '',
  "product" text NOT NULL DEFAULT '',
  -- ABIERTA | CERRADA | RESUELTA
  "status" text NOT NULL DEFAULT 'ABIERTA',
  -- Huella del problema (qué falta y cuánto). Cambia solo si el problema EMPEORA o cambia de forma relevante.
  "version_hash" text NOT NULL DEFAULT '',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "reopen_count" integer NOT NULL DEFAULT 0,
  "closed_by" text,
  "closed_at" timestamp with time zone,
  "closed_version_hash" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "me_control_alerts_key_uq" ON "me_control_alerts" ("alert_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "me_control_alerts_status_idx" ON "me_control_alerts" ("status", "week_start");
