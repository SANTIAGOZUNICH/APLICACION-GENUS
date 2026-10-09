-- genus:reconcile-safe
-- Migración 0043 — Ediciones de GENUS sobre lotes sincronizados desde Google Sheets (capa de modificaciones persistentes).
-- ADITIVA / IDEMPOTENTE: solo agrega columnas nullable y una tabla nueva; no toca datos existentes ni las planillas.
-- Por qué existe: los registros sincronizados eran de solo lectura porque el próximo sync los pisaba. Ahora GENUS guarda
-- qué campos editó (valor de GENUS + valor de la planilla en ese momento); el sync respeta esos campos y, si la planilla
-- cambia el mismo campo después, lo marca como CONFLICTO (nunca elige en silencio). La identidad de origen (lote,
-- código, producto tal como están en la planilla) se guarda aparte para que editar el lote/código/producto en GENUS no
-- haga que el sync cree un duplicado ni archive el registro.
--> statement-breakpoint
ALTER TABLE "asignacion_lotes" ADD COLUMN IF NOT EXISTS "source_lote" text;
--> statement-breakpoint
ALTER TABLE "asignacion_lotes" ADD COLUMN IF NOT EXISTS "source_codigo" text;
--> statement-breakpoint
ALTER TABLE "asignacion_lotes" ADD COLUMN IF NOT EXISTS "source_producto" text;
--> statement-breakpoint
ALTER TABLE "asignacion_lotes_cell_audit" ADD COLUMN IF NOT EXISTS "reason" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asignacion_lotes_local_edits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "record_id" text NOT NULL,
  "field" text NOT NULL,
  "sheet_value" text,
  "local_value" text,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "conflict_sheet_value" text,
  "created_by" text NOT NULL,
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_by" text,
  "resolved_at" timestamp with time zone,
  "resolution" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asignacion_lotes_local_edits_open_uidx"
  ON "asignacion_lotes_local_edits" ("record_id","field") WHERE "resolved_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asignacion_lotes_local_edits_record_idx"
  ON "asignacion_lotes_local_edits" ("record_id");
