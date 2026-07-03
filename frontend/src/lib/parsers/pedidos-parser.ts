import { rowsToRecords, pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import type { WorkItemAssembler } from "@/lib/domain/work-item/work-item-assembler";
import type { WorkItemRegistry } from "@/lib/domain/work-item/work-item-registry";

export interface PedidosParserInput {
  fileId: string;
  tab: string;
  rows: string[][];
  registry: WorkItemRegistry;
  assembler: WorkItemAssembler;
}

export interface PedidosParserResult {
  enriched: number;
  warnings: string[];
}

function normalizeLote(value: string): string {
  return value.trim().toUpperCase();
}

function mapSectorFlag(value: string): "M" | "P" | null {
  const v = value.trim().toUpperCase();
  if (v === "M") return "M";
  if (v === "P") return "P";
  return null;
}

function parsePedidoRecord(
  record: Record<string, string>,
  input: PedidosParserInput
): boolean {
  const op = pickField(record, "op", "pedidoId", "pedido", "nro_pedido", "nº");
  const lote = pickField(record, "n°_lote", "n_lote", "nº_lote", "lote", "n°lote", "n°_de_lote");
  const cliente = pickField(record, "cliente", "cliente_nombre", "marca") || null;
  const producto = pickField(record, "producto", "descripcion", "sku", "pt") || null;

  if (!op && !lote && !cliente) return false;

  input.assembler.apply(
    input.registry,
    { op: op || null, loteRef: lote ? normalizeLote(lote) : null, client: cliente, product: producto },
    {
      op: op || null,
      loteRef: lote ? normalizeLote(lote) : null,
      client: cliente,
      product: producto,
      quantity: pickField(record, "q", "cantidad", "cantidad_pedida", "qty", "kg") || null,
      unit: pickField(record, "ml", "unidad", "uom") || null,
      estado: pickField(record, "estado", "estado_pedido", "status") || null,
      responsable: pickField(record, "responsable", "elaborador", "operario") || null,
      sectorComercial: mapSectorFlag(pickField(record, "s", "sector")),
      deliveryDate:
        pickField(record, "fecha_entrega", "fecha", "fecha_compromiso", "fecha_pedido") || null,
    },
    "pedidos_2026",
    { fileId: input.fileId, range: `${input.tab}!${op || lote || cliente}` }
  );

  return true;
}

/** PedidosParser — tablas PEDIDOS / ELABORACION / EXPEDICION. */
export function parsePedidosTab(input: PedidosParserInput): PedidosParserResult {
  const warnings: string[] = [];
  let enriched = 0;

  for (const record of rowsToRecords(input.rows)) {
    if (parsePedidoRecord(record, input)) enriched += 1;
  }

  if (enriched === 0) {
    warnings.push(`${input.tab}: PedidosParser sin filas con OP/lote.`);
  }

  return { enriched, warnings };
}

export const PEDIDOS_TABS = ["PEDIDOS", "ELABORACION", "EXPEDICION"] as const;
