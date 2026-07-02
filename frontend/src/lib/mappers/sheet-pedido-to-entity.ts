import { Truck } from "lucide-react";
import { PEDIDO_FLOW } from "@/config/entity-pages";
import type { PedidoSummary } from "@/lib/adapters/drive/types/document.types";
import { rowsToRecords, pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";
import { ActionIds } from "@/types/actions";
import { inferPedidoStatus } from "@/lib/mappers/sheet-field-resolver";

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
      cantidad: pickField(record, "cantidad", "cantidad_pedida", "qty", "total"),
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

function inferPedidoStageId(status: Status): string {
  switch (status) {
    case Status.COMPLETO:
      return "completo";
    case Status.PARCIAL:
      return "parcial";
    default:
      return "pendiente";
  }
}

export function buildPedidoEntityPageFromRecords(
  pedidoId: string,
  records: Record<string, string>[]
): EntityPageModel | null {
  const matching = records.filter((record) => {
    const rowPedido = pickField(
      record,
      "pedidoId",
      "PEDIDO_ID",
      "pedido",
      "id_pedido",
      "nro_pedido"
    );
    return rowPedido.trim().toLowerCase() === pedidoId.trim().toLowerCase();
  });

  if (matching.length === 0) return null;

  const first = matching[0];
  const cliente = pickField(first, "cliente", "CLIENTE_ID", "cliente_nombre");
  const compromiso = pickField(
    first,
    "fecha",
    "fecha_pedido",
    "fecha_compromiso",
    "fechaPedido"
  );
  const estadoRaw = pickField(first, "estado", "estado_pedido", "status");
  const status = inferPedidoStatus(estadoRaw || "Pendiente");

  const completedRows = matching.filter((record) => {
    const rowEstado = pickField(record, "estado", "estado_pedido", "status", "despachado");
    return /compl|despach|ok|100/i.test(rowEstado);
  });

  return {
    kind: EntityPageKinds.PEDIDO,
    entityId: pedidoId,
    title: cliente || pedidoId,
    subtitle: compromiso ? `Compromiso ${compromiso}` : "Pedido comercial",
    status,
    identityIcon: Truck,
    statusFlow: PEDIDO_FLOW,
    currentStageId: inferPedidoStageId(status),
    primaryAction:
      status === Status.COMPLETO
        ? undefined
        : { label: "Seguir despacho", actionId: ActionIds.PEDIDO_DESPACHAR },
    sections: [
      {
        id: "datos",
        title: "Datos del pedido",
        content: {
          type: "key-values",
          items: [
            { id: "cliente", label: "Cliente", value: cliente || "—" },
            { id: "compromiso", label: "Compromiso", value: compromiso || "—" },
            {
              id: "avance",
              label: "Avance despacho",
              value: `${completedRows.length}/${matching.length} renglones`,
            },
            ...(estadoRaw
              ? [{ id: "estado", label: "Estado", value: estadoRaw }]
              : []),
          ],
        },
      },
      {
        id: "renglones",
        title: "Renglones",
        description: "Detalle de ítems del pedido.",
        content: {
          type: "audit-table",
          table: {
            id: `renglones-${pedidoId}`,
            columns: [
              { id: "producto", label: "Producto" },
              { id: "cantidad", label: "Cantidad" },
              { id: "estado", label: "Estado" },
              { id: "oa", label: "OA" },
            ],
            rows: matching.map((record, index) => ({
              id: `r-${index}`,
              cells: {
                producto: pickField(record, "producto", "PRODUCTO_ID", "sku", "pt"),
                cantidad: pickField(record, "cantidad", "cantidad_pedida", "qty"),
                estado: pickField(record, "estado", "estado_pedido", "status"),
                oa: pickField(record, "oa", "oa_id", "OA_ID"),
              },
            })),
          },
        },
      },
    ],
    activityLog: [
      {
        id: "pedido-loaded",
        timestamp: new Date().toISOString(),
        user: "Sistema",
        action: "Lectura desde Drive",
        description: `Pedido ${pedidoId} resuelto desde PEDIDOS 2026.`,
      },
    ],
    relatedObjects: [],
  };
}

export function buildPedidoEntityPageFromSheet(
  pedidoId: string,
  rows: string[][]
): EntityPageModel | null {
  return buildPedidoEntityPageFromRecords(pedidoId, rowsToRecords(rows));
}

export function buildPedidoSummaryCardData(summary: PedidoSummary) {
  const status = inferPedidoStatus(summary.estado || "Pendiente");
  return {
    pedidoId: summary.pedidoId,
    cliente: summary.cliente || "Cliente sin nombre",
    status,
    compromiso: summary.fecha || "—",
    avanceDespacho: summary.cantidad ? summary.cantidad : "—",
    compromisoPorVencer: false,
  };
}

/** Aggregate summaries by pedidoId for bandeja/workspace (one card per pedido). */
export function aggregatePedidoSummaries(rows: string[][]): PedidoSummary[] {
  const byPedido = new Map<string, PedidoSummary>();

  for (const summary of parsePedidoSummaries(rows)) {
    const existing = byPedido.get(summary.pedidoId);
    if (!existing) {
      byPedido.set(summary.pedidoId, summary);
      continue;
    }

    byPedido.set(summary.pedidoId, {
      ...existing,
      cliente: existing.cliente || summary.cliente,
      producto: existing.producto || summary.producto,
      estado: existing.estado || summary.estado,
      fecha: existing.fecha || summary.fecha,
    });
  }

  return [...byPedido.values()];
}
