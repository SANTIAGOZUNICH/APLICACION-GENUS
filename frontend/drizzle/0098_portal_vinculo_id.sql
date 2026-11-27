-- genus:reconcile-safe
-- Migración 0098 — Portal de Clientes: vínculo por ID del cliente (ADITIVA / IDEMPOTENTE; no modifica ni borra datos).
--
-- Hasta hoy el portal vinculaba pedidos y trabajos por NOMBRE (igualdad exacta de alias normalizado): cualquier diferencia del
-- texto libre del pedido (guion, sufijo «S.A.», sin espacio…) lo dejaba huérfano y no aparecía en el portal del cliente.
-- Ahora el ID único del cliente (portal_clients.id) es el vínculo principal:
--
--  - production_pedidos.portal_client_id: cliente del portal elegido (o resuelto sin ambigüedad) al crear/editar el pedido.
--  - work_items.portal_client_id: cliente del portal del trabajo (hereda el del pedido; sin pedido, el del nombre resuelto).
--
-- Ambas columnas son NULLABLE: los datos históricos siguen vinculados por alias (compatibilidad) hasta el backfill idempotente
-- que ejecuta Dirección bajo demanda. Sin clave foránea a propósito: nunca bloquea la operación de Producción.
ALTER TABLE "production_pedidos" ADD COLUMN IF NOT EXISTS "portal_client_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "portal_client_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_pedidos_portal_client_idx" ON "production_pedidos" ("portal_client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_portal_client_idx" ON "work_items" ("portal_client_id");
