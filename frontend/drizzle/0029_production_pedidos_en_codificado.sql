-- Migración 0029 — production_pedidos: agrega EN_CODIFICADO como estado
-- real y distinto. ADITIVA / IDEMPOTENTE / sin gate (mismo criterio que
-- 0019-0028).
--
-- Hasta acá, assignWorkItemDurable (feat/order-driven-work-assignment)
-- hacía avanzar el Pedido a EN_ENVASADO tanto para Envasado Masivo/Premium
-- como para Codificado, porque el CHECK constraint de production_pedidos
-- (migración 0021) no admitía otro valor — una decisión de alcance
-- explícitamente documentada como temporal. El pedido explícito de negocio
-- es distinguir Codificado como su propia fase. No reemplaza ni reinterpreta
-- EN_ENVASADO (touchPedidoEnEnvasado en codificado-handoff-service.ts sigue
-- señalando la fase de Envasado sin cambios) — solo agrega el valor nuevo.
--> statement-breakpoint
ALTER TABLE "production_pedidos" DROP CONSTRAINT IF EXISTS "production_pedidos_estado_chk";
--> statement-breakpoint
ALTER TABLE "production_pedidos"
  ADD CONSTRAINT "production_pedidos_estado_chk" CHECK (
    "estado" IS NULL
    OR "estado" IN (
      'INGRESO',
      'EN_ELABORACION',
      'EN_ENVASADO',
      'EN_CODIFICADO',
      'LISTO_PARA_ENTREGAR',
      'ENTREGADO',
      -- legacy (lectura defensiva si quedó algo sin migrar)
      'EN_PROCESO',
      'TERMINADO'
    )
  );
