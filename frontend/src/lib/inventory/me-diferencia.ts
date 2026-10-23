/**
 * DIFERENCIA de material de empaque (ME) contra lo que pide el pedido — UNA sola regla, sin tocar el stock.
 *
 *   necesario  = Σ (unidades del pedido ACTIVO vinculado × unidades de este material por producto terminado)
 *   diferencia = stock REAL del material (misma cuenta que STOCK ME) − necesario
 *
 *  diferencia < 0 → FALTAN · > 0 → SOBRAN · = 0 → JUSTO.
 *  Sin pedido vinculado → SIN DATOS; con pedido pero sin consumo por producto → SIN CONFIGURAR (nunca se asume 1:1).
 */
export type MeDiferenciaEstado = "FALTAN" | "SOBRAN" | "JUSTO" | "SIN_CONFIGURAR" | "SIN_DATOS" | "ELEGIR_PEDIDO";

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
    case "ELEGIR_PEDIDO": return "ELEGIR PEDIDO";
    default: return "SIN DATOS";
  }
}

/** Tono de la celda: rojo = faltan, verde = sobran/justo, neutro = sin datos. */
export function meDiferenciaTone(estado: MeDiferenciaEstado): "red" | "green" | "neutral" {
  return estado === "FALTAN" ? "red" : estado === "SOBRAN" || estado === "JUSTO" ? "green" : "neutral";
}

/**
 * DIFERENCIA de INGRESOS ME — control de recepción, NO de stock.
 *
 *   acumulado(ingreso) = Σ ingresos confirmados (no anulados) del MISMO código y MISMO pedido, hasta ese ingreso inclusive
 *                        (orden de registro). Nunca usa el saldo de Stock ME: los consumos posteriores no lo alteran.
 *   diferencia         = acumulado − (unidades del pedido × consumo por producto)
 *
 * Cada ingreso guarda un SNAPSHOT del resultado del momento en que se pudo calcular (pedido + consumo conocidos). Las
 * correcciones posteriores (pedido que cambia de cantidad, consumo, ingresos anteriores corregidos) no lo reescriben: se
 * muestra aparte como «hoy». Editar el propio ingreso lo recalcula y deja el cambio en la auditoría.
 */
export interface IngresoDifSnapshot {
  pedidoId: string;
  acumulado: number;
  necesario: number;
  diferencia: number;
  estado: "FALTAN" | "SOBRAN" | "JUSTO";
  pedidoUnidades: number;
  unidadesPorProducto: number;
  calculadoAt: string;
}

export interface IngresoDifInput {
  id: string;
  /** Código normalizado. */
  codigo: string;
  pedidoId: string | null | undefined;
  total: number | null | undefined;
  createdAt: string;
  anulado?: boolean;
}

/** Acumulado por ingreso (por código + pedido, en orden de registro). Los ingresos sin pedido no acumulan. */
export function acumuladoPorIngreso(rows: readonly IngresoDifInput[]): Map<string, number> {
  const groups = new Map<string, IngresoDifInput[]>();
  for (const r of rows) {
    if (r.anulado || !r.pedidoId || !r.codigo) continue;
    const k = `${r.codigo}|${r.pedidoId}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out = new Map<string, number>();
  for (const list of groups.values()) {
    let acc = 0;
    for (const r of [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
      acc = round(acc + (r.total ?? 0));
      out.set(r.id, acc);
    }
  }
  return out;
}

export interface IngresoDiferenciaRow extends MeDiferencia {
  /** Lo que se muestra en la fila: el snapshot histórico si existe; si no, el cálculo actual. */
  acumulado: number | null;
  pedidoId: string | null;
  pedidoUnidades: number | null;
  unidadesPorProducto: number | null;
  snapshot: IngresoDifSnapshot | null;
  /** Cálculo de hoy (con el pedido, consumo e ingresos actuales). */
  actual: Pick<MeDiferencia, "estado" | "diferencia">;
  /** Pedidos activos del cliente con ese producto (>1 sin elegir = ELEGIR PEDIDO). */
  candidatos: number;
}

/** Arma lo que se muestra: snapshot si existe (resultado del momento del ingreso) + «hoy» si hoy da distinto. */
export function ingresoDiferenciaView(row: Pick<IngresoDiferenciaRow, "snapshot" | "actual" | "estado" | "diferencia">): { estado: MeDiferenciaEstado; text: string; diferencia: number | null } {
  const base = row.snapshot ? { estado: row.snapshot.estado as MeDiferenciaEstado, diferencia: row.snapshot.diferencia } : { estado: row.estado, diferencia: row.diferencia };
  let text = formatMeDiferencia(base);
  const hoyDistinto = row.snapshot && ["FALTAN", "SOBRAN", "JUSTO"].includes(row.actual.estado) && (row.actual.estado !== row.snapshot.estado || row.actual.diferencia !== row.snapshot.diferencia);
  if (hoyDistinto) text += ` · hoy ${formatMeDiferencia(row.actual)}`;
  return { estado: base.estado, text, diferencia: base.diferencia };
}

/** Datos para la diferencia PREVISTA de una fila nueva (sin confirmar): pedidos del cliente + acumulados y consumos por código y pedido. */
export interface IngresoPrevistoContext {
  pedidos: Array<{ id: string; cliente: string; producto: string; unidades: number | null }>;
  /** `${codigo}|${pedidoId}` → acumulado ya ingresado. */
  acumulados: Record<string, number>;
  /** `${codigo}|${pedidoId}` → consumo por producto (null = sin configurar). */
  consumos: Record<string, number | null>;
}

const normT = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/** Previsión para un ingreso todavía sin registrar. No toca nada: solo suma lo escrito al acumulado del grupo. */
export function ingresoPrevisto(ctx: IngresoPrevistoContext, draft: { codigo: string; cliente: string; producto: string; total: number }): Pick<MeDiferencia, "estado" | "diferencia"> {
  const sinDatos = { estado: "SIN_DATOS" as const, diferencia: null };
  const cands = ctx.pedidos.filter((p) => normT(p.cliente) === normT(draft.cliente) && normT(p.producto) === normT(draft.producto) && draft.producto.trim());
  if (cands.length === 0) return sinDatos;
  if (cands.length > 1) return { estado: "ELEGIR_PEDIDO", diferencia: null };
  const p = cands[0]!;
  const k = `${normT(draft.codigo)}|${p.id}`;
  const d = computeMeDiferencia((ctx.acumulados[k] ?? 0) + draft.total, [{ pedidoId: p.id, pedidoUnidades: p.unidades, unidadesPorProducto: ctx.consumos[k] ?? null }]);
  return { estado: d.estado, diferencia: d.diferencia };
}

export interface IngresoDiferenciasPayload {
  ingresos: Record<string, IngresoDiferenciaRow>;
  /** Solo para quien puede escribir ingresos: lo necesario para la diferencia PREVISTA de filas nuevas. */
  previsto?: IngresoPrevistoContext;
}

