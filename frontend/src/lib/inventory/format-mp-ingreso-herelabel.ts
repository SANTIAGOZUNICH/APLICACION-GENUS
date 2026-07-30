/**
 * Formato TSV de un ingreso MP para pegar en HereLabel / Excel.
 * Una sola fila, 8 columnas, sin encabezados. Separador: tab real.
 */

export type MpIngresoHereLabelInput = {
  /** Nombre materia prima / insumo (producto o descripción). */
  producto?: string | null;
  descripcion?: string | null;
  /** PCC-ME N.º */
  pccMeNro?: string | null;
  /** Fecha de ingreso (ISO YYYY-MM-DD o ya DD/MM/YYYY). */
  fecha?: string | null;
  remitoNro?: string | null;
  cantidad?: number | string | null;
  unidad?: string | null;
  proveedor?: string | null;
  bultos?: number | string | null;
  /** Lote del proveedor */
  lote?: string | null;
};

const COL_COUNT = 8;

/** Limpia una celda: sin tabs ni saltos; conserva acentos y ceros. */
export function sanitizeHereLabelCell(value: unknown): string {
  if (value == null) return "";
  let s = typeof value === "string" ? value : String(value);
  // Conservar ceros: no parsear como número.
  s = s.replace(/\r\n|\r|\n/g, " ");
  s = s.replace(/\t/g, " ");
  // Colapsar espacios múltiples introducidos por saltos, sin trim agresivo del contenido útil
  s = s.replace(/ {2,}/g, " ").trim();
  return s;
}

/** Convierte fecha a DD/MM/YYYY si es ISO; si no se reconoce, sanitiza el texto. */
export function formatHereLabelDate(fecha: string | null | undefined): string {
  if (fecha == null) return "";
  const raw = String(fecha).trim();
  if (!raw) return "";

  // YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss…
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  // Already DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    return sanitizeHereLabelCell(raw);
  }

  return sanitizeHereLabelCell(raw);
}

/** Cantidad + unidad opcional; no redondea. */
export function formatHereLabelCantidad(
  cantidad: number | string | null | undefined,
  unidad: string | null | undefined
): string {
  const qty =
    cantidad == null || cantidad === ""
      ? ""
      : sanitizeHereLabelCell(cantidad);
  const unit = sanitizeHereLabelCell(unidad);
  if (!qty && !unit) return "";
  if (qty && unit) return `${qty} ${unit}`;
  return qty || unit;
}

function productName(row: MpIngresoHereLabelInput): string {
  const producto = sanitizeHereLabelCell(row.producto);
  if (producto) return producto;
  return sanitizeHereLabelCell(row.descripcion);
}

/**
 * Devuelve exactamente una fila TSV de 8 columnas (tabs reales).
 * Campos vacíos conservan su posición (tabs consecutivos).
 */
export function formatMpIngresoForHereLabel(ingreso: MpIngresoHereLabelInput): string {
  const cols = [
    productName(ingreso),
    sanitizeHereLabelCell(ingreso.pccMeNro),
    formatHereLabelDate(ingreso.fecha),
    sanitizeHereLabelCell(ingreso.remitoNro),
    formatHereLabelCantidad(ingreso.cantidad, ingreso.unidad),
    sanitizeHereLabelCell(ingreso.proveedor),
    sanitizeHereLabelCell(ingreso.bultos),
    sanitizeHereLabelCell(ingreso.lote),
  ];

  if (cols.length !== COL_COUNT) {
    throw new Error(`HereLabel TSV debe tener ${COL_COUNT} columnas`);
  }

  return cols.join("\t");
}

/**
 * Copia texto al portapapeles. Usa Clipboard API con fallback execCommand.
 * No muta datos de negocio.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fallback abajo
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard no disponible");
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) {
    throw new Error("No se pudo copiar al portapapeles");
  }
}
