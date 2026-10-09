-- genus:reconcile-safe
-- Migración 0042 — Vínculo EXPLÍCITO entre una tarea de Producción → Semanas y un trabajo operativo (work_items).
-- ADITIVA / IDEMPOTENTE: solo crea tablas e índices nuevos; no toca datos existentes ni las planillas de Google.
-- Por qué existe: SEMANAS 2026 no tiene OE/OA, pedido ni lote; work_items no guarda la celda de origen. No hay una
-- relación inequívoca, así que la vincula Producción a mano (nunca automáticamente) y queda auditada.
-- Un work item tiene como máximo UN vínculo activo; desvincular es lógico (unlinked_at), nunca se borra la fila.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "semanas_task_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "spreadsheet_id" text NOT NULL,
  "tab" text NOT NULL,
  "task_key" text NOT NULL,
  "pos_key" text NOT NULL DEFAULT '',
  "task_date" text,
  "summary" text NOT NULL DEFAULT '',
  "work_item_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "linked_by" text NOT NULL,
  "linked_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "unlinked_at" timestamp with time zone,
  "unlinked_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "semanas_task_links_active_work_item_uidx"
  ON "semanas_task_links" ("work_item_id") WHERE "unlinked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "semanas_task_links_task_idx"
  ON "semanas_task_links" ("spreadsheet_id","tab","task_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "semanas_task_link_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "spreadsheet_id" text NOT NULL,
  "tab" text NOT NULL,
  "task_key" text NOT NULL,
  "work_item_id" uuid NOT NULL,
  "action" text NOT NULL,
  "summary" text NOT NULL DEFAULT '',
  "work_item_summary" text NOT NULL DEFAULT '',
  "reason" text,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "actor_name" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "semanas_task_link_events_action_chk" CHECK ("action" IN ('LINK','UNLINK'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "semanas_task_link_events_task_idx"
  ON "semanas_task_link_events" ("spreadsheet_id","tab","task_key","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "semanas_task_link_events_work_item_idx"
  ON "semanas_task_link_events" ("work_item_id","created_at");
