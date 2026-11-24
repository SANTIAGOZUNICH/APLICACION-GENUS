-- genus:reconcile-safe
-- Migración 0086 — Salud de los proveedores de lectura de remitos (circuit breaker compartido entre instancias). ADITIVA / IDEMPOTENTE.
-- Una fila por proveedor (gemini / openai): fallos consecutivos, hasta cuándo se lo saltea y el último error (sin claves ni contenido).
CREATE TABLE IF NOT EXISTS "ai_provider_health" (
  "provider" text PRIMARY KEY NOT NULL,
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "open_until" timestamp with time zone,
  "last_kind" text,
  "last_http" integer,
  "last_failure_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "total_success" integer NOT NULL DEFAULT 0,
  "total_failure" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
