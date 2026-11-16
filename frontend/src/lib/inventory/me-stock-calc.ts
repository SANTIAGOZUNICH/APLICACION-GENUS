/**
 * Stock ME — UNA sola regla, usada por el servicio en memoria, el servidor transaccional (Postgres) y la UI.
 *
 *   STOCK(código) = Σ ingresos no anulados
 *                 − Σ salidas que descuentan (OA no revertidas + MANUALES con «descuenta stock» no anuladas)
 *                 + Σ ajustes de inventario de cualquier material con ese código
 *
 * INGRESOS es un HISTORIAL de recepciones (nunca se reduce al consumir); STOCK es el saldo y se CALCULA de los movimientos.
 *
 * Por qué así:
 *  - Toda salida registrada por Depósito (hacia Producción u otro sector) descuenta al registrarse.
 *  - Las salidas de una OA se crean SOLAS al entregar la OA (me-oa-bridge) con lo USADO. Si esa misma OA ya recibió material por
 *    salidas manuales (misma OA y mismo código), el material no se resta dos veces: por cada OA+código se descuenta
 *    max(lo entregado, lo usado) — la OA descuenta solo la DIFERENCIA (sin filas tocadas: es una regla de cálculo, siempre consistente).
 *  - Las salidas manuales históricas (sin `descuentaStock`) siguen sin descontar: nada cambia de golpe.
 *  - Los ajustes se suman por CÓDIGO (no solo por el material visible): si quedó un material duplicado con el mismo
 *    código, su ajuste ya no se pierde.
 *  - El saldo puede ser NEGATIVO y se muestra así: nunca se oculta ni se lleva a cero automáticamente.
 */
import type { StockAjuste } from "./memory-repo";
import { normalizeMeCodigo } from "./me-codigo";
import type { MeIngresoRow, MeSalidaRow } from "./types";

const round = (n: number) => Number(n.toFixed(6));

/** ¿Esta salida resta stock? */
export function meSalidaDescuentaStock(r: Pick<MeSalidaRow, "origen" | "reverted" | "descuentaStock">): boolean {
  if (r.reverted) return false;
  return r.origen === "OA" || r.descuentaStock === true;
}

export function meSalidaCantidad(r: Pick<MeSalidaRow, "total" | "cantidad">): number {
  return r.total ?? r.cantidad ?? 0;
}

const OA_RE = /\bOA[\s-]?(\d{4})?[\s-]?(\d{3,})/i;
/** N.º de OA con la que se relaciona una salida: el de la OA (consumo automático) o el que figura en una salida manual (campo o texto). */
export function meSalidaOaKey(r: Pick<MeSalidaRow, "origen" | "oaNumber" | "comentarios" | "remitoNro">): string | null {
  const raw = r.oaNumber?.trim() || (r.origen === "OA" ? "" : OA_RE.exec(`${r.comentarios ?? ""} ${r.remitoNro ?? ""}`)?.[0] ?? "");
  if (!raw) return null;
  const m = OA_RE.exec(raw);
  return m ? `${m[1] ?? ""}-${Number(m[2])}` : raw.toUpperCase();
}

/**
 * Descuento total de las salidas de UN código, sin duplicar: salidas sin OA restan completas; por cada OA se resta max(entregado, usado).
 * Devuelve también el detalle por OA (para el libro de movimientos).
 */
export function meSalidasNetas(rows: ReadonlyArray<MeSalidaRow>): { total: number; groups: Array<{ oa: string; gross: number; handed: number; neteo: number }> } {
  let total = 0;
  const g = new Map<string, { gross: number; handed: number }>();
  for (const r of rows) {
    if (!meSalidaDescuentaStock(r)) continue;
    const q = meSalidaCantidad(r);
    const key = meSalidaOaKey(r);
    if (!key) { total += q; continue; }
    const e = g.get(key) ?? { gross: 0, handed: 0 };
    if (r.origen === "OA") e.gross += q; else e.handed += q;
    g.set(key, e);
  }
  const groups = [...g.entries()].map(([oa, e]) => ({ oa, gross: e.gross, handed: e.handed, neteo: Math.min(e.gross, e.handed) }));
  for (const e of groups) total += Math.max(e.gross, e.handed);
  return { total, groups };
}

export interface MeStockInputs {
  ingresos: readonly MeIngresoRow[];
  salidas: readonly MeSalidaRow[];
  ajustes: readonly StockAjuste[];
  /** Ids de material con ese código (para sumar sus ajustes). */
  materialIds: ReadonlySet<string>;
}

export function computeMeStock(codigoRaw: string, input: MeStockInputs): number {
  const codigo = normalizeMeCodigo(codigoRaw);
  if (!codigo) return 0;
  const ingresos = input.ingresos.filter((r) => !r.anulado && normalizeMeCodigo(r.codigo) === codigo).reduce((acc, r) => acc + (r.total ?? 0), 0);
  const salidas = meSalidasNetas(input.salidas.filter((r) => normalizeMeCodigo(r.codigo) === codigo)).total;
  const ajustes = input.ajustes.filter((a) => a.module === "ME" && input.materialIds.has(a.entityId)).reduce((acc, a) => acc + a.diferencia, 0);
  return round(ingresos - salidas + ajustes);
}

export type MeMovementKind = "INGRESO" | "SALIDA_OA" | "SALIDA_MANUAL" | "AJUSTE" | "NETEO_OA";
export interface MeMovement {
  id: string;
  tipo: MeMovementKind;
  /** Con signo: + suma, − resta. */
  cantidad: number;
  fecha: string;
  createdAt: string;
  usuario: string;
  referencia: string;
  detalle: string;
  /** Anulado / revertido: se muestra pero NO cuenta. */
  anulado: boolean;
  /** Saldo acumulado después de este movimiento. */
  saldo: number;
}

/** Libro de movimientos de un código, con saldo acumulado (el último saldo = stock). */
export function buildMeMovements(codigoRaw: string, input: MeStockInputs): MeMovement[] {
  const codigo = normalizeMeCodigo(codigoRaw);
  const rows: Omit<MeMovement, "saldo">[] = [];
  for (const r of input.ingresos) {
    if (normalizeMeCodigo(r.codigo) !== codigo) continue;
    rows.push({ id: r.id, tipo: "INGRESO", cantidad: r.total ?? 0, fecha: r.fecha, createdAt: r.createdAt, usuario: r.updatedBy || r.createdBy, referencia: r.ingresoNro, detalle: [r.proveedor, r.remitoNro ? `Remito ${r.remitoNro}` : ""].filter(Boolean).join(" · "), anulado: Boolean(r.anulado) });
  }
  for (const r of input.salidas) {
    if (normalizeMeCodigo(r.codigo) !== codigo) continue;
    if (r.origen !== "OA" && r.descuentaStock !== true) continue; // registro sin impacto en stock
    rows.push({ id: r.id, tipo: r.origen === "OA" ? "SALIDA_OA" : "SALIDA_MANUAL", cantidad: -meSalidaCantidad(r), fecha: r.fecha, createdAt: r.createdAt, usuario: r.updatedBy || r.createdBy, referencia: r.origen === "OA" ? (r.oaNumber ?? r.egresoNro) : r.egresoNro, detalle: r.comentarios || r.motivoSalida || "", anulado: Boolean(r.reverted) });
  }
  for (const a of input.ajustes) {
    if (a.module !== "ME" || !input.materialIds.has(a.entityId)) continue;
    rows.push({ id: a.id, tipo: "AJUSTE", cantidad: a.diferencia, fecha: a.createdAt.slice(0, 10), createdAt: a.createdAt, usuario: a.actor, referencia: "Ajuste", detalle: a.motivo, anulado: false });
  }
  // Neteo por OA: lo que ya se descontó por salidas manuales para esa OA no se resta otra vez con el consumo automático.
  for (const e of meSalidasNetas(input.salidas.filter((r) => normalizeMeCodigo(r.codigo) === codigo)).groups) {
    if (e.neteo <= 0) continue;
    const last = input.salidas.filter((r) => normalizeMeCodigo(r.codigo) === codigo && meSalidaOaKey(r) === e.oa && meSalidaDescuentaStock(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    rows.push({ id: `neteo:${e.oa}`, tipo: "NETEO_OA", cantidad: e.neteo, fecha: last?.fecha ?? "", createdAt: last?.createdAt ?? "", usuario: "Sistema", referencia: `OA ${e.oa}`, detalle: `La OA solo descuenta la diferencia: ${e.neteo} u. ya salieron por entregas de Depósito`, anulado: false });
  }
  rows.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.createdAt.localeCompare(b.createdAt));
  let saldo = 0;
  return rows.map((m) => {
    if (!m.anulado) saldo = round(saldo + m.cantidad);
    return { ...m, saldo };
  });
}
