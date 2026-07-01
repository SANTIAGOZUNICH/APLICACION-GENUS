import { rowsToRecords, pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import type { PedidoSummary } from "@/lib/adapters/drive/types/document.types";
import type { MapperSheetDiagnostic } from "@/lib/mappers/mapper-diagnostics.types";

export function extractPedidoIdFromRecord(record: Record<string, string>): string {
  return pickField(
    record,
    "pedidoId",
    "PEDIDO_ID",
    "pedido",
    "id_pedido",
    "nro_pedido",
    "numero_pedido",
    "nro",
    "numero",
    "id",
    "pedido_nro",
    "n_pedido",
    "orden",
    "oc",
    "orden_compra"
  );
}

export function parsePedidosWithDiagnostics(rows: string[][]): {
  pedidos: PedidoSummary[];
  diagnostic: MapperSheetDiagnostic;
} {
  const headersDetected = rows[0]?.map((cell) => cell.trim()).filter(Boolean) ?? [];
  const records = rowsToRecords(rows);
  const discardReasons: string[] = [];
  const byPedido = new Map<string, PedidoSummary>();

  for (const record of records) {
    const pedidoId = extractPedidoIdFromRecord(record);

    if (!pedidoId) {
      const preview = Object.values(record).filter(Boolean).slice(0, 3).join(" | ");
      discardReasons.push(
        preview
          ? `Fila sin pedidoId reconocible (${preview})`
          : "Fila vacía o sin identificador de pedido"
      );
      continue;
    }

    const summary: PedidoSummary = {
      pedidoId,
      cliente: pickField(
        record,
        "cliente",
        "CLIENTE_ID",
        "cliente_nombre",
        "nombre_cliente",
        "razon_social",
        "marca"
      ),
      producto: pickField(
        record,
        "producto",
        "PRODUCTO_ID",
        "sku",
        "pt",
        "descripcion",
        "articulo"
      ),
      estado: pickField(record, "estado", "estado_pedido", "status", "situacion"),
      cantidad: pickField(
        record,
        "cantidad",
        "cantidad_pedida",
        "qty",
        "total",
        "unidades"
      ),
      fecha: pickField(
        record,
        "fecha",
        "fecha_pedido",
        "fecha_compromiso",
        "fechaPedido",
        "compromiso",
        "entrega"
      ),
      raw: record,
    };

    const existing = byPedido.get(pedidoId);
    if (!existing) {
      byPedido.set(pedidoId, summary);
      continue;
    }

    byPedido.set(pedidoId, {
      ...existing,
      cliente: existing.cliente || summary.cliente,
      producto: existing.producto || summary.producto,
      estado: existing.estado || summary.estado,
      fecha: existing.fecha || summary.fecha,
    });
  }

  const pedidos = [...byPedido.values()];

  return {
    pedidos,
    diagnostic: {
      entity: "pedido",
      tabsAttempted: [],
      headersDetected,
      rowsRead: records.length,
      rowsMapped: pedidos.length,
      rowsDiscarded: Math.max(records.length - pedidos.length, 0),
      discardReasons: discardReasons.slice(0, 5),
      sampleRow: records[0],
    },
  };
}
