-- genus:reconcile-safe
-- Migración 0072 — Fecha OPCIONAL al asignar trabajos (Producción). IDEMPOTENTE y sin tocar datos: solo relaja NOT NULL.
-- Un trabajo sin fecha asignada guarda NULL (nunca una fecha inventada) y no pertenece a ninguna semana hasta que se le cargue fecha.
ALTER TABLE "work_items" ALTER COLUMN "planned_date" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_items" ALTER COLUMN "planning_week_id" DROP NOT NULL;
