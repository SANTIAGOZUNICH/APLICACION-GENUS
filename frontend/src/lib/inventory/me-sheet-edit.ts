/**
 * Planillas editables de Depósito ME (Ingresos, Salidas, Inventario) — política PURA compartida cliente/servidor.
 *
 *  - Ingresos: se editan todos los datos de origen. TOTAL se calcula (bultos × cantidad). Anulados: solo lectura.
 *  - Salidas MANUALES: se editan; «Descuenta stock» es una elección explícita y NUNCA para el consumo de una OA
 *    (la OA descuenta sola al entregarla). Salidas de OA: solo lectura (se corrigen desde la OA).
 *  - Inventario: el STOCK no se edita (se calcula). Se corrigen datos del material y umbrales; el saldo se corrige
 *    con un AJUSTE (motivo + historial) o corrigiendo el movimiento de origen.
 */
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import type { SectorId } from "@/types/operational/sector";
import { canWriteInventory } from "./rbac";

export type MeSheetResource = "me_ingresos" | "me_salidas" | "me_inventario";

export const ME_INGRESO_SHEET_FIELDS = ["fecha", "ingresoNro", "proveedor", "cliente", "remitoNro", "codigo", "descripcionInsumo", "bultos", "cantidad", "ubicacion"] as const;
export const ME_SALIDA_SHEET_FIELDS = ["fecha", "egresoNro", "cliente", "remitoNro", "codigo", "descripcion", "bultos", "cantidad", "unidad", "control", "entregado", "comentarios", "motivoSalida", "descuentaStock"] as const;
export const ME_MATERIAL_SHEET_FIELDS = ["descripcion", "cliente", "ubicacion", "unidad", "cantidadPorBulto", "stockMinimo", "puntoReposicion", "responsable", "observacion"] as const;

const FIELDS: Record<MeSheetResource, readonly string[]> = {
  me_ingresos: ME_INGRESO_SHEET_FIELDS,
  me_salidas: ME_SALIDA_SHEET_FIELDS,
  me_inventario: ME_MATERIAL_SHEET_FIELDS,
};
const NUMBER_FIELDS = new Set(["bultos", "cantidad", "cantidadPorBulto", "stockMinimo", "puntoReposicion"]);
const DATE_FIELDS = new Set(["fecha"]);
const BOOL_FIELDS = new Set(["control", "entregado", "descuentaStock"]);
/** Cambian el stock calculado (o a qué código cuenta): piden confirmación en la grilla. */
export const ME_STOCK_FIELDS: ReadonlySet<string> = new Set(["codigo", "bultos", "cantidad", "descuentaStock", "motivoSalida"]);
export const MAX_ME_SHEET_CHANGES = 200;
export const MIN_AJUSTE_MOTIVO = 8;

/** Motivos de una salida MANUAL. `descuenta` define si resta stock. */
export const ME_SALIDA_MOTIVOS = [
  { id: "ENTREGA_OA", label: "Entrega para una OA (no descuenta: la OA descuenta sola)", descuenta: false },
  { id: "REGISTRO", label: "Solo registro (no descuenta)", descuenta: false },
  { id: "DEVOLUCION_CLIENTE", label: "Devolución al cliente", descuenta: true },
  { id: "DESCARTE", label: "Descarte / rotura", descuenta: true },
  { id: "TRASLADO", label: "Traslado fuera del depósito", descuenta: true },
  { id: "MUESTRA", label: "Muestra", descuenta: true },
  { id: "OTRA_SALIDA", label: "Otra salida que descuenta", descuenta: true },
] as const;
export type MeSalidaMotivo = (typeof ME_SALIDA_MOTIVOS)[number]["id"];
export function meSalidaMotivo(id: string | null | undefined) {
  return ME_SALIDA_MOTIVOS.find((m) => m.id === id) ?? null;
}

export const ME_AJUSTE_TIPOS = [
  { id: "CONTEO_FISICO", label: "Conteo físico (inventario)" },
  { id: "CORRECCION_ERROR_REGISTRO", label: "Corrección de error de registro" },
  { id: "ROTURA_PERDIDA", label: "Rotura / pérdida" },
  { id: "OTRO", label: "Otro" },
] as const;

export function meSheetFieldKind(field: string): "text" | "number" | "date" {
  return NUMBER_FIELDS.has(field) ? "number" : DATE_FIELDS.has(field) ? "date" : "text";
}
export function isMeSheetField(resource: MeSheetResource, field: unknown): field is string {
  return typeof field === "string" && FIELDS[resource].includes(field);
}
export function meSheetModule(resource: MeSheetResource) {
  return resource === "me_inventario" ? "me_stock" : resource;
}

/** ¿El texto hace referencia a una OA? (p. ej. «OA-2026-000123», «OA 1234»). */
export function mentionsOa(...texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => /\bOA[\s-]?\d{2,}/i.test(t ?? ""));
}

type ProtectableRow = { anulado?: boolean; reverted?: boolean; origen?: string; archived?: boolean };

/** Motivo por el que la celda NO se edita (null = editable). */
export function meSheetProtection(resource: MeSheetResource, row: ProtectableRow, field: string, sector: SectorId | string | null | undefined, isSuperadmin = false): string | null {
  if (!isMeSheetField(resource, field)) return "Columna calculada: no se edita.";
  if (!isSuperadmin && !canWriteInventory(sector as SectorId, meSheetModule(resource))) {
    return resource === "me_inventario" ? "Tu sector no puede editar el inventario." : "Solo Depósito registra ingresos y salidas.";
  }
  if (row.anulado) return "Ingreso anulado: no se edita (conserva el historial).";
  if (row.reverted) return "Salida anulada / revertida: no se edita.";
  if (row.archived) return "Material archivado: no se edita.";
  if (resource === "me_salidas" && row.origen === "OA") return "Salida automática de una OA: se corrige desde la OA (no se descuenta dos veces).";
  return null;
}

export type MeSheetValidation = { ok: true; value: string | number | boolean | null } | { ok: false; message: string };

function parseNumber(text: string): number | null {
  const n = Number(text.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function validateMeSheetValue(resource: MeSheetResource, field: string, raw: unknown): MeSheetValidation {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "boolean" ? (raw ? "sí" : "no") : typeof raw === "string" ? raw.trim() : "";
  if (BOOL_FIELDS.has(field)) {
    if (/^(s[ií]|si|true|1|x|✓)$/i.test(text)) return { ok: true, value: true };
    if (/^(no|false|0|)$/i.test(text)) return { ok: true, value: false };
    return { ok: false, message: "Escribí Sí o No." };
  }
  if (NUMBER_FIELDS.has(field)) {
    if (!text) return field === "cantidad" && resource !== "me_inventario" ? { ok: false, message: "La cantidad es obligatoria." } : { ok: true, value: null };
    const n = parseNumber(text);
    if (n === null || n < 0 || n > 1_000_000_000) return { ok: false, message: "Número inválido (≥ 0)." };
    return { ok: true, value: n };
  }
  if (DATE_FIELDS.has(field)) {
    const iso = parseFlexibleDate(text);
    if (!text || !iso) return { ok: false, message: "Fecha inválida. Usá dd/mm/aaaa." };
    return { ok: true, value: iso };
  }
  if (field === "motivoSalida") {
    if (!text) return { ok: true, value: null };
    const m = ME_SALIDA_MOTIVOS.find((x) => x.id === text.toUpperCase() || x.label.toLowerCase() === text.toLowerCase() || x.label.toLowerCase().startsWith(text.toLowerCase()));
    return m ? { ok: true, value: m.id } : { ok: false, message: "Motivo inválido. Elegí uno de la lista." };
  }
  if (field === "codigo") {
    if (!text) return { ok: false, message: "El código es obligatorio (es la clave del inventario)." };
    return text.length > 60 ? { ok: false, message: "Máximo 60 caracteres." } : { ok: true, value: text };
  }
  if (field === "descripcion" && resource === "me_inventario" && !text) return { ok: false, message: "La descripción no puede quedar vacía." };
  const max = field === "comentarios" || field === "observacion" ? 1000 : 200;
  return text.length > max ? { ok: false, message: `Máximo ${max} caracteres.` } : { ok: true, value: text };
}

/**
 * Regla anti doble descuento para una salida MANUAL ya armada (después de aplicar los cambios).
 * Devuelve el motivo del rechazo o null.
 */
export function manualSalidaStockError(row: { origen?: string; descuentaStock?: boolean; motivoSalida?: string | null; oaNumber?: string | null; comentarios?: string; remitoNro?: string; codigo?: string; total?: number | null; cantidad?: number | null }): string | null {
  if (row.origen === "OA" || !row.descuentaStock) return null;
  const motivo = meSalidaMotivo(row.motivoSalida);
  if (motivo && !motivo.descuenta) return `El motivo «${motivo.label}» no descuenta stock.`;
  if (row.oaNumber || mentionsOa(row.comentarios, row.remitoNro)) {
    return "Esta salida menciona una OA: el consumo de una OA se descuenta solo al entregarla. Marcala como «Entrega para una OA» (no descuenta) para no descontar dos veces.";
  }
  if (!row.codigo?.trim()) return "Para descontar stock la salida necesita el código del material.";
  if (!((row.total ?? row.cantidad ?? 0) > 0)) return "Para descontar stock la cantidad debe ser mayor a 0.";
  return null;
}

export interface MeSheetChange {
  id: string;
  field: string;
  value: string;
  /** `updatedAt` del registro que el usuario tenía a la vista. */
  expectedVersion: string;
  reason?: string;
}
export type MeSheetResult = { ok: true } | { ok: false; code: "NOT_FOUND" | "PROTECTED" | "INVALID" | "CONFLICT" | "DUPLICATE"; message: string };
