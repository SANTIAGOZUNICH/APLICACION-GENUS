-- Migración 0026 — Carga flexible de Excel/clipboard: asignacion_lotes.fecha
-- pasa a NULLABLE. ADITIVA (no agrega columnas) / IDEMPOTENTE / sin gate
-- (mismo criterio que 0019-0025).
--
-- Causa: al pegar filas reales desde Excel, "fecha" puede venir vacía —
-- una fecha vacía no puede representarse como "" en una columna date, y la
-- columna era NOT NULL sin default, así que la fila entera se rechazaba en
-- el import. lote/producto/codigo ya toleraban "" (NOT NULL pero sin CHECK
-- de no-vacío) y no necesitan migración.
--> statement-breakpoint
ALTER TABLE "asignacion_lotes"
  ALTER COLUMN "fecha" DROP NOT NULL;
