-- Inventario ME: unicidad de código normalizado en materiales activos.
-- No es multi-empresa/depósito hoy (scope global = el alcance correcto).
-- Materiales archivados o con código vacío quedan fuera del índice.
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inv_me_materials_codigo_norm_active_uidx"
ON "inv_me_materials" (
  (upper(trim(regexp_replace(coalesce("payload"->>'codigo', ''), '\s+', ' ', 'g'))))
)
WHERE coalesce("payload"->>'archived', 'false') NOT IN ('true', 'True')
  AND length(trim(coalesce("payload"->>'codigo', ''))) > 0;
