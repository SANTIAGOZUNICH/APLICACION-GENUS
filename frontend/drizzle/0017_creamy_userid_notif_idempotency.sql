/**
 * Migración 0017 — identidad estable de memorias Creamy (ADITIVA).
 * NO APLICAR hasta autorización explícita: APPLY_MIGRATION_0017=1.
 * La idempotencia de avisos usa UUID determinista en os_notifications.id:
 * no agrega columna ni índice de notificaciones.
 */
ALTER TABLE "creamy_user_memories"
  ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creamy_user_memories_user_id_idx"
  ON "creamy_user_memories" ("user_id");
