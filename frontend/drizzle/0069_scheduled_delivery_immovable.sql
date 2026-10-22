-- genus:reconcile-safe
-- Migración 0069 — Entregas INAMOVIBLES (Producción). ADITIVA / IDEMPOTENTE: agrega una columna booleana con default false.
-- No modifica fechas, cantidades ni estados; solo marca la entrega como prioridad visual/de planificación (rojo en el calendario).
ALTER TABLE "scheduled_deliveries" ADD COLUMN IF NOT EXISTS "is_immovable" boolean NOT NULL DEFAULT false;
