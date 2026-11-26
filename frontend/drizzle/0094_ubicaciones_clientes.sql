-- genus:reconcile-safe
-- Migración 0094 — UBICACIONES: asignación directa de clientes a una posición (sin materiales). ADITIVA / IDEMPOTENTE (0092/0093 no se tocan).
--  * deposito_ubicacion_clientes : clientes asignados a una posición, independientes de su contenido. Única por (posición, cliente normalizado).
--                                  Una posición con ≥ 1 cliente asignado está OCUPADA aunque no tenga materiales. El historial de altas/bajas se guarda
--                                  (INSERT-only) en deposito_ubicacion_movements (kind ASIGNACION / RETIRO con detail.action = cliente_asignado / cliente_quitado).
-- No toca stock ME/MP/Cajas/Insumos ni el contenido existente.
CREATE TABLE IF NOT EXISTS "deposito_ubicacion_clientes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "deposito_ubicaciones"("id"),
  "client_key" text NOT NULL,
  "client_name" text NOT NULL,
  "assigned_by" text NOT NULL,
  "assigned_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deposito_ubicacion_clientes_uidx" ON "deposito_ubicacion_clientes" ("location_id", "client_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_ubicacion_clientes_key_idx" ON "deposito_ubicacion_clientes" ("client_key");
