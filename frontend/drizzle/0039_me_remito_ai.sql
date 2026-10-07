-- Migración 0039 — Carga asistida de ingresos ME desde remito (IA propone, humano confirma).
-- ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que 0019-0038): solo crea 2 tablas nuevas,
-- no toca datos existentes. Mismo patrón documento-JSON que inv_me_*.
CREATE TABLE IF NOT EXISTS "inv_me_remito_docs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inv_me_remito_aliases" (
  "id" uuid PRIMARY KEY NOT NULL,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
