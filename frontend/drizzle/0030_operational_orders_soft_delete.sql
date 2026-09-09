-- Migración 0030 — Borrado (soft delete/tombstone) de operational_orders (OA/OE).
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0021/0023/0025/0027/0028/0029).
--
-- Hoy OA/OE solo tienen Anular/Archivar (vía status) — no existe forma de
-- "eliminar" una orden confirmada; el único DELETE físico existente
-- (deleteEmptyDraft) está limitado a borradores completamente vacíos.
-- Esta migración agrega el mismo patrón tombstone ya usado en work_items
-- (0025): nunca DELETE físico, se marca deleted_at/deleted_by/delete_reason
-- y las vistas activas excluyen deleted_at IS NOT NULL. order_versions y
-- order_audit_events no dependen de esta columna y quedan intactos.
--> statement-breakpoint
ALTER TABLE "operational_orders"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "operational_orders"
  ADD COLUMN IF NOT EXISTS "deleted_by" text;
--> statement-breakpoint
ALTER TABLE "operational_orders"
  ADD COLUMN IF NOT EXISTS "delete_reason" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_orders_deleted_at_idx" ON "operational_orders" ("deleted_at");
