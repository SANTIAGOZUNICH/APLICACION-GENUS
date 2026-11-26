-- genus:reconcile-safe
-- Migración 0093 — UBICACIONES: integridad. ADITIVA / IDEMPOTENTE (la 0092 no se toca).
--  * deposito_ubicacion_items.lot_key : identidad de un renglón LIBRE (texto sin vínculo con el inventario). Los renglones libres nunca se fusionan por texto:
--                                       solo por esta identidad (p. ej. al trasladar parte de un renglón). Renglones anteriores (NULL) usan su propio id.
--                                       Un renglón es VERIFICADO si y solo si tiene me_material_id (vínculo con un material ME); el resto es SIN VERIFICAR.
--  * deposito_ingreso_ubicacion       : registro persistente por ingreso ME ubicado (fuente de verdad de «este ingreso ya fue ubicado X en Y»).
-- No toca stock ME/MP/Cajas/Insumos.
ALTER TABLE "deposito_ubicacion_items" ADD COLUMN IF NOT EXISTS "lot_key" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_ubicacion_items_me_material_idx" ON "deposito_ubicacion_items" ("location_id", "me_material_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deposito_ingreso_ubicacion" (
  "ingreso_id" text PRIMARY KEY NOT NULL,
  "location_id" text NOT NULL REFERENCES "deposito_ubicaciones"("id"),
  "location_code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'UBICADO' CHECK ("status" IN ('UBICADO', 'RETIRADO')),
  "applied_quantity" numeric(16, 3) NOT NULL DEFAULT 0 CHECK ("applied_quantity" >= 0),
  "rev" integer NOT NULL DEFAULT 1,
  "client_key" text NOT NULL,
  "client_name" text NOT NULL,
  "material_name" text NOT NULL,
  "codigo" text,
  "me_material_id" text,
  "lot_key" text,
  "unit" text NOT NULL DEFAULT 'u',
  "movement_id" uuid,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_ingreso_ubicacion_loc_idx" ON "deposito_ingreso_ubicacion" ("location_id");
