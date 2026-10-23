/**
 * DIFERENCIA de material de empaque (ME) contra lo que pide el pedido — UNA sola regla, sin tocar el stock.
 *
 *   necesario  = Σ (unidades del pedido ACTIVO vinculado × unidades de este material por producto terminado)
 *   diferencia = stock REAL del material (misma cuenta que STOCK ME) − necesario
 *
 *  diferencia < 0 → FALTAN · > 0 → SOBRAN · = 0 → JUSTO.
 *  Sin pedido vinculado → SIN DATOS; con pedido pero sin consumo por producto → SIN CONFIGURAR (nunca se asume 1:1).
 */
export type MeDiferenciaEstado = "FALTAN" | "SOBRAN" | "JUSTO" | "SIN_CONFIGURAR" | "SIN_DATOS";

export interface MeDiferenciaLink {
  pedidoId: string;
  /** Unidades del pedido (production_pedidos.q); null si el pedido no tiene cantidad. */
  pedidoUnidades: number | null;
  /** Unidades de este material por producto terminado; null = consumo sin configurar. */
  unidadesPorProducto: number | null;
}

export interface MeDiferencia {
  estado: MeDiferenciaEstado;
  stock: number;
  /** Cantidad necesaria según pedido(s) vinculados; null si no se puede calcular. */
  necesario: number | null;
  /** stock − necesario (con signo); null si no se puede calcular. */
  diferencia: number | null;
}

const round = (n: number) => Number(n.toFixed(6));

/** `links` = SOLO pedidos activos (el llamador excluye entregados / eliminados). */
export function computeMeDiferencia(stock: number, links: readonly MeDiferenciaLink[]): MeDiferencia {
  const base = { stock: round(stock), necesario: null, diferencia: null };
  if (links.length === 0) return { estado: "SIN_DATOS", ...base };
  let necesario = 0;
  for (const l of links) {
    if (l.pedidoUnidades == null || !Number.isFinite(l.pedidoUnidades)) return { estado: "SIN_DATOS", ...base };
    if (l.unidadesPorProducto == null || !(l.unidadesPorProducto > 0)) return { estado: "SIN_CONFIGURAR", ...base };
    necesario += l.pedidoUnidades * l.unidadesPorProducto;
  }
  necesario = round(necesario);
  const diferencia = round(stock - necesario);
  return { estado: diferencia < 0 ? "FALTAN" : diferencia > 0 ? "SOBRAN" : "JUSTO", stock: round(stock), necesario, diferencia };
}

/** Texto compacto de la celda: «−200 FALTAN», «+200 SOBRAN», «0 JUSTO», «SIN CONFIGURAR», «—». */
export function formatMeDiferencia(d: Pick<MeDiferencia, "estado" | "diferencia">): string {
  const n = (v: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Math.abs(v));
  switch (d.estado) {
    case "FALTAN": return `−${n(d.diferencia ?? 0)} FALTAN`;
    case "SOBRAN": return `+${n(d.diferencia ?? 0)} SOBRAN`;
    case "JUSTO": return "0 JUSTO";
    case "SIN_CONFIGURAR": return "SIN CONFIGURAR";
    default: return "SIN DATOS";
  }
}

/** Tono de la celda: rojo = faltan, verde = sobran/justo, neutro = sin datos. */
export function meDiferenciaTone(estado: MeDiferenciaEstado): "red" | "green" | "neutral" {
  return estado === "FALTAN" ? "red" : estado === "SOBRAN" || estado === "JUSTO" ? "green" : "neutral";
}

export interface MeDiferenciaPedido {
  pedidoId: string;
  producto: string;
  unidades: number | null;
  unidadesPorProducto: number | null;
}
export interface MeDiferenciaRow extends MeDiferencia {
  materialId: string;
  pedidos: MeDiferenciaPedido[];
}

