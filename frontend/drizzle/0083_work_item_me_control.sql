-- Control de Material de Envase (ME) por trabajo de Envasado: lo verifica Depósito (✅ / ❌), informativo, sin movimientos de stock.
-- Aditiva: NULL = «Sin info» (estado inicial). Se asocia al id estable del trabajo (sobrevive a reprogramaciones).
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "me_status" text;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "me_observation" text;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "me_updated_by" text;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "me_updated_at" timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_me_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE CASCADE,
  "from_status" text,
  "to_status" text,
  "observation" text,
  "actor_email" text NOT NULL,
  "actor_name" text,
  "actor_sector" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_item_me_history_item_idx" ON "work_item_me_history" ("work_item_id", "created_at");
