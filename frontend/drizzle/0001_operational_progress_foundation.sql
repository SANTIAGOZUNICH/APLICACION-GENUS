ALTER TABLE "work_items" ADD COLUMN "finished_quantity" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "operational_observation" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "progress_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "progress_updated_by" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "completed_by" text;
