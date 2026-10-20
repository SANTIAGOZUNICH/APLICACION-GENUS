-- genus:reconcile-safe
-- Migración 0067 — Vínculo persistente Asignación de Lotes → trabajo (ADITIVA / IDEMPOTENTE).
-- Cada trabajo guarda QUÉ registro de Asignación de Lotes le corresponde (en vez de buscarlo por texto cada vez), con cómo se
-- vinculó (AUTO = coincidencia única, MANUAL = elegido por una persona, CONCILIACION = conciliación de históricos), quién y cuándo.
-- Nullable: los trabajos existentes quedan sin cambios. No modifica lotes, OE, OA, stock ni entregas.
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "asignacion_lote_id" text;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "lote_link_method" text;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "lote_linked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "lote_linked_by" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_asignacion_lote_idx" ON "work_items" ("asignacion_lote_id");
