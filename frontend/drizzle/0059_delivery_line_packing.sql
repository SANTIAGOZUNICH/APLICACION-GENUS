-- genus:reconcile-safe
-- Migración 0059 — Cajas por entrega (ADITIVA / IDEMPOTENTE).
-- Cada línea de entrega física puede guardar la distribución de cajas de ESA entrega (cajas × unidades por caja, con
-- cantidades distintas por caja). Nullable: las entregas históricas quedan sin cambios. No toca stock ni movimientos.
ALTER TABLE "work_item_delivery_lines" ADD COLUMN IF NOT EXISTS "packing_groups" jsonb;
