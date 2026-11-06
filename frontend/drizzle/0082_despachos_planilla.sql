-- genus:reconcile-safe
-- Migración 0082 — «Entregas Producción» idéntica a la hoja «SALIDAS PROD. T 2026». ADITIVA / IDEMPOTENTE: solo agrega columnas con valor por defecto.
-- Nuevas columnas: EGRESO N°, CANTIDAD (unidades por bulto), COMENTARIOS y las casillas CONTROL / ENTREGADO con quién y cuándo las marcó.
-- Las entregas existentes NO se borran ni se modifican (fecha, remito, cliente, producto, bultos y cantidad_total quedan idénticos).
-- Única "adaptación" de datos: si bultos × cantidad reproduce EXACTAMENTE el total ya registrado (total ÷ bultos entero), se completa CANTIDAD con ese cociente;
-- si no es exacto queda en NULL (pendiente de completar) y el total existente se conserva tal cual. No se inventa ningún valor.
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "egreso" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "cantidad" numeric;
--> statement-breakpoint
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "comentarios" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "control" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "control_by" text;
--> statement-breakpoint
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "control_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "entregado" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "entregado_by" text;
--> statement-breakpoint
ALTER TABLE "deposito_despachos" ADD COLUMN IF NOT EXISTS "entregado_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_despachos_egreso_idx" ON "deposito_despachos" ("egreso");
--> statement-breakpoint
UPDATE "deposito_despachos"
   SET "cantidad" = "cantidad_total" / "bultos"
 WHERE "cantidad" IS NULL AND "bultos" > 0 AND "cantidad_total" > 0 AND "bultos" = trunc("bultos") AND "cantidad_total" = trunc("cantidad_total") AND ("cantidad_total" % "bultos") = 0;
