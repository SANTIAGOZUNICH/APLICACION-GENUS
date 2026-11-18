-- genus:reconcile-safe
-- Migración 0085 — «Quitar del listado» de Entregados (Envasado Masivo/Premium). ADITIVA / IDEMPOTENTE.
-- Preferencia OPERATIVA (soft-hide) por sector: NO anula ni modifica la entrega, sus cantidades, estados, remitos, recepciones ni stock.
-- Una fila por (tipo de entrega, entrega, sector que la oculta); restaurar la deja con hidden = false (el historial queda en la misma fila).
CREATE TABLE IF NOT EXISTS "internal_delivery_hides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- PRODUCCION = work_item_delivery_lines; CODIFICADO = work_item_codificado_transfers (igual que internal_delivery_changes).
  "kind" text NOT NULL,
  "delivery_id" uuid NOT NULL,
  -- Sector cuyo listado operativo oculta la entrega (ENVASADO_MASIVO | ENVASADO_PREMIUM).
  "sector" text NOT NULL,
  "hidden" boolean NOT NULL DEFAULT true,
  "hidden_by" text NOT NULL,
  "hidden_at" timestamp with time zone NOT NULL DEFAULT now(),
  "restored_by" text,
  "restored_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "internal_delivery_hides_unique" ON "internal_delivery_hides" ("kind", "delivery_id", "sector");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_delivery_hides_sector_idx" ON "internal_delivery_hides" ("sector", "hidden");
