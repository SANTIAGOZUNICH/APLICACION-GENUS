-- Entregas Producción ↔ stock de ME: cada entrega puede descontar el stock del material (una sola vez) mediante UNA salida de inventario vinculada.
-- Aditiva. Las filas existentes quedan «HISTORICO» (DEFAULT de la columna); el servicio inserta las entregas nuevas con NULL explícito = pendiente de vincular: NO impactan el stock hasta que Depósito las revise y las aplique de forma explícita.
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "me_codigo" text;
--> statement-breakpoint
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "me_salida_id" text;
--> statement-breakpoint
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "me_stock_status" text DEFAULT 'HISTORICO';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_despachos_me_salida_idx" ON "deposito_despachos" ("me_salida_id");
