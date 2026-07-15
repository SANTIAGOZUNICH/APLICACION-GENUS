CREATE TYPE "public"."planning_week_status" AS ENUM('DRAFT', 'PUBLISHED');--> statement-breakpoint
CREATE TYPE "public"."work_item_priority" AS ENUM('URGENTE', 'HOY', 'ESTA_SEMANA', 'NORMAL', 'BAJA');--> statement-breakpoint
CREATE TYPE "public"."work_item_sector" AS ENUM('ELABORACION', 'ENVASADO_MASIVO', 'ENVASADO_PREMIUM');--> statement-breakpoint
CREATE TYPE "public"."work_item_source" AS ENUM('native', 'import_sheets');--> statement-breakpoint
CREATE TYPE "public"."work_item_status" AS ENUM('BORRADOR', 'PLANIFICADO', 'PUBLICADO', 'ESPERANDO_MATERIALES', 'LISTO_PARA_INICIAR', 'EN_PROCESO', 'BLOQUEADO', 'TERMINADO_SECTOR', 'PENDIENTE_CALIDAD', 'RECHAZADO_CALIDAD', 'APROBADO_CALIDAD', 'LIBERADO', 'CANCELADO');--> statement-breakpoint
CREATE TABLE "operational_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid,
	"planning_week_id" uuid,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_email" text NOT NULL,
	"actor_sector" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planning_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	"label" text NOT NULL,
	"status" "planning_week_status" DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_weeks_week_start_monday" CHECK (EXTRACT(ISODOW FROM "planning_weeks"."week_start") = 1)
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planning_week_id" uuid NOT NULL,
	"planned_date" date NOT NULL,
	"client" text NOT NULL,
	"product" text NOT NULL,
	"planned_quantity" text NOT NULL,
	"unit" text DEFAULT 'KG' NOT NULL,
	"sector" "work_item_sector" NOT NULL,
	"line" text,
	"branch_owner" text,
	"priority" "work_item_priority" DEFAULT 'NORMAL' NOT NULL,
	"notes" text,
	"status" "work_item_status" DEFAULT 'BORRADOR' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"source" "work_item_source" DEFAULT 'native' NOT NULL,
	"origin_ref" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_branch_owner_values" CHECK ("work_items"."branch_owner" IS NULL OR "work_items"."branch_owner" IN ('Cristian', 'Nicolás')),
	CONSTRAINT "work_items_line_values" CHECK ("work_items"."line" IS NULL OR "work_items"."line" IN ('Línea 1', 'Línea 2', 'Línea 3', 'Línea 4')),
	CONSTRAINT "work_items_sector_assignment" CHECK ((
		("work_items"."sector" = 'ELABORACION' AND "work_items"."line" IS NULL AND "work_items"."branch_owner" IS NOT NULL)
		OR ("work_items"."sector" = 'ENVASADO_MASIVO' AND "work_items"."branch_owner" IS NULL AND "work_items"."line" IN ('Línea 1', 'Línea 2', 'Línea 3', 'Línea 4'))
		OR ("work_items"."sector" = 'ENVASADO_PREMIUM' AND "work_items"."branch_owner" IS NULL AND "work_items"."line" IN ('Línea 1', 'Línea 2'))
	))
);
--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_planning_week_id_planning_weeks_id_fk" FOREIGN KEY ("planning_week_id") REFERENCES "public"."planning_weeks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_planning_week_id_planning_weeks_id_fk" FOREIGN KEY ("planning_week_id") REFERENCES "public"."planning_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "planning_weeks_week_start_uidx" ON "planning_weeks" USING btree ("week_start");