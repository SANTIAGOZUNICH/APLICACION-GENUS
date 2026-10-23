/**
 * Filas en blanco de las planillas de Depósito ME (Ingresos, Salidas, Inventario): se escribe directo y el registro se
 * crea cuando la fila está completa. Convierten lo escrito en el payload que ya usa el servidor (mismas reglas que el
 * formulario: no hay un camino alternativo que se salte validaciones). Funciones puras.
 */
import { validateMeSheetValue, ME_SALIDA_MOTIVOS } from "./me-sheet-edit";
import type { DraftPayload } from "./mp-draft-rows";

export const ME_INGRESO_DRAFT_CREATE_KEYS = ["FECHA", "INGRESO Nº", "PROVEEDOR", "CLIENTE", "PRODUCTO", "REMITO Nº", "CÓDIGO", "DESCRIPCIÓN INSUMO", "BULTOS", "CANTIDAD", "TOTAL", "UBICACIÓN"];
export const ME_INGRESO_DRAFT_REQUIRED_KEYS = ["FECHA", "CÓDIGO", "CANTIDAD"];
export const ME_SALIDA_DRAFT_CREATE_KEYS = ["FECHA", "EGRESO N.º", "CLIENTE", "REMITO N.º", "DESCRIPCIÓN", "BULTOS", "CANTIDAD", "TOTAL", "CONTROL", "ENTREGADO", "COMENTARIOS", "CÓDIGO", "MOTIVO", "DESCUENTA STOCK"];
export const ME_SALIDA_DRAFT_REQUIRED_KEYS = ["FECHA", "CÓDIGO", "CANTIDAD"];
export const ME_INVENTARIO_DRAFT_CREATE_KEYS = ["CÓDIGO", "CLIENTE", "PRODUCTO", "INSUMO", "UBICACIÓN", "UNIDAD", "CANT. POR BULTO", "STOCK MÍNIMO", "PUNTO DE REPOSICIÓN"];
export const ME_INVENTARIO_DRAFT_REQUIRED_KEYS = ["CÓDIGO", "INSUMO"];

const text = (v: Record<string, string>, k: string) => (v[k] ?? "").trim();

function realIso(value: unknown): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

type Checked<T> = { ok: true; value: T } | { ok: false; message: string };
function check(resource: "me_ingresos" | "me_salidas" | "me_inventario", label: string, field: string, raw: string): Checked<string | number | boolean | null> {
  const r = validateMeSheetValue(resource, field, raw);
  if (!r.ok) return { ok: false, message: `${label}: ${r.message}` };
  if (field === "fecha" && !realIso(r.value)) return { ok: false, message: `${label}: fecha inválida. Usá dd/mm/aaaa.` };
  return { ok: true, value: r.value };
}

/** TOTAL escrito a mano en una fila nueva manda: cantidad por bulto = total ÷ bultos (sin bultos, la cantidad es el total). */
function quantityFrom(totalValue: string | number | boolean | null, bultos: number | null, cantidad: number | null): number | null {
  if (totalValue == null || totalValue === "") return cantidad;
  const total = Number(totalValue);
  return bultos && bultos > 0 ? Math.round((total / bultos) * 1e6) / 1e6 : total;
}

export function meIngresoPayloadFromDraft(id: string, v: Record<string, string>): DraftPayload {
  const fecha = check("me_ingresos", "Fecha", "fecha", text(v, "FECHA"));
  if (!fecha.ok) return fecha;
  const codigo = text(v, "CÓDIGO");
  if (!codigo) return { ok: false, message: "Código: es obligatorio (identifica el inventario)." };
  const cantidad = check("me_ingresos", "Cantidad", "cantidad", text(v, "CANTIDAD"));
  if (!cantidad.ok) return cantidad;
  const bultos = check("me_ingresos", "Bultos", "bultos", text(v, "BULTOS"));
  if (!bultos.ok) return bultos;
  const total = text(v, "TOTAL") ? check("me_ingresos", "Total", "total", text(v, "TOTAL")) : ({ ok: true, value: null } as const);
  if (!total.ok) return total;
  const qty = quantityFrom(total.value, bultos.value as number | null, cantidad.value as number | null);
  if (!(Number(qty) > 0)) return { ok: false, message: "Cantidad: tiene que ser mayor a 0." };
  const nro = text(v, "INGRESO Nº");
  return {
    ok: true,
    payload: {
      id,
      ...(nro ? { ingresoNro: nro } : {}),
      fecha: fecha.value,
      proveedor: text(v, "PROVEEDOR"),
      cliente: text(v, "CLIENTE"),
      producto: text(v, "PRODUCTO"),
      remitoNro: text(v, "REMITO Nº"),
      codigo,
      descripcionInsumo: text(v, "DESCRIPCIÓN INSUMO"),
      // El stock suma TOTAL = bultos × cantidad: sin bultos (ni total), la cantidad se toma como 1 bulto para que el ingreso no quede en 0.
      bultos: bultos.value ?? 1,
      cantidad: qty,
      ubicacion: text(v, "UBICACIÓN"),
    },
  };
}

export function meSalidaPayloadFromDraft(id: string, v: Record<string, string>): DraftPayload {
  const fecha = check("me_salidas", "Fecha", "fecha", text(v, "FECHA"));
  if (!fecha.ok) return fecha;
  const codigo = text(v, "CÓDIGO");
  if (!codigo) return { ok: false, message: "Código: es obligatorio." };
  const cantidad = check("me_salidas", "Cantidad", "cantidad", text(v, "CANTIDAD"));
  if (!cantidad.ok) return cantidad;
  const bultos = check("me_salidas", "Bultos", "bultos", text(v, "BULTOS"));
  if (!bultos.ok) return bultos;
  const total = text(v, "TOTAL") ? check("me_salidas", "Total", "total", text(v, "TOTAL")) : ({ ok: true, value: null } as const);
  if (!total.ok) return total;
  const qty = quantityFrom(total.value, bultos.value as number | null, cantidad.value as number | null);
  if (!(Number(qty) > 0)) return { ok: false, message: "Cantidad: tiene que ser mayor a 0." };
  const control = check("me_salidas", "Control", "control", text(v, "CONTROL"));
  if (!control.ok) return control;
  const entregado = check("me_salidas", "Entregado", "entregado", text(v, "ENTREGADO"));
  if (!entregado.ok) return entregado;
  const motivo = text(v, "MOTIVO") ? check("me_salidas", "Motivo", "motivoSalida", text(v, "MOTIVO")) : ({ ok: true, value: null } as const);
  if (!motivo.ok) return motivo;
  const descuenta = text(v, "DESCUENTA STOCK") ? check("me_salidas", "Descuenta stock", "descuentaStock", text(v, "DESCUENTA STOCK")) : ({ ok: true, value: undefined } as const);
  if (!descuenta.ok) return descuenta;
  const nro = text(v, "EGRESO N.º");
  void ME_SALIDA_MOTIVOS;
  return {
    ok: true,
    payload: {
      id,
      ...(nro ? { egresoNro: nro } : {}),
      fecha: fecha.value,
      cliente: text(v, "CLIENTE"),
      remitoNro: text(v, "REMITO N.º"),
      descripcion: text(v, "DESCRIPCIÓN"),
      bultos: bultos.value,
      cantidad: qty,
      control: control.value,
      entregado: entregado.value,
      comentarios: text(v, "COMENTARIOS"),
      codigo,
      motivoSalida: motivo.value,
      ...(descuenta.value !== undefined ? { descuentaStock: descuenta.value } : {}),
    },
  };
}

export function meInventarioPayloadFromDraft(id: string, v: Record<string, string>): DraftPayload {
  const codigo = text(v, "CÓDIGO");
  if (!codigo) return { ok: false, message: "Código: es obligatorio (es la clave del inventario)." };
  const insumo = text(v, "INSUMO");
  if (!insumo) return { ok: false, message: "Insumo: la descripción no puede quedar vacía." };
  const num = (label: string, field: string, key: string) => (text(v, key) ? check("me_inventario", label, field, text(v, key)) : ({ ok: true, value: null } as const));
  const porBulto = num("Cant. por bulto", "cantidadPorBulto", "CANT. POR BULTO");
  if (!porBulto.ok) return porBulto;
  const minimo = num("Stock mínimo", "stockMinimo", "STOCK MÍNIMO");
  if (!minimo.ok) return minimo;
  const punto = num("Punto de reposición", "puntoReposicion", "PUNTO DE REPOSICIÓN");
  if (!punto.ok) return punto;
  return {
    ok: true,
    payload: {
      id,
      codigo,
      descripcion: insumo,
      cliente: text(v, "CLIENTE"),
      producto: text(v, "PRODUCTO"),
      ubicacion: text(v, "UBICACIÓN"),
      unidad: text(v, "UNIDAD"),
      cantidadPorBulto: porBulto.value,
      stockMinimo: minimo.value,
      puntoReposicion: punto.value,
    },
  };
}
