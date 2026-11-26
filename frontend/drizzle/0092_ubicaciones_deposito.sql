-- genus:reconcile-safe
-- Migración 0092 — DEPÓSITO › UBICACIONES: mapa de pallets (WMS liviano). ADITIVA / IDEMPOTENTE.
--  * deposito_mapa_config          : tamaño del lienzo del plano (una fila).
--  * deposito_mapa_shapes          : contorno en L, pasillos, escalera y vacío del plano (configurables).
--  * deposito_ubicaciones          : posiciones físicas (código, zona, geometría, orden, activa) + versión (bloqueo optimista) + observaciones. Nunca se borran: se desactivan.
--  * deposito_ubicacion_items      : contenido actual de cada posición (cliente, material, cantidad opcional, vínculo opcional con un material ME).
--  * deposito_ubicacion_movements  : historial INMUTABLE (snapshot de códigos, líneas movidas, quién y cuándo). Solo se inserta.
-- Siembra las 36 posiciones iniciales (A01–A11, B01–B10, C/D/E01–05) y la forma del plano. No toca stock ME/MP/Cajas/Insumos.
CREATE TABLE IF NOT EXISTS "deposito_mapa_config" (
  "id" text PRIMARY KEY NOT NULL DEFAULT 'main',
  "view_width" double precision NOT NULL DEFAULT 400,
  "view_height" double precision NOT NULL DEFAULT 740,
  "title" text NOT NULL DEFAULT 'Planta alta · Depósito de material de envase y empaque',
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" text
);
--> statement-breakpoint
INSERT INTO "deposito_mapa_config" ("id", "view_width", "view_height") VALUES ('main', 400, 740) ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deposito_mapa_shapes" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('CONTORNO', 'PASILLO', 'ESCALERA', 'VACIO')),
  "label" text NOT NULL DEFAULT '',
  "sublabel" text NOT NULL DEFAULT '',
  "x" double precision NOT NULL DEFAULT 0,
  "y" double precision NOT NULL DEFAULT 0,
  "w" double precision NOT NULL DEFAULT 0,
  "h" double precision NOT NULL DEFAULT 0,
  "points" jsonb,
  "rotation" integer NOT NULL DEFAULT 0,
  "sort_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" text
);
--> statement-breakpoint
INSERT INTO "deposito_mapa_shapes" ("id", "kind", "label", "sublabel", "x", "y", "w", "h", "points", "rotation", "sort_order") VALUES
  ('forma-contorno', 'CONTORNO', '', '', 0, 0, 400, 740, '[[0,0],[400,0],[400,185],[176,185],[176,740],[0,740]]'::jsonb, 0, 1),
  ('forma-vacio', 'VACIO', 'VACÍO SOBRE PB', 'Sin almacenamiento', 176, 185, 224, 555, NULL, 0, 2),
  ('forma-zona-superior', 'PASILLO', '', '', 0, 0, 92, 104, NULL, 0, 3),
  ('forma-pasillo-principal', 'PASILLO', 'PASILLO PRINCIPAL', '', 66, 110, 46, 545, NULL, -90, 4),
  ('forma-descanso', 'PASILLO', '', '', 0, 657, 56, 83, NULL, 0, 5),
  ('forma-escalera', 'ESCALERA', 'ESCALERA', 'Acceso planta alta', 60, 657, 42, 83, NULL, 0, 6) ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deposito_ubicaciones" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "zone" text NOT NULL DEFAULT '',
  "x" double precision NOT NULL DEFAULT 0,
  "y" double precision NOT NULL DEFAULT 0,
  "w" double precision NOT NULL DEFAULT 50,
  "h" double precision NOT NULL DEFAULT 36,
  "sort_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "version" integer NOT NULL DEFAULT 1,
  "observations" text NOT NULL DEFAULT '',
  "last_content_at" timestamp with time zone,
  "last_content_by" text,
  "last_content_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deposito_ubicaciones_code_uidx" ON "deposito_ubicaciones" (upper("code"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_ubicaciones_order_idx" ON "deposito_ubicaciones" ("sort_order");
--> statement-breakpoint
INSERT INTO "deposito_ubicaciones" ("id", "code", "zone", "x", "y", "w", "h", "sort_order") VALUES
  ('ubi-a01', 'A01', 'Lateral izquierdo', 10, 106, 54, 40, 1),
  ('ubi-a02', 'A02', 'Lateral izquierdo', 10, 154.5, 54, 40, 2),
  ('ubi-a03', 'A03', 'Lateral izquierdo', 10, 203, 54, 40, 3),
  ('ubi-a04', 'A04', 'Lateral izquierdo', 10, 251.5, 54, 40, 4),
  ('ubi-a05', 'A05', 'Lateral izquierdo', 10, 300, 54, 40, 5),
  ('ubi-a06', 'A06', 'Lateral izquierdo', 10, 348.5, 54, 40, 6),
  ('ubi-a07', 'A07', 'Lateral izquierdo', 10, 397, 54, 40, 7),
  ('ubi-a08', 'A08', 'Lateral izquierdo', 10, 445.5, 54, 40, 8),
  ('ubi-a09', 'A09', 'Lateral izquierdo', 10, 494, 54, 40, 9),
  ('ubi-a10', 'A10', 'Lateral izquierdo', 10, 542.5, 54, 40, 10),
  ('ubi-a11', 'A11', 'Lateral izquierdo', 10, 591, 54, 40, 11),
  ('ubi-b01', 'B01', 'Lateral derecho', 118, 211, 52, 38, 12),
  ('ubi-b02', 'B02', 'Lateral derecho', 118, 256, 52, 38, 13),
  ('ubi-b03', 'B03', 'Lateral derecho', 118, 301, 52, 38, 14),
  ('ubi-b04', 'B04', 'Lateral derecho', 118, 346, 52, 38, 15),
  ('ubi-b05', 'B05', 'Lateral derecho', 118, 391, 52, 38, 16),
  ('ubi-b06', 'B06', 'Lateral derecho', 118, 436, 52, 38, 17),
  ('ubi-b07', 'B07', 'Lateral derecho', 118, 481, 52, 38, 18),
  ('ubi-b08', 'B08', 'Lateral derecho', 118, 526, 52, 38, 19),
  ('ubi-b09', 'B09', 'Lateral derecho', 118, 571, 52, 38, 20),
  ('ubi-b10', 'B10', 'Lateral derecho', 118, 616, 52, 38, 21),
  ('ubi-c01', 'C01', 'Superior (fila 1)', 98, 18, 52, 36, 22),
  ('ubi-c02', 'C02', 'Superior (fila 1)', 155, 18, 52, 36, 23),
  ('ubi-c03', 'C03', 'Superior (fila 1)', 212, 18, 52, 36, 24),
  ('ubi-c04', 'C04', 'Superior (fila 1)', 269, 18, 52, 36, 25),
  ('ubi-c05', 'C05', 'Superior (fila 1)', 326, 18, 52, 36, 26),
  ('ubi-d01', 'D01', 'Superior (fila 2)', 98, 72, 52, 36, 27),
  ('ubi-d02', 'D02', 'Superior (fila 2)', 155, 72, 52, 36, 28),
  ('ubi-d03', 'D03', 'Superior (fila 2)', 212, 72, 52, 36, 29),
  ('ubi-d04', 'D04', 'Superior (fila 2)', 269, 72, 52, 36, 30),
  ('ubi-d05', 'D05', 'Superior (fila 2)', 326, 72, 52, 36, 31),
  ('ubi-e01', 'E01', 'Superior (fila 3)', 98, 126, 52, 36, 32),
  ('ubi-e02', 'E02', 'Superior (fila 3)', 155, 126, 52, 36, 33),
  ('ubi-e03', 'E03', 'Superior (fila 3)', 212, 126, 52, 36, 34),
  ('ubi-e04', 'E04', 'Superior (fila 3)', 269, 126, 52, 36, 35),
  ('ubi-e05', 'E05', 'Superior (fila 3)', 326, 126, 52, 36, 36) ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deposito_ubicacion_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" text NOT NULL REFERENCES "deposito_ubicaciones"("id"),
  "client_key" text NOT NULL,
  "client_name" text NOT NULL,
  "material_key" text NOT NULL,
  "material_name" text NOT NULL,
  "codigo" text,
  "me_material_id" text,
  "unit" text NOT NULL DEFAULT 'u',
  "quantity" numeric(16, 3) CHECK ("quantity" IS NULL OR "quantity" > 0),
  "ingreso_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deposito_ubicacion_items_slot_uidx" ON "deposito_ubicacion_items" ("location_id", "client_key", "material_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_ubicacion_items_codigo_idx" ON "deposito_ubicacion_items" ("codigo");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deposito_ubicacion_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('ASIGNACION', 'AGREGADO', 'RETIRO', 'TRASLADO', 'LIBERACION', 'OBSERVACION', 'INGRESO_ME', 'CONFIG')),
  "from_location_id" text,
  "from_code" text,
  "to_location_id" text,
  "to_code" text,
  "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "note" text,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "idempotency_key" text NOT NULL,
  "actor_email" text NOT NULL,
  "actor_name" text,
  "actor_sector" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deposito_ubicacion_movements_idem_uidx" ON "deposito_ubicacion_movements" ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deposito_ubicacion_movements_seq_uidx" ON "deposito_ubicacion_movements" ("seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_ubicacion_movements_from_idx" ON "deposito_ubicacion_movements" ("from_location_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposito_ubicacion_movements_to_idx" ON "deposito_ubicacion_movements" ("to_location_id", "seq");
