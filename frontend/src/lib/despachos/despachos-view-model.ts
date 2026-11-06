/** Filtros, resumen por pedido y exportación de «Entregas Producción» — funciones puras (testeables). */
import { formatDespachoFecha } from "./cell-edit";
import type { DespachoRecord } from "./types";

export type DespachoEstadoFilter = "" | "sin_control" | "controlado" | "sin_entregar" | "entregado";

export interface DespachoFilters {
  desde?: string;
  hasta?: string;
  cliente?: string;
  producto?: string;
  remito?: string;
  egreso?: string;
  /** Estado de las casillas: sin controlar / controlado / sin entregar / entregado. */
  estado?: DespachoEstadoFilter;
  q?: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function filterDespachos(items: DespachoRecord[], f: DespachoFilters): DespachoRecord[] {
  const cliente = norm(f.cliente ?? "");
  const producto = norm(f.producto ?? "");
  const remito = norm(f.remito ?? "");
  const egreso = norm(f.egreso ?? "");
  const q = norm(f.q ?? "");
  return items.filter((r) => {
    if (f.desde && (!r.fecha || r.fecha < f.desde)) return false;
    if (f.hasta && (!r.fecha || r.fecha > f.hasta)) return false;
    if (cliente && !norm(r.cliente).includes(cliente)) return false;
    if (producto && !norm(r.producto).includes(producto)) return false;
    if (remito && !norm(r.remito).includes(remito)) return false;
    if (egreso && !norm(r.egreso).includes(egreso)) return false;
    if (f.estado === "sin_control" && r.control) return false;
    if (f.estado === "controlado" && !r.control) return false;
    if (f.estado === "sin_entregar" && r.entregado) return false;
    if (f.estado === "entregado" && !r.entregado) return false;
    if (q && !norm([r.egreso, r.remito, r.cliente, r.producto, r.pedidoOp, r.comentarios, formatDespachoFecha(r.fecha)].join(" ")).includes(q)) return false;
    return true;
  });
}

export interface PedidoParcial {
  pedidoOp: string;
  entregas: DespachoRecord[];
  bultos: number;
  cantidadTotal: number;
}

/** Despachos agrupados por pedido/OP (solo los que tienen pedido asociado): cada entrega parcial se suma, nunca reemplaza a otra. */
export function resumenPorPedido(items: DespachoRecord[]): PedidoParcial[] {
  const map = new Map<string, PedidoParcial>();
  for (const r of items) {
    const key = r.pedidoOp.trim();
    if (!key) continue;
    const cur = map.get(key) ?? { pedidoOp: key, entregas: [], bultos: 0, cantidadTotal: 0 };
    cur.entregas.push(r);
    cur.bultos += r.bultos;
    cur.cantidadTotal += r.cantidadTotal;
    map.set(key, cur);
  }
  return [...map.values()]
    .map((p) => ({ ...p, entregas: [...p.entregas].sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? "") || a.createdAt.localeCompare(b.createdAt)) }))
    .sort((a, b) => a.pedidoOp.localeCompare(b.pedidoOp, "es", { numeric: true }));
}

/** Las 11 columnas de la hoja «SALIDAS PROD.», en su orden. */
export const DESPACHO_EXPORT_HEADERS = ["FECHA", "EGRESO N°", "CLIENTE", "REMITO N°", "DESCRIPCIÓN", "BULTOS", "CANTIDAD", "TOTAL", "CONTROL", "ENTREGADO", "COMENTARIOS"];

/** Filas para Excel: fecha DD/MM/AAAA, remito como texto (ceros a la izquierda) y las casillas como TRUE/FALSE (como Google Sheets). */
export function despachosToRows(items: DespachoRecord[]): string[][] {
  return items.map((r) => [formatDespachoFecha(r.fecha), r.egreso, r.cliente, r.remito, r.producto, String(r.bultos), r.cantidad == null ? "" : String(r.cantidad), String(r.cantidadTotal), r.control ? "TRUE" : "FALSE", r.entregado ? "TRUE" : "FALSE", r.comentarios]);
}

/** Normaliza una fila pegada desde Excel (claves de ExcelPasteDialog) a un alta. El remito NUNCA se convierte a número. */
export const DESPACHO_PASTE_ALIASES: Record<string, string[]> = {
  fecha: ["fecha", "fecha de entrega", "fecha despacho"],
  egreso: ["egreso n", "egreso n°", "egreso nº", "egreso", "nro egreso"],
  remito: ["remito n", "remito n°", "remito nº", "n° de remito", "nº de remito", "n.º de remito", "n de remito", "nro remito", "n° remito", "nº remito", "remito", "numero de remito"],
  cliente: ["cliente"],
  producto: ["descripcion", "descripción", "producto"],
  bultos: ["bultos", "cant bultos", "cantidad de bultos"],
  cantidad: ["cantidad", "unidades por bulto", "unidades por caja"],
  control: ["control"],
  entregado: ["entregado"],
  comentarios: ["comentarios", "comentario", "observaciones"],
  pedidoOp: ["pedido", "op", "pedido/op", "orden de pedido"],
};
