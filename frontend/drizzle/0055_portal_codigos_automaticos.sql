-- genus:reconcile-safe
-- Migración 0055 — Códigos de cliente automáticos del Portal de Clientes (ADITIVA / IDEMPOTENTE).
-- Agrega columnas NUEVAS a portal_clients y una tabla nueva de ajustes. No modifica ni reinterpreta ninguna tabla operativa
-- (pedidos, trabajos, entregas, stock, materias primas, lotes) ni los códigos ya emitidos.
--
--  - portal_clients.access_enabled: acceso al portal habilitado por Producción/Dirección. Tener un código NO habilita el acceso.
--    Los clientes que ya existían conservan su comportamiento (valor por defecto verdadero); los que genera el sistema
--    automáticamente se crean con el acceso DESHABILITADO.
--  - portal_clients.origin / origin_detail: de dónde salió el código (manual, automático desde un flujo, generación histórica).
--  - portal_auto_code_settings: fecha de corte de la generación automática (solo se reconcilian clientes nuevos desde entonces;
--    los históricos se generan con la vista previa y confirmación manual).
--> statement-breakpoint
ALTER TABLE "portal_clients" ADD COLUMN IF NOT EXISTS "access_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "portal_clients" ADD COLUMN IF NOT EXISTS "origin" text NOT NULL DEFAULT 'MANUAL';
--> statement-breakpoint
ALTER TABLE "portal_clients" ADD COLUMN IF NOT EXISTS "origin_detail" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_auto_code_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "set_at" timestamp with time zone NOT NULL DEFAULT now(),
  "set_by" text
);
