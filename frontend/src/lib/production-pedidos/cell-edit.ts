/** Edición por celda de Pedidos (Producción) — reglas puras compartidas cliente/servidor. */
import type { ProductionPedidoRecord } from "./types";

export const PEDIDO_CELL_FIELDS = ["op", "fecha", "nroOc", "cliente", "producto", "s", "q", "ml"] as const;
export type PedidoCellField = (typeof PEDIDO_CELL_FIELDS)[number];

export const PEDIDO_CELL_KIND: Record<PedidoCellField, "text" | "number" | "date"> = {
  op: "text", fecha: "date", nroOc: "text", cliente: "text", producto: "text", s: "text", q: "number", ml: "number",
};
/** Identidad / trazabilidad del pedido: edición con confirmación reforzada. */
export const PEDIDO_IDENTITY_FIELDS: ReadonlySet<PedidoCellField> = new Set(["op", "nroOc"]);

export function isPedidoCellField(v: unknown): v is PedidoCellField {
  return typeof v === "string" && (PEDIDO_CELL_FIELDS as readonly string[]).includes(v);
}

/**
 * Motivo por el que una celda NO es editable (null = editable).
 * - estado (flujo operativo) y kg (derivado de Q×ML) nunca se editan por celda.
 * - un pedido ENTREGADO está cerrado; uno eliminado no existe para edición.
 */
export function pedidoCellProtection(
  record: Pick<ProductionPedidoRecord, "estado" | "deletedAt">,
  column: string
): string | null {
  if (record.deletedAt) return "Pedido eliminado.";
  if (column === "estado") return "El estado cambia por el flujo operativo (no por celda).";
  if (column === "kg") return "KG se calcula automáticamente (Q × ML).";
  if (!isPedidoCellField(column)) return "Columna de solo lectura.";
  if (record.estado === "ENTREGADO") return "Pedido ENTREGADO: cerrado, no se modifica.";
  return null;
}

export interface PedidoCellChange {
  id: string;
  field: PedidoCellField;
  value: string;
  expectedVersion: string;
}
export interface PedidoCellFailure {
  index: number;
  id: string;
  field: string;
  code: "NOT_FOUND" | "PROTECTED" | "INVALID" | "CONFLICT" | "FORBIDDEN";
  message: string;
}
export const MAX_PEDIDO_CELL_CHANGES = 500;
