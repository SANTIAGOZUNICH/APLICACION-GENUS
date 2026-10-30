-- genus:reconcile-safe
-- Migración 0075 — Control semanal TOTAL de MP: reemplazos MANUALES de materia prima (ADITIVA / IDEMPOTENTE).
-- Tabla NUEVA. Una fila = «esta MP del control (clave de origen) se identifica con esta MP del inventario (código destino)».
-- Solo cambia cómo se identifica y consolida la MP EN ESE CONTROL: no toca inventario, fórmulas, OE ni consumos.
CREATE TABLE IF NOT EXISTS "mp_weekly_total_replacements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_key" text NOT NULL,
  "source_label" text NOT NULL DEFAULT '',
  "target_code" text NOT NULL,
  "target_label" text NOT NULL DEFAULT '',
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_weekly_total_replacements_source_uq" ON "mp_weekly_total_replacements" ("source_key");
