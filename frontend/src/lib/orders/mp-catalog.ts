/** Catálogo de Stock MP (lotes activos) para la OE — servidor, solo lectura. */
import "server-only";

import { isDatabaseConfigured, getDb } from "@/lib/db/client";
import { invMpStock } from "@/lib/db/schema";
import { normalizeMpStockPayload } from "@/lib/inventory/neon-persist";
import type { MpStockRow } from "@/lib/inventory/types";
import type { MpCatalogLot } from "@/lib/orders/oe-mp-consumption";

const toLot = (r: MpStockRow): MpCatalogLot => ({
  id: r.id,
  codigo: r.codigo,
  codigosAnteriores: r.codigosAnteriores,
  descripcion: r.descripcion,
  lote: r.lote,
  cantidadKg: r.cantidadKg,
  archived: r.archived,
  vencimiento: r.vencimiento,
  createdAt: r.createdAt,
  estadoManual: r.estadoStockManual,
  vencimientoEstadoManual: r.estadoVencimientoManual,
});

export async function listMpCatalogForOe(): Promise<MpCatalogLot[]> {
  let rows: MpStockRow[];
  if (isDatabaseConfigured()) {
    rows = (await getDb().select({ payload: invMpStock.payload }).from(invMpStock)).map((r) => normalizeMpStockPayload(r.payload));
  } else {
    const { memoryInventoryRepo } = await import("@/lib/inventory/get-inventory-service");
    rows = memoryInventoryRepo.mpStock;
  }
  return rows.filter((r) => !r.archived && r.codigo.trim()).map(toLot);
}
