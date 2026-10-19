-- genus:reconcile-safe
-- Migración 0061 — Programaciones de una misma OE/OA en varios días (ADITIVA / IDEMPOTENTE).
-- Cada programación es un trabajo propio (fecha y cantidad planificada) que apunta a la programación original
-- (schedule_root_id) y comparte su OE/OA. schedule_total guarda, en la original, la cantidad total de la orden a repartir.
-- Nullable: los trabajos existentes quedan sin cambios. No crea órdenes, ni toca stock, consumos ni entregas.
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "schedule_root_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "schedule_total" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_schedule_root_idx" ON "work_items" ("schedule_root_id");
