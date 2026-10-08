-- genus:reconcile-safe
-- Migración 0041 — Prioridad operativa de las tareas de Producción → Semanas.
-- ADITIVA / IDEMPOTENTE: solo crea tablas nuevas; no toca datos existentes ni las planillas de Google.
-- La prioridad es un dato de GENUS (nunca se escribe en la Sheet). La identidad de la tarea NO es el n° de fila:
-- `task_key` = contenido normalizado + fecha; `pos_key` = semana/día/sección/orden (respaldo si se corrige el texto).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "semanas_task_priorities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "spreadsheet_id" text NOT NULL,
  "tab" text NOT NULL,
  "task_key" text NOT NULL,
  "pos_key" text NOT NULL DEFAULT '',
  "task_date" text,
  "summary" text NOT NULL DEFAULT '',
  "priority" text NOT NULL DEFAULT 'NORMAL',
  "version" integer NOT NULL DEFAULT 1,
  "updated_by" text NOT NULL,
  "updated_by_sector" text NOT NULL,
  "updated_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "semanas_task_priorities_priority_chk" CHECK ("priority" IN ('URGENTE','IMPORTANTE','NORMAL'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "semanas_task_priorities_key_uidx"
  ON "semanas_task_priorities" ("spreadsheet_id","tab","task_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "semanas_task_priorities_pos_idx"
  ON "semanas_task_priorities" ("spreadsheet_id","tab","pos_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "semanas_task_priority_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "spreadsheet_id" text NOT NULL,
  "tab" text NOT NULL,
  "task_key" text NOT NULL,
  "summary" text NOT NULL DEFAULT '',
  "from_priority" text NOT NULL,
  "to_priority" text NOT NULL,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "actor_name" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "semanas_task_priority_events_task_idx"
  ON "semanas_task_priority_events" ("spreadsheet_id","tab","task_key","created_at");
