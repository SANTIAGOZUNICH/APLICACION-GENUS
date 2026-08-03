-- 0007: MP producto + remito displayName / versiones.motivo + work_view_archives.
-- NO APLICAR hasta autorización explícita (APPLY_MIGRATION_0007=1).
-- Compatible con 0001–0006; no borra tablas ni columnas existentes.
-- Usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

-- ========== REMITOS (foco remitos) ==========
ALTER TABLE "remitos"
  ADD COLUMN IF NOT EXISTS "display_name" text;
--> statement-breakpoint
ALTER TABLE "remito_versions"
  ADD COLUMN IF NOT EXISTS "motivo" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remitos_display_name_idx"
  ON "remitos" ("display_name");
--> statement-breakpoint

-- ========== WORK VIEW ARCHIVES (bandeja "Archivar de mi vista") ==========
-- Solo oculta ítems de la bandeja del actor; no elimina trabajos, calidad, OA ni remitos.
CREATE TABLE IF NOT EXISTS "work_view_archives" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sector" text NOT NULL,
  "work_item_id" text NOT NULL,
  "actor_email" text NOT NULL,
  "archived_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "work_view_archives_sector_work_actor_uidx"
    UNIQUE ("sector", "work_item_id", "actor_email")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_view_archives_sector_actor_idx"
  ON "work_view_archives" ("sector", "actor_email");
--> statement-breakpoint
-- ========== STUBS / NOTAS (paralelo — no-op seguro) ==========
-- mp_producto / catálogo MP: columnas o tablas adicionales las agrega trabajo paralelo.
-- Ejemplo (NO ejecutar ciegamente; dejar como nota):
--   ALTER TABLE "materia_prima" ADD COLUMN IF NOT EXISTS "producto_canonico" text;
--
-- Archivado ampliado de remitos (si se necesita metadata aparte de status ARCHIVADO):
--   ALTER TABLE "remitos" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;
--   ALTER TABLE "remitos" ADD COLUMN IF NOT EXISTS "archived_by" text;

-- ========== MP INGRESOS / STOCK (payload JSONB — sin ALTER destructivo) ==========
-- inv_mp_ingresos / inv_mp_stock guardan filas como `payload` jsonb (ver 0003).
-- Extender campos en aplicación; no hace falta ADD COLUMN en esas tablas.
--
-- inv_mp_ingresos.payload:
--   producto: string
--   status: "BORRADOR" | "CONFIRMADO" | "ANULADO"
--   stockImpacted: boolean
--   stockMessage?: string
--
-- inv_mp_stock.payload (enriquecido al listar):
--   productosAsociados: string  -- unidos por " · " desde ingresos CONFIRMADO del mismo código
--
-- Ledger mp_stock_movements: sync vía applyIngreso (idempotente). Anular revierte y conserva la fila.
SELECT 1;
--> statement-breakpoint

