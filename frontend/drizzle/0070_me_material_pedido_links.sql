-- genus:reconcile-safe
-- Migración 0070 — Vínculo material ME ↔ pedido de Producción (DIFERENCIA ME). ADITIVA / IDEMPOTENTE: tabla nueva.
-- No modifica stock, movimientos, pedidos ni cantidades. units_per_product = unidades del material por producto terminado (NULL = consumo sin configurar → «SIN CONFIGURAR»; nunca se asume 1:1).
CREATE TABLE IF NOT EXISTS "me_material_pedido_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "material_id" uuid NOT NULL,
  "pedido_id" uuid NOT NULL,
  "units_per_product" double precision CHECK ("units_per_product" IS NULL OR "units_per_product" > 0),
  "created_by" text,
  "updated_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "me_material_pedido_links_uidx" ON "me_material_pedido_links" ("material_id", "pedido_id");
CREATE INDEX IF NOT EXISTS "me_material_pedido_links_pedido_idx" ON "me_material_pedido_links" ("pedido_id");
