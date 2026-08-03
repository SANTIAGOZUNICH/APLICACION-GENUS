/**
 * Migración 0013 — Eliminación definitiva de notificaciones por usuario + tombstones.
 *
 * - deleted_by: el aviso no aparece en Activas ni Archivadas para ese email.
 * - os_notification_user_tombstones: impide regeneración (mismo href/orden/fingerprint).
 * - planned_date_to en work_items: rango de aparición en planificación nativa (opcional).
 *
 * NO APLICAR hasta autorización explícita: APPLY_MIGRATION_0013=1
 */
ALTER TABLE "os_notifications"
  ADD COLUMN IF NOT EXISTS "deleted_by" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "os_notification_user_tombstones" (
  "user_email" text NOT NULL,
  "event_key" text NOT NULL,
  "deleted_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_email", "event_key")
);
--> statement-breakpoint
ALTER TABLE "work_items"
  ADD COLUMN IF NOT EXISTS "planned_date_to" date;
