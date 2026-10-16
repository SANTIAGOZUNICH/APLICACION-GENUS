-- genus:reconcile-safe
-- Migración 0054 — Disponibilidad explícita «Listo para entregar» (ADITIVA / IDEMPOTENTE).
-- Crea tablas NUEVAS. No modifica ni reinterpreta ninguna tabla existente: no toca trabajos, entregas físicas, líneas de
-- entrega, stock, movimientos, consumos de materia prima, lotes ni historial de producción. Un trabajo terminado NO queda
-- disponible por sí solo: solo existe disponibilidad cuando un usuario autorizado del último sector la confirma.
--
--  - portal_availability_marks: cada confirmación de disponibilidad (cantidad, sector, usuario, fecha y hora, y cuántas unidades
--    ya estaban entregadas al confirmar, para no confundir entregas anteriores con disponibilidad). Una marca no se borra: al
--    rectificarla se completa su fecha de retiro, usuario y motivo.
--  - portal_availability_audit: auditoría append-only (quién, sector, cuándo, producto, pedido, cantidad, acción y valores
--    anteriores y nuevos).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_availability_marks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL,
  "quantity" double precision NOT NULL CHECK ("quantity" > 0),
  "unit" text,
  "delivered_before" double precision NOT NULL DEFAULT 0,
  "client_name" text,
  "product" text,
  "order_ref" text,
  "sector" text NOT NULL,
  "marked_by" text NOT NULL,
  "marked_by_name" text,
  "marked_at" timestamp with time zone NOT NULL DEFAULT now(),
  "idempotency_key" text NOT NULL,
  "retracted_at" timestamp with time zone,
  "retracted_by" text,
  "retracted_by_sector" text,
  "retract_reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_availability_marks_key_uidx" ON "portal_availability_marks" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_availability_marks_work_idx" ON "portal_availability_marks" ("work_item_id", "marked_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_availability_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mark_id" uuid,
  "work_item_id" uuid NOT NULL,
  "action" text NOT NULL CHECK ("action" IN ('MARCAR', 'RETIRAR')),
  "actor" text NOT NULL,
  "actor_name" text,
  "actor_sector" text NOT NULL,
  "client_name" text,
  "product" text,
  "order_ref" text,
  "quantity" double precision,
  "unit" text,
  "before_state" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "after_state" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_availability_audit_work_idx" ON "portal_availability_audit" ("work_item_id", "created_at");
