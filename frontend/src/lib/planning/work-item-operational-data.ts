import "server-only";

import { eq } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import { productionPedidos, workItems } from "@/lib/db/schema";

/**
 * Contrato único de los datos operativos que DEBEN sobrevivir intactos
 * durante todo el ciclo de vida del work item (Producción → Envasado →
 * Codificado → Calidad → Producción → Expedición → Remito).
 *
 * Regla que este contrato existe para hacer cumplir: al momento de
 * cualquier handoff/entrega, el servidor toma como fuente de verdad el
 * work_item ACTUAL en Neon — nunca un snapshot del frontend. Ver
 * loadWorkItemOperationalData().
 */
export interface WorkItemOperationalData {
  workItemId: string;
  client: string;
  product: string;
  unit: string;
  /** Referencia OA/OE (work_items.order_number). */
  orderNumber: string | null;
  productionPedidoId: string | null;
  /** N° de Pedido legible — resuelto vía JOIN a production_pedidos. */
  pedidoOp: string | null;
  packagingLote: string | null;
  packagingVto: string | null;
  /** Cantidad teórica/asignada original — nunca la pisa la cantidad final. */
  plannedQuantity: string;
  /** Cantidad final declarada por el sector ejecutor. */
  finishedQty: string | null;
  packagingTotalUnits: number | null;
  /** Fuente canónica de la distribución en cajas — nunca reconstruir desde packedUnits. */
  packingGroups: Array<{ cajas: number; unidadesPorCaja: number }> | null;
  packingMismatchObservation: string | null;
  /** Muestras (PARTE A). null = no informado, nunca se infiere como 0. */
  sampleUnits: number | null;
  /** SUM(packingGroups) al cerrar — lo que efectivamente se puede entregar/remitar. */
  deliverableUnits: number | null;
  bulkRemainderKg: number | null;
  bulkRemainderObservation: string | null;
}

type Db = ReturnType<typeof getDb> | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Lee los datos operativos canónicos de un work item DIRECTO de Neon, en el
 * momento de la llamada — nunca desde el body de un request. Cualquier
 * handoff/entrega que necesite "congelar" un snapshot (ver
 * work_item_deliveries, migraciones 0028/0031) debe pasar por acá, no
 * confiar en lo que mande el frontend para estos campos: el frontend puede
 * tener una pantalla abierta hace rato y no reflejar un lote/VTO que otro
 * sector acaba de completar.
 */
export async function loadWorkItemOperationalData(
  tx: Db,
  workItemId: string
): Promise<WorkItemOperationalData | null> {
  const [row] = await tx
    .select({
      id: workItems.id,
      client: workItems.client,
      product: workItems.product,
      unit: workItems.unit,
      orderNumber: workItems.orderNumber,
      productionPedidoId: workItems.productionPedidoId,
      packagingLote: workItems.packagingLote,
      packagingVto: workItems.packagingVto,
      plannedQuantity: workItems.plannedQuantity,
      finishedQty: workItems.finishedQty,
      packagingTotalUnits: workItems.packagingTotalUnits,
      packingGroups: workItems.packingGroups,
      packingMismatchObservation: workItems.packingMismatchObservation,
      sampleUnits: workItems.sampleUnits,
      deliverableUnits: workItems.deliverableUnits,
      bulkRemainderKg: workItems.bulkRemainderKg,
      bulkRemainderObservation: workItems.bulkRemainderObservation,
    })
    .from(workItems)
    .where(eq(workItems.id, workItemId))
    .limit(1);
  if (!row) return null;

  let pedidoOp: string | null = null;
  if (row.productionPedidoId) {
    const [pedido] = await tx
      .select({ op: productionPedidos.op })
      .from(productionPedidos)
      .where(eq(productionPedidos.id, row.productionPedidoId))
      .limit(1);
    pedidoOp = pedido?.op ?? null;
  }

  return {
    workItemId: row.id,
    client: row.client,
    product: row.product,
    unit: row.unit,
    orderNumber: row.orderNumber ?? null,
    productionPedidoId: row.productionPedidoId ?? null,
    pedidoOp,
    packagingLote: row.packagingLote ?? null,
    packagingVto: row.packagingVto ?? null,
    plannedQuantity: row.plannedQuantity,
    finishedQty: row.finishedQty ?? null,
    packagingTotalUnits: row.packagingTotalUnits ?? null,
    packingGroups:
      (row.packingGroups as Array<{ cajas: number; unidadesPorCaja: number }> | null) ?? null,
    packingMismatchObservation: row.packingMismatchObservation ?? null,
    sampleUnits: row.sampleUnits ?? null,
    deliverableUnits: row.deliverableUnits ?? null,
    bulkRemainderKg: row.bulkRemainderKg ?? null,
    bulkRemainderObservation: row.bulkRemainderObservation ?? null,
  };
}
