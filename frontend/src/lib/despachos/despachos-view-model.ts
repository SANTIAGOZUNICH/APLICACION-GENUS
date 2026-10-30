/** Filtros, resumen por pedido y exportación de «Entregas Producción» — funciones puras (testeables). */
import { formatDespachoFecha } from "./cell-edit";
import type { DespachoRecord } from "./types";

export interface DespachoFilters {
  desde?: string;
  hasta?: string;
  cliente?: string;
  producto?: string;
  remito?: string;
  q?: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function filterDespachos(items: DespachoRecord[], f: DespachoFilters): DespachoRecord[] {
  const cliente = norm(f.cliente ?? "");
  const producto = norm(f.producto ?? "");
  const remito = norm(f.remito ?? "");
  const q = norm(f.q ?? "");
  return items.filter((r) => {
    if (f.desde && r.fecha < f.desde) return false;
    if (f.hasta && r.fecha > f.hasta) return false;
    if (cliente && !norm(r.cliente).includes(cliente)) return false;
    if (producto && !norm(r.producto).includes(producto)) return false;
    if (remito && !norm(r.remito).includes(remito)) return false;
    if (q && !norm([r.remito, r.cliente, r.producto, r.pedidoOp, formatDespachoFecha(r.fecha)].join(" ")).includes(q)) return false;
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
    .map((p) => ({ ...p, entregas: [...p.entregas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.createdAt.localeCompare(b.createdAt)) }))
    .sort((a, b) => a.pedidoOp.localeCompare(b.pedidoOp, "es", { numeric: true }));
}

export const DESPACHO_EXPORT_HEADERS = ["Fecha", "N.º de remito", "Cliente", "Producto", "Bultos", "Cantidad total"];

/** Filas para Excel: fecha DD/MM/AAAA y remito como texto (la hoja lo recibe tal cual, con ceros a la izquierda). */
export function despachosToRows(items: DespachoRecord[]): string[][] {
  return items.map((r) => [formatDespachoFecha(r.fecha), r.remito, r.cliente, r.producto, String(r.bultos), String(r.cantidadTotal)]);
}

/** Normaliza una fila pegada desde Excel (claves de ExcelPasteDialog) a un alta. El remito NUNCA se convierte a número. */
export const DESPACHO_PASTE_ALIASES: Record<string, string[]> = {
  fecha: ["fecha", "fecha de entrega", "fecha despacho"],
  remito: ["n° de remito", "nº de remito", "n.º de remito", "n de remito", "nro remito", "n° remito", "nº remito", "remito", "numero de remito"],
  cliente: ["cliente"],
  producto: ["producto", "descripcion", "descripción"],
  bultos: ["bultos", "cant bultos", "cantidad de bultos"],
  cantidadTotal: ["cantidad total", "cantidad", "total", "unidades"],
  pedidoOp: ["pedido", "op", "pedido/op", "orden de pedido"],
};
