/**
 * Filas en blanco de «Stock» e «Ingresos MP»: traduce lo escrito en las celdas (claves = encabezados de la planilla) al
 * pedido que crea el registro, validando con las MISMAS reglas que la edición por celda. Funciones puras.
 */
import { validateInventoryValue } from "./cell-edit";
import { validateMpSheetValue } from "./mp-sheet-edit";

export const MP_STOCK_DRAFT_CREATE_KEYS = ["CÓDIGO", "PROVEEDOR", "CLIENTE", "DESCRIPCIÓN MATERIA PRIMA", "CANTIDAD (KG)", "UBICACIÓN", "LOTE", "VENCIMIENTO"];
export const MP_STOCK_DRAFT_REQUIRED_KEYS = ["DESCRIPCIÓN MATERIA PRIMA", "LOTE", "CANTIDAD (KG)"];
export const MP_INGRESO_DRAFT_CREATE_KEYS = ["FECHA", "PROVEEDOR", "CLIENTE", "REMITO Nº", "CÓDIGO", "PRODUCTO", "DESCRIPCIÓN MATERIA PRIMA", "BULTOS", "CANTIDAD (kg/u)", "UBICACIÓN", "LOTE", "VENCIMIENTO"];
export const MP_INGRESO_DRAFT_REQUIRED_KEYS = ["FECHA", "DESCRIPCIÓN MATERIA PRIMA", "PROVEEDOR", "LOTE", "CANTIDAD (kg/u)"];

export type DraftPayload = { ok: true; payload: Record<string, unknown> } | { ok: false; message: string };

const text = (v: Record<string, string>, k: string) => (v[k] ?? "").trim();

/** Fecha ISO real (rechaza 31/02 o mes 99, que el parser flexible deja pasar). */
function realIso(value: unknown): boolean {
  if (typeof value !== "string" || value === "") return true;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function check<T>(label: string, r: { ok: true; value: T } | { ok: false; message: string }): { ok: true; value: T } | { ok: false; message: string } {
  if (!r.ok) return { ok: false, message: `${label}: ${r.message}` };
  if (label === "Fecha" || label === "Vencimiento") return realIso(r.value) ? r : { ok: false, message: `${label}: fecha inválida. Usá dd/mm/aaaa.` };
  return r;
}

export function stockPayloadFromDraft(id: string, v: Record<string, string>): DraftPayload {
  const kg = check("Cantidad (kg)", validateInventoryValue("cantidadKg", text(v, "CANTIDAD (KG)")));
  if (!kg.ok) return kg;
  const venc = check("Vencimiento", validateInventoryValue("vencimiento", text(v, "VENCIMIENTO")));
  if (!venc.ok) return venc;
  const codigoRaw = text(v, "CÓDIGO");
  const codigo = codigoRaw ? check("Código", validateInventoryValue("codigo", codigoRaw)) : ({ ok: true, value: "" } as const);
  if (!codigo.ok) return codigo;
  return {
    ok: true,
    payload: {
      id,
      proveedor: text(v, "PROVEEDOR"),
      cliente: text(v, "CLIENTE"),
      descripcion: text(v, "DESCRIPCIÓN MATERIA PRIMA"),
      cantidadKg: kg.value,
      ubicacion: text(v, "UBICACIÓN"),
      lote: text(v, "LOTE"),
      vencimiento: venc.value,
      origen: "planilla",
      codigo: codigo.value,
    },
  };
}

export function ingresoPayloadFromDraft(id: string, v: Record<string, string>): DraftPayload {
  const fecha = check("Fecha", validateMpSheetValue("mp_ingresos", "fecha", text(v, "FECHA")));
  if (!fecha.ok) return fecha;
  const cantidad = check("Cantidad", validateMpSheetValue("mp_ingresos", "cantidad", text(v, "CANTIDAD (kg/u)")));
  if (!cantidad.ok) return cantidad;
  if (!(Number(cantidad.value) > 0)) return { ok: false, message: "Cantidad: tiene que ser mayor a 0." };
  const bultos = check("Bultos", validateMpSheetValue("mp_ingresos", "bultos", text(v, "BULTOS")));
  if (!bultos.ok) return bultos;
  const venc = check("Vencimiento", validateMpSheetValue("mp_ingresos", "vencimiento", text(v, "VENCIMIENTO")));
  if (!venc.ok) return venc;
  return {
    ok: true,
    payload: {
      id,
      fecha: fecha.value,
      proveedor: text(v, "PROVEEDOR"),
      cliente: text(v, "CLIENTE"),
      remitoNro: text(v, "REMITO Nº"),
      codigo: text(v, "CÓDIGO"),
      producto: text(v, "PRODUCTO"),
      descripcion: text(v, "DESCRIPCIÓN MATERIA PRIMA"),
      bultos: bultos.value,
      cantidad: cantidad.value,
      ubicacion: text(v, "UBICACIÓN"),
      lote: text(v, "LOTE"),
      vencimiento: venc.value,
    },
  };
}
