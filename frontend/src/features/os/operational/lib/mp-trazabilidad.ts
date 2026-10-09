/**
 * Stock MP ↔ Ingresos MP: qué dato manda y cómo se ve la diferencia.
 *
 * FUENTE DE VERDAD
 *  - Stock MP (el lote) = dato VIGENTE del material en planta: producto, proveedor, descripción, lote, vencimiento,
 *    ubicación. Es lo que usan los vencimientos, los COA, las OE y los avisos. Se corrige en la celda de Stock.
 *  - Ingreso MP = DOCUMENTO de recepción: lo que llegó con el remito. No se reescribe al corregir Stock, así queda
 *    la trazabilidad del ingreso original. Sus correcciones de cantidad/código/lote (con motivo) mueven el stock por
 *    diferencia; sus datos administrativos no pisan el lote.
 *
 * Cuando el valor vigente del lote difiere del recibido en su ingreso original, las dos celdas lo muestran (marca +
 * texto al pasar el mouse). Nunca hay dos datos «vigentes»: uno es vigente y el otro es el registro de recepción.
 */
import type { MpIngresoRow, MpStockRow } from "@/lib/inventory/types";

/** Campos administrativos que existen en los dos registros. */
export const MP_TRACE_FIELDS = ["producto", "proveedor", "descripcion", "lote", "vencimiento"] as const;
export type MpTraceField = (typeof MP_TRACE_FIELDS)[number];

const norm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const show = (v: unknown) => String(v ?? "").trim() || "(vacío)";

/** Ingreso CONFIRMADO más antiguo que creó o alimentó el lote: el ingreso original. */
export function originalIngresoByLot(ingresos: MpIngresoRow[]): Map<string, MpIngresoRow> {
  const out = new Map<string, MpIngresoRow>();
  const sorted = [...ingresos]
    .filter((i) => i.status === "CONFIRMADO" && i.stockLotId)
    .sort((a, b) => `${a.fecha}|${a.createdAt}|${a.ingresoNro}`.localeCompare(`${b.fecha}|${b.createdAt}|${b.ingresoNro}`));
  for (const i of sorted) if (!out.has(i.stockLotId!)) out.set(i.stockLotId!, i);
  return out;
}

/** Valor vigente del lote para el campo (PRODUCTO vacío = sin dato propio: no se compara). */
function lotValue(lot: MpStockRow, field: MpTraceField): string | null {
  if (field === "producto") return norm(lot.producto) ? String(lot.producto) : null;
  return String(lot[field] ?? "");
}

/** Nota para la celda de Stock MP: el ingreso original recibió otro valor. */
export function stockTraceNote(lot: MpStockRow, field: MpTraceField, original: MpIngresoRow | undefined): string | null {
  if (!original) return null;
  const vigente = lotValue(lot, field);
  if (vigente === null || norm(vigente) === norm(original[field])) return null;
  return `Dato vigente (corregido en Stock MP). En el ingreso ${original.ingresoNro || "original"}${original.remitoNro ? ` (remito ${original.remitoNro})` : ""} se recibió: «${show(original[field])}». El ingreso conserva el dato original.`;
}

/** Nota para la celda de Ingresos MP: el dato vigente del lote fue corregido en Stock. */
export function ingresoTraceNote(ingreso: MpIngresoRow, field: MpTraceField, lot: MpStockRow | undefined, isOriginal: boolean): string | null {
  if (!lot || !isOriginal || ingreso.status !== "CONFIRMADO") return null;
  const vigente = lotValue(lot, field);
  if (vigente === null || norm(vigente) === norm(ingreso[field])) return null;
  return `Dato recibido en este ingreso (documento). El dato vigente del lote en Stock MP es «${show(vigente)}» (corregido ahí).`;
}
