import { rowsToRecords, pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import type { PedidoSummary } from "@/lib/adapters/drive/types/document.types";

export function parsePedidoSummaries(rows: string[][]): PedidoSummary[] {
  const summaries: PedidoSummary[] = [];

  for (const record of rowsToRecords(rows)) {
    const pedidoId = pickField(
      record,
      "pedidoId",
      "PEDIDO_ID",
      "pedido",
      "id_pedido",
      "nro_pedido"
    );

    if (!pedidoId) continue;

    summaries.push({
      pedidoId,
      cliente: pickField(record, "cliente", "CLIENTE_ID", "cliente_nombre"),
      producto: pickField(record, "producto", "PRODUCTO_ID", "sku", "pt"),
      estado: pickField(record, "estado", "estado_pedido", "status"),
      cantidad: pickField(
        record,
        "cantidad",
        "cantidad_pedida",
        "qty",
        "total"
      ),
      fecha: pickField(
        record,
        "fecha",
        "fecha_pedido",
        "fecha_compromiso",
        "fechaPedido"
      ),
      raw: record,
    });
  }

  return summaries;
}
