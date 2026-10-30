-- genus:reconcile-safe
-- Migración 0074 — «Entregas Producción» como planilla: la fecha pasa a ser OPCIONAL (se pueden cargar filas incompletas y completarlas después).
-- IDEMPOTENTE y sin tocar datos: solo relaja NOT NULL; los registros existentes conservan su fecha.
ALTER TABLE "deposito_despachos" ALTER COLUMN "fecha" DROP NOT NULL;
