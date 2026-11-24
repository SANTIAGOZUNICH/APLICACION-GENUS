-- genus:reconcile-safe
-- Migración 0089 — Observaciones de Producción: «vistas por usuario» (indicador de NUEVAS). ADITIVA / IDEMPOTENTE.
-- NO guarda el texto de las observaciones (viven en las entregas); solo cuándo vio cada usuario cada ámbito
-- (scope = 'FEED' para la pestaña de Observaciones, o el id del trabajo para su diálogo).
CREATE TABLE IF NOT EXISTS "production_observation_seen" (
  "user_key" text NOT NULL,
  "scope" text NOT NULL,
  "seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_key", "scope")
);
