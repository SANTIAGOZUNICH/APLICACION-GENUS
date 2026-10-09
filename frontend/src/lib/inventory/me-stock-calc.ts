/**
 * Stock ME — UNA sola regla, usada por el servicio en memoria, el servidor transaccional (Postgres) y la UI.
 *
 *   STOCK(código) = Σ ingresos no anulados
 *                 − Σ salidas que descuentan (OA no revertidas + MANUALES marcadas «descuenta stock» no anuladas)
 *                 + Σ ajustes de inventario de cualquier material con ese código
 *
 * Por qué así (Etapa 2):
 *  - Las salidas de una OA se crean SOLAS al entregar la OA (me-oa-bridge). Una salida manual que registra la entrega
 *    física para una OA NO descuenta: si lo hiciera, el mismo consumo se restaría dos veces.
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
  const salidas = input.salidas.filter((r) => meSalidaDescuentaStock(r) && normalizeMeCodigo(r.codigo) === codigo).reduce((acc, r) => acc + meSalidaCantidad(r), 0);
  const ajustes = input.ajustes.filter((a) => a.module === "ME" && input.materialIds.has(a.entityId)).reduce((acc, a) => acc + a.diferencia, 0);
  return round(ingresos - salidas + ajustes);
}

export type MeMovementKind = "INGRESO" | "SALIDA_OA" | "SALIDA_MANUAL" | "AJUSTE";
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
  rows.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.createdAt.localeCompare(b.createdAt));
  let saldo = 0;
  return rows.map((m) => {
    if (!m.anulado) saldo = round(saldo + m.cantidad);
    return { ...m, saldo };
  });
}
