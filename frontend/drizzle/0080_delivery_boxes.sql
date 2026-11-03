-- genus:reconcile-safe
-- Migración 0080 — Cajas en las entregas parciales a Codificado y trazabilidad de cajas en las correcciones. ADITIVA / IDEMPOTENTE.
-- Solo agrega columnas jsonb NULL (sin datos = comportamiento anterior). No toca cantidades, pedidos, remitos ni stock.
ALTER TABLE "work_item_codificado_transfers" ADD COLUMN IF NOT EXISTS "packing_groups" jsonb;
--> statement-breakpoint
ALTER TABLE "internal_delivery_changes" ADD COLUMN IF NOT EXISTS "old_packing" jsonb;
--> statement-breakpoint
ALTER TABLE "internal_delivery_changes" ADD COLUMN IF NOT EXISTS "new_packing" jsonb;
