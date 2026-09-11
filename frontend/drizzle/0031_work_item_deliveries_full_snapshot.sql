-- Migración 0031 — Completa el snapshot histórico de work_item_deliveries.
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0030).
--
-- Auditoría de integridad end-to-end del WorkItem (ver informe): 0028 ya
-- había agregado vto/order_number/packing_groups como snapshot congelado al
-- momento de la entrega, pero cantidad teórica, cantidad final, muestras,
-- sobrante y la referencia de Pedido seguían sin capturarse acá — quedaban
-- disponibles solo si un consumidor volvía a leer el work_item (mutable,
-- puede haber cambiado desde la entrega). Esta migración cierra ese hueco:
-- deliverWorkDurable ahora congela TODOS estos valores, leídos frescos de
-- work_items en el momento real de la entrega, nunca del body del cliente.
--
-- Nullable sin default: entregas históricas sin este dato quedan "no
-- informado", nunca se infiere retroactivamente.
--> statement-breakpoint
ALTER TABLE "work_item_deliveries"
  ADD COLUMN IF NOT EXISTS "planned_quantity" text;
--> statement-breakpoint
ALTER TABLE "work_item_deliveries"
  ADD COLUMN IF NOT EXISTS "finished_qty" text;
--> statement-breakpoint
ALTER TABLE "work_item_deliveries"
  ADD COLUMN IF NOT EXISTS "sample_units" integer;
--> statement-breakpoint
ALTER TABLE "work_item_deliveries"
  ADD COLUMN IF NOT EXISTS "deliverable_units" double precision;
--> statement-breakpoint
ALTER TABLE "work_item_deliveries"
  ADD COLUMN IF NOT EXISTS "bulk_remainder_kg" double precision;
--> statement-breakpoint
ALTER TABLE "work_item_deliveries"
  ADD COLUMN IF NOT EXISTS "bulk_remainder_observation" text;
--> statement-breakpoint
ALTER TABLE "work_item_deliveries"
  ADD COLUMN IF NOT EXISTS "production_pedido_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_item_deliveries"
  ADD COLUMN IF NOT EXISTS "pedido_op" text;
