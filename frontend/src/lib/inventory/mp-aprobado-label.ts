/**
 * Etiqueta térmica “APROBADO MATERIA PRIMA” para HereLabel.
 * Medidas físicas centralizadas — iDPRT SP320 (203 dpi).
 */

/** Ancho físico de la etiqueta (mm). */
export const MP_LABEL_WIDTH_MM = 75;
/** Alto físico de la etiqueta (mm). Proporción ≈ diseño 100×67. */
export const MP_LABEL_HEIGHT_MM = 50;
/**
 * Ancho seguro de contenido (mm).
 * Márgenes L/R ≥ 2 mm; máximo imprimible SP320 ≈ 72 mm.
 */
export const MP_LABEL_SAFE_WIDTH_MM = 71;
/** DPI de la iDPRT SP320. */
export const MP_LABEL_PRINTER_DPI = 203;
/** Ancho imprimible máximo del hardware (mm). */
export const MP_LABEL_MAX_PRINTABLE_WIDTH_MM = 72;

const MM_TO_PT = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * MM_TO_PT;
}

/** Puntos físicos (dots) a DPI de impresora. */
export function mmToPrinterDots(
  mm: number,
  dpi: number = MP_LABEL_PRINTER_DPI
): number {
  return (mm / 25.4) * dpi;
}

export const MP_LABEL_WIDTH_PT = mmToPt(MP_LABEL_WIDTH_MM);
export const MP_LABEL_HEIGHT_PT = mmToPt(MP_LABEL_HEIGHT_MM);
export const MP_LABEL_SAFE_WIDTH_PT = mmToPt(MP_LABEL_SAFE_WIDTH_MM);
/** Margen L/R mínimo (mm) → (75 − 71) / 2. */
export const MP_LABEL_MARGIN_X_MM =
  (MP_LABEL_WIDTH_MM - MP_LABEL_SAFE_WIDTH_MM) / 2;
export const MP_LABEL_MARGIN_X_PT = mmToPt(MP_LABEL_MARGIN_X_MM);

export type MpAprobadoLabelSource = {
  id?: string | null;
  producto?: string | null;
  descripcion?: string | null;
  pccMeNro?: string | null;
  fecha?: string | null;
  remitoNro?: string | null;
  cantidad?: number | string | null;
  proveedor?: string | null;
  bultos?: number | string | null;
  lote?: string | null;
};

export type MpAprobadoLabelData = {
  producto: string;
  pccMeNro: string;
  ingreso: string;
  remitoNro: string;
  cantidad: string;
  proveedor: string;
  bultos: string;
  loteProveedor: string;
  sourceId: string;
};

/** Limpia celda de etiqueta: sin tabs/saltos; conserva acentos y ceros. */
export function sanitizeLabelCell(value: unknown): string {
  if (value == null) return "";
  let s = typeof value === "string" ? value : String(value);
  s = s.replace(/\r\n|\r|\n/g, " ");
  s = s.replace(/\t/g, " ");
  s = s.replace(/ {2,}/g, " ").trim();
  return s;
}

/** Fecha → DD/MM/YYYY. */
export function formatLabelDate(fecha: string | null | undefined): string {
  if (fecha == null) return "";
  const raw = String(fecha).trim();
  if (!raw) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return sanitizeLabelCell(raw);
  return sanitizeLabelCell(raw);
}

function productName(row: MpAprobadoLabelSource): string {
  const producto = sanitizeLabelCell(row.producto);
  if (producto) return producto;
  return sanitizeLabelCell(row.descripcion);
}

/** Cantidad tal cual (sin unidad — campo Unidades eliminado). */
export function formatLabelCantidad(
  cantidad: number | string | null | undefined
): string {
  if (cantidad == null || cantidad === "") return "";
  return sanitizeLabelCell(cantidad);
}

/**
 * Mapea un ingreso MP a los 8 campos de la etiqueta.
 * Campos vacíos → string vacío (no inventa datos).
 */
export function mapMpIngresoToLabelData(
  ingreso: MpAprobadoLabelSource
): MpAprobadoLabelData {
  return {
    producto: productName(ingreso),
    pccMeNro: sanitizeLabelCell(ingreso.pccMeNro),
    ingreso: formatLabelDate(ingreso.fecha),
    remitoNro: sanitizeLabelCell(ingreso.remitoNro),
    cantidad: formatLabelCantidad(ingreso.cantidad),
    proveedor: sanitizeLabelCell(ingreso.proveedor),
    bultos: sanitizeLabelCell(ingreso.bultos),
    loteProveedor: sanitizeLabelCell(ingreso.lote),
    sourceId: sanitizeLabelCell(ingreso.id) || "sin-id",
  };
}

/** Nombre de archivo: ETIQUETA-MP-{PRODUCTO}-{LOTE}.pdf */
export function mpAprobadoLabelFilename(data: {
  producto?: string | null;
  loteProveedor?: string | null;
  sourceId?: string | null;
}): string {
  const shortId = (() => {
    const raw = sanitizeLabelCell(data.sourceId) || "sin-id";
    return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "sin-id";
  })();

  const producto = sanitizeFilenamePart(data.producto);
  const lote = sanitizeFilenamePart(data.loteProveedor);

  if (!producto || !lote) {
    return `ETIQUETA-MP-${shortId}.pdf`;
  }

  return `ETIQUETA-MP-${producto}-${lote}.pdf`;
}

/** Normaliza un segmento de nombre de archivo (sin caracteres inválidos). */
export function sanitizeFilenamePart(value: unknown): string {
  const raw = sanitizeLabelCell(value);
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * Content-Disposition para forzar descarga (Safari iPhone).
 * Incluye filename* UTF-8 y fallback ASCII.
 */
export function mpLabelContentDisposition(filename: string): string {
  const safe = sanitizeLabelCell(filename) || "ETIQUETA-MP.pdf";
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(safe);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Página oficial HereLabel (App Store). No hay deep link documentado para Importar PDF. */
export const HERELABEL_OFFICIAL_STORE_URL =
  "https://apps.apple.com/app/herelabel/id1561322584";

export const HERELABEL_IMPORT_INSTRUCTION =
  "En HereLabel elegí Importar PDF y seleccioná la etiqueta recién descargada.";
