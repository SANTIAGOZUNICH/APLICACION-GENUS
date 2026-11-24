-- genus:reconcile-safe
-- Migración 0088 — Módulo INSUMOS (retiro y consumo de insumos por sector). ADITIVA e IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS + siembra con ON CONFLICT DO NOTHING.
-- Solo registra CONSUMO: no toca stock general, Materia Prima ni Materiales de Envase.
-- Los ids son estables (slug de texto): un responsable pertenece a UN sector; «GABO» de Envasado Masivo y «GABO» de Codificado son registros distintos.
CREATE TABLE IF NOT EXISTS "insumo_items" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_by" text,
  "updated_by" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "insumo_items_name_uidx" ON "insumo_items" (lower("name"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insumo_responsables" (
  "id" text PRIMARY KEY NOT NULL,
  "sector" text NOT NULL,
  "name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_by" text,
  "updated_by" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "insumo_responsables_sector_name_uidx" ON "insumo_responsables" ("sector", lower("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insumo_responsables_sector_idx" ON "insumo_responsables" ("sector", "active", "sort_order");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insumo_retiros" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_request_id" text NOT NULL,
  "sector" text NOT NULL,
  "responsable_id" text NOT NULL REFERENCES "insumo_responsables"("id"),
  "responsable_name" text NOT NULL,
  "registrado_por_email" text NOT NULL,
  "registrado_por_name" text NOT NULL,
  "registrado_por_sector" text NOT NULL,
  "status" text DEFAULT 'ACTIVO' NOT NULL CHECK ("status" IN ('ACTIVO', 'ANULADO')),
  "anulado_at" timestamptz,
  "anulado_by" text,
  "anulado_motivo" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "insumo_retiros_client_request_uidx" ON "insumo_retiros" ("client_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insumo_retiros_created_idx" ON "insumo_retiros" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insumo_retiros_sector_idx" ON "insumo_retiros" ("sector", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insumo_retiros_responsable_idx" ON "insumo_retiros" ("responsable_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insumo_retiro_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "retiro_id" uuid NOT NULL REFERENCES "insumo_retiros"("id"),
  "insumo_id" text NOT NULL REFERENCES "insumo_items"("id"),
  "insumo_name" text NOT NULL,
  "cantidad" integer NOT NULL CHECK ("cantidad" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "insumo_retiro_items_retiro_insumo_uidx" ON "insumo_retiro_items" ("retiro_id", "insumo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insumo_retiro_items_insumo_idx" ON "insumo_retiro_items" ("insumo_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insumo_retiro_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "retiro_id" uuid NOT NULL REFERENCES "insumo_retiros"("id"),
  "action" text NOT NULL CHECK ("action" IN ('CREADO', 'CORREGIDO', 'ANULADO')),
  "actor_email" text NOT NULL,
  "actor_name" text NOT NULL,
  "actor_sector" text NOT NULL,
  "motivo" text,
  "before_data" jsonb,
  "after_data" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insumo_retiro_events_retiro_idx" ON "insumo_retiro_events" ("retiro_id", "created_at");
--> statement-breakpoint
INSERT INTO "insumo_items" ("id", "name", "sort_order") VALUES ('papel-higienico', 'PAPEL HIGIENICO', 1), ('bobina-de-papel', 'BOBINA DE PAPEL', 2), ('guantes', 'GUANTES', 3), ('cinta', 'CINTA', 4), ('film', 'FILM', 5), ('stretch-film', 'STRETCH FILM', 6) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "insumo_responsables" ("id", "sector", "name", "sort_order") VALUES ('envasado-masivo-gabo', 'ENVASADO_MASIVO', 'GABO', 1), ('envasado-masivo-nico-y', 'ENVASADO_MASIVO', 'NICO Y', 2), ('envasado-masivo-nico-m', 'ENVASADO_MASIVO', 'NICO M', 3), ('envasado-masivo-agus', 'ENVASADO_MASIVO', 'AGUS', 4), ('envasado-premium-joaquin', 'ENVASADO_PREMIUM', 'JOAQUIN', 1), ('envasado-premium-belen', 'ENVASADO_PREMIUM', 'BELEN', 2), ('codificado-julian', 'CODIFICADO', 'JULIAN', 1), ('codificado-gabo', 'CODIFICADO', 'GABO', 2), ('elaboracion-santino', 'ELABORACION', 'SANTINO', 1), ('elaboracion-nicolas', 'ELABORACION', 'NICOLAS', 2), ('elaboracion-cristian', 'ELABORACION', 'CRISTIAN', 3), ('materia-prima-valentin', 'MATERIA_PRIMA', 'VALENTIN', 1), ('materia-prima-santino', 'MATERIA_PRIMA', 'SANTINO', 2) ON CONFLICT DO NOTHING;
