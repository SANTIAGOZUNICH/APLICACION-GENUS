/**
 * Reglas puras del Control de facturación. Sin importes: solo unidades.
 * Pedido ≠ producido ≠ entregado ≠ facturado. Entregar NO es facturar, y facturar NO mueve stock ni cambia lo entregado.
 */

export const DELIVERY_STATES = ["SIN_ENTREGAS", "ENTREGA_PARCIAL", "ENTREGA_COMPLETA"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const INVOICING_STATES = [
  "SIN_ENTREGAS",
  "PENDIENTE_DE_FACTURAR",
  "FACTURACION_PARCIAL",
  "FACTURADO",
  "CON_INCIDENCIA",
] as const;
export type InvoicingState = (typeof INVOICING_STATES)[number];

export const INVOICING_STATE_LABEL: Record<InvoicingState, string> = {
  SIN_ENTREGAS: "SIN ENTREGAS",
  PENDIENTE_DE_FACTURAR: "PENDIENTE DE FACTURAR",
  FACTURACION_PARCIAL: "FACTURACIÓN PARCIAL",
  FACTURADO: "FACTURADO",
  CON_INCIDENCIA: "ANULADO / CON INCIDENCIA",
};

export const DELIVERY_STATE_LABEL: Record<DeliveryState, string> = {
  SIN_ENTREGAS: "Sin entregas",
  ENTREGA_PARCIAL: "Entrega parcial",
  ENTREGA_COMPLETA: "Entrega completa",
};

const EPS = 1e-6;

export type BillingQuantities = {
  /** Cantidad pedida (null = sin dato numérico). */
  requested: number | null;
  /** Entregada acumulada (líneas de entrega ACTIVAS). */
  delivered: number;
  /** Facturada acumulada (renglones de factura ACTIVOS sobre facturas ACTIVAS). */
  invoiced: number;
  /** Hay una factura activa sobre entregas anuladas, o facturado > entregado. */
  hasIncidence?: boolean;
};

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function computeDeliveryState(q: Pick<BillingQuantities, "requested" | "delivered">): DeliveryState {
  if (q.delivered <= EPS) return "SIN_ENTREGAS";
  if (q.requested != null && q.requested > EPS && q.delivered + EPS < q.requested) return "ENTREGA_PARCIAL";
  return "ENTREGA_COMPLETA";
}

/** Estado de FACTURACIÓN: se mide contra lo ENTREGADO, no contra lo pedido (un pedido puede estar FACTURADO y con entrega parcial). */
export function computeInvoicingState(q: BillingQuantities): InvoicingState {
  if (q.hasIncidence || q.invoiced > q.delivered + EPS) return "CON_INCIDENCIA";
  if (q.delivered <= EPS) return "SIN_ENTREGAS";
  if (q.invoiced + EPS >= q.delivered) return "FACTURADO";
  if (q.invoiced > EPS) return "FACTURACION_PARCIAL";
  return "PENDIENTE_DE_FACTURAR";
}

export function computeBalances(q: BillingQuantities) {
  const pendingDelivery = q.requested != null ? Math.max(0, round6(q.requested - q.delivered)) : null;
  const pendingInvoice = Math.max(0, round6(q.delivered - q.invoiced));
  return { pendingDelivery, pendingInvoice };
}

export type InvoiceValidation = { ok: true } | { ok: false; error: string };

/** Valida un renglón de facturación: positivo, no más de lo entregado y todavía disponible para facturar. */
export function validateInvoiceQuantity(args: { quantity: number; deliveredLine: number; invoicedLine: number; integerUnits?: boolean }): InvoiceValidation {
  const { quantity, deliveredLine, invoicedLine } = args;
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: "La cantidad a facturar debe ser mayor que cero." };
  if (args.integerUnits && Math.abs(quantity - Math.round(quantity)) > EPS) return { ok: false, error: "La cantidad a facturar debe ser un número entero de unidades." };
  const available = round6(deliveredLine - invoicedLine);
  if (quantity > available + EPS) {
    return { ok: false, error: `No se puede facturar más de lo entregado y disponible: quedan ${available} u. por facturar en esa entrega.` };
  }
  return { ok: true };
}

export function normalizeInvoiceNumber(raw: string): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeClientKey(raw: string): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}
