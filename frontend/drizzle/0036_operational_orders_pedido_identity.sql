-- Migración 0036 — Identidad funcional PEDIDO + PRODUCTO + LOTE en OA/OE.
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0035).
--
-- Objetivo: una OA/OE se reutiliza siempre que representa el mismo
-- Pedido + Producto + Lote, en vez de exigir 1 OA/OE por WorkItem. Estas
-- columnas son nullable y solo se completan desde el flujo de Asignar
-- trabajo cuando hay un Pedido vinculado — OA/OE creadas por el flujo
-- manual de Órdenes, o ya existentes (legacy), quedan sin tocar y siguen
-- identificándose únicamente por order_number, sin cambio de
-- comportamiento.
--> statement-breakpoint
ALTER TABLE "operational_orders"
  ADD COLUMN IF NOT EXISTS "pedido_id" uuid;
--> statement-breakpoint
ALTER TABLE "operational_orders"
  ADD COLUMN IF NOT EXISTS "product_identity_key" text;
--> statement-breakpoint
ALTER TABLE "operational_orders"
  ADD COLUMN IF NOT EXISTS "lote_identity_key" text;
--> statement-breakpoint
-- Con lote conocido: a lo sumo UNA OA/OE activa por (tipo, pedido,
-- producto, lote) — constraint real de Postgres, protege contra
-- duplicados incluso bajo asignaciones concurrentes.
CREATE UNIQUE INDEX IF NOT EXISTS "operational_orders_identity_with_lote_uidx"
  ON "operational_orders" ("type", "pedido_id", "product_identity_key", "lote_identity_key")
  WHERE "pedido_id" IS NOT NULL AND "lote_identity_key" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
-- SIN_LOTE: a lo sumo UNA OA/OE provisional activa por (tipo, pedido,
-- producto) mientras no se conozca el lote.
CREATE UNIQUE INDEX IF NOT EXISTS "operational_orders_identity_no_lote_uidx"
  ON "operational_orders" ("type", "pedido_id", "product_identity_key")
  WHERE "pedido_id" IS NOT NULL AND "lote_identity_key" IS NULL AND "deleted_at" IS NULL;
