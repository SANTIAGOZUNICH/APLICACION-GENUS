CREATE TYPE "public"."order_doc_type" AS ENUM('OE', 'OA');--> statement-breakpoint
CREATE TYPE "public"."order_template_status" AS ENUM('VIGENTE', 'OBSOLETA');--> statement-breakpoint
CREATE TYPE "public"."operational_order_status" AS ENUM('BORRADOR', 'PENDIENTE', 'EN_PROCESO', 'COMPLETA', 'DEVUELTA_PARA_CORRECCION', 'ANULADA', 'ARCHIVADA');--> statement-breakpoint
CREATE TYPE "public"."template_proposal_status" AS ENUM('PENDIENTE', 'APROBADA', 'RECHAZADA');--> statement-breakpoint
CREATE TABLE "order_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "order_doc_type" NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"product_code" text NOT NULL,
	"brand_client" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "order_template_status" DEFAULT 'VIGENTE' NOT NULL,
	"content" jsonb NOT NULL,
	"change_reason" text,
	"previous_version_id" uuid,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"type" "order_doc_type" NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"template_snapshot" jsonb NOT NULL,
	"product" text NOT NULL,
	"client" text NOT NULL,
	"code" text NOT NULL,
	"lot" text NOT NULL,
	"assigned_sector" text NOT NULL,
	"status" "operational_order_status" DEFAULT 'PENDIENTE' NOT NULL,
	"form_data" jsonb NOT NULL,
	"completion_percentage" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"linked_work_item_id" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"event" text NOT NULL,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_change_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"order_id" uuid,
	"proposed_changes" jsonb NOT NULL,
	"proposed_by" text NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "template_proposal_status" DEFAULT 'PENDIENTE' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text
);
--> statement-breakpoint
CREATE TABLE "order_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"actor_sector" text NOT NULL,
	"metadata" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_number_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "order_doc_type" NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"sectors" jsonb NOT NULL,
	"href" text,
	"order_id" uuid,
	"read_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dismissed_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operational_orders" ADD CONSTRAINT "operational_orders_template_id_order_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."order_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_versions" ADD CONSTRAINT "order_versions_order_id_operational_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."operational_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_change_proposals" ADD CONSTRAINT "template_change_proposals_template_id_order_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."order_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_change_proposals" ADD CONSTRAINT "template_change_proposals_order_id_operational_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."operational_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_audit_events" ADD CONSTRAINT "order_audit_events_order_id_operational_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."operational_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_notifications" ADD CONSTRAINT "os_notifications_order_id_operational_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."operational_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_templates_product_type_version_uidx" ON "order_templates" USING btree ("product_id","type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_orders_number_uidx" ON "operational_orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "order_number_sequences_type_year_uidx" ON "order_number_sequences" USING btree ("type","year");
