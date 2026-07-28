/**
 * Migración 0010 — Lifecycle audit universal (aditiva).
 *
 * NO APLICAR hasta autorización explícita: APPLY_MIGRATION_0010=1
 * Compatible con 0000–0009; no modifica tablas existentes. Sin DROP/TRUNCATE.
 *
 * Rollback (manual, solo si se aplicó con gate):
 *   DROP TABLE IF EXISTS lifecycle_audit_events;
 */

CREATE TABLE IF NOT EXISTS "lifecycle_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_kind" text NOT NULL,
  "entity_id" text NOT NULL,
  "action" text NOT NULL,
  "actor_email" text NOT NULL,
  "actor_sector" text NOT NULL,
  "reason" text,
  "impact_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lifecycle_audit_entity_idx"
  ON "lifecycle_audit_events" ("entity_kind", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lifecycle_audit_created_idx"
  ON "lifecycle_audit_events" ("created_at");
