-- genus:reconcile-safe
-- Migración 0070 — Config de consumo por producto material ME ↔ pedido (DIFERENCIA en Ingresos ME). ADITIVA / IDEMPOTENTE: tabla nueva.
-- No modifica stock, movimientos, pedidos ni cantidades. units_per_product = unidades del material por producto terminado (NULL = sin configurar → «SIN CONFIGURAR»; nunca se asume 1:1).
-- Una sentencia por bloque: el migrador de producción ejecuta cada una por separado.
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
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "me_material_pedido_links_uidx" ON "me_material_pedido_links" ("material_id", "pedido_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "me_material_pedido_links_pedido_idx" ON "me_material_pedido_links" ("pedido_id");
