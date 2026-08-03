/**
 * Migración 0012 — Lifecycle extras (aditiva).
 *
 * - CHECK opcional de status en mp_weekly_controls (status ya es text desde 0005)
 * - Tabla durable asignacion_lotes (Preview usa memory hasta APPLY)
 *
 * NO APLICAR hasta autorización explícita: APPLY_MIGRATION_0012=1
 * Sin DROP/TRUNCATE. Compatible con 0000–0011.
 *
 * Rollback (manual, solo si se aplicó con gate):
 *   ALTER TABLE "mp_weekly_controls" DROP CONSTRAINT IF EXISTS "mp_weekly_controls_status_check";
 *   DROP INDEX IF EXISTS "mp_weekly_controls_status_idx";
 *   DROP TABLE IF EXISTS "asignacion_lotes";
 */

ALTER TABLE "mp_weekly_controls"
  DROP CONSTRAINT IF EXISTS "mp_weekly_controls_status_check";
--> statement-breakpoint
ALTER TABLE "mp_weekly_controls"
  ADD CONSTRAINT "mp_weekly_controls_status_check"
  CHECK ("status" IN ('BORRADOR', 'COMPLETADO', 'ANULADO', 'ARCHIVADO'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_weekly_controls_status_idx"
  ON "mp_weekly_controls" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asignacion_lotes" (
  "id" text PRIMARY KEY NOT NULL,
  "lote" text NOT NULL,
  "fecha" date NOT NULL,
  "producto" text NOT NULL,
  "codigo" text NOT NULL,
  "marca" text DEFAULT '' NOT NULL,
  "cantidades" numeric NOT NULL DEFAULT 0,
  "vto" date,
  "muestras" text DEFAULT '' NOT NULL,
  "cj_muestra" text DEFAULT '' NOT NULL,
  "fecha_analisis" date,
  "observaciones" text DEFAULT '' NOT NULL,
  "archived" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" text DEFAULT '' NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "updated_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asignacion_lotes_lote_codigo_active_uidx"
  ON "asignacion_lotes" ("lote", "codigo")
  WHERE "archived" = false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asignacion_lotes_fecha_idx"
  ON "asignacion_lotes" ("fecha" DESC);
