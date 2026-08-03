/**
 * Migración 0018 — Pedidos nativos de Producción (ADITIVA / IDEMPOTENTE).
 * NO mezclar con OE/OA ni con Sheets pedidos_2026.
 * Gate: APPLY_MIGRATION_0018=1.
 */
CREATE TABLE IF NOT EXISTS "production_pedidos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "op" text,
  "fecha" date,
  "nro_oc" text,
  "cliente" text,
  "producto" text,
  "s" text,
  "q" double precision,
  "ml" double precision,
  "kg" double precision,
  "estado" text,
  "created_by" text,
  "created_by_sector" text,
  "updated_by" text,
  "deleted_at" timestamptz,
  "deleted_by" text,
  "delete_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "production_pedidos_estado_chk" CHECK (
    "estado" IS NULL
    OR "estado" IN ('INGRESO', 'EN_PROCESO', 'TERMINADO', 'ENTREGADO')
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_pedidos_fecha_idx"
  ON "production_pedidos" ("fecha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_pedidos_estado_idx"
  ON "production_pedidos" ("estado");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_pedidos_op_idx"
  ON "production_pedidos" ("op");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_pedidos_nro_oc_idx"
  ON "production_pedidos" ("nro_oc");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_pedidos_deleted_at_idx"
  ON "production_pedidos" ("deleted_at");
