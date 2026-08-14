-- Migración 0028 — Snapshot histórico de VTO/OA/packingGroups en
-- work_item_deliveries. ADITIVA / IDEMPOTENTE / sin gate (mismo criterio
-- que 0019-0027).
--
-- Auditoría de integridad operativa: work_item_deliveries ya capturaba
-- product/codigo/client/lote/quantity(deliverableUnits)/fecha/usuario, pero
-- no vto ni referencia OA ni la distribución de cajas al momento de la
-- entrega. Como work_items.packaging_vto puede corregirse después (Producción,
-- ver updateWorkItemLoteVtoDurable) y packing_groups puede en teoría seguir
-- editándose, una entrega ya confirmada perdía la posibilidad de reconstruir
-- exactamente qué VTO/distribución existía en el momento real de entrega —
-- quedaba atada a leer el work_item mutable, no a un registro histórico.
--
-- Nullable sin default: entregas históricas sin este dato quedan "no
-- informado", nunca se infiere retroactivamente.
--> statement-breakpoint
ALTER TABLE "work_item_deliveries"
  ADD COLUMN IF NOT EXISTS "vto" text;
--> statement-breakpoint
ALTER TABLE "work_item_deliveries"
  ADD COLUMN IF NOT EXISTS "order_number" text;
--> statement-breakpoint
ALTER TABLE "work_item_deliveries"
  ADD COLUMN IF NOT EXISTS "packing_groups" jsonb;
