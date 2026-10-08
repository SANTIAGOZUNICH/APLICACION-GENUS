-- genus:reconcile-safe
-- Migración 0042 — Datos de enlace de la prioridad de Semanas con las tareas operativas de cada sector.
-- ADITIVA / IDEMPOTENTE: solo agrega columnas NULLABLE a semanas_task_priorities (0041). No toca datos existentes.
-- La prioridad sigue viviendo en UNA sola tabla; estas columnas permiten que Elaboración / Envasado / Codificado
-- reconozcan la misma tarea (fecha + cliente + producto + sección) sin leer Google Sheets en cada pedido.
--> statement-breakpoint
ALTER TABLE "semanas_task_priorities" ADD COLUMN IF NOT EXISTS "task_date_to" text;
--> statement-breakpoint
ALTER TABLE "semanas_task_priorities" ADD COLUMN IF NOT EXISTS "client_norm" text;
--> statement-breakpoint
ALTER TABLE "semanas_task_priorities" ADD COLUMN IF NOT EXISTS "products_norm" jsonb;
--> statement-breakpoint
ALTER TABLE "semanas_task_priorities" ADD COLUMN IF NOT EXISTS "section_norm" text;
