/**
 * Métricas — interpretación de datos pegados desde Excel / Google Sheets (lógica pura, sin React ni servidor).
 *
 * El portapapeles de una planilla es TSV: columnas separadas por tabulador, filas por salto de línea; Google Sheets y
 * Excel encierran entre comillas las celdas que contienen tabuladores, saltos o comillas. Este módulo:
 *  1. separa el texto en filas/columnas respetando comillas;
 *  2. detecta (o no) una fila de encabezados y respeta el ORDEN de las columnas pegadas;
 *  3. interpreta fechas (dd/mm/aaaa, aaaa-mm-dd…) y números con coma decimal / punto de miles (es-AR);
 *  4. devuelve, por fila, los valores ya normalizados y el error de CADA celda inválida.
 * El servidor vuelve a validar todo con las mismas funciones: lo que llega del navegador nunca se da por bueno.
 */
import { METRICS_SECTORS, normalizeResponsibleKey, type MetricsSector } from "./types";

export type MetricsField = "metricDate" | "sector" | "product" | "units" | "responsibleDisplay";

export const METRICS_FIELD_LABEL: Record<MetricsField, string> = {
  metricDate: "Fecha",
  sector: "Sector",
  product: "Producto",
  units: "Unidades",
  responsibleDisplay: "Responsable",
};

/** Una fila lista para enviar al servidor (valores ya normalizados). */
export interface MetricsImportRow {
  metricDate: string;
  product: string | null;
  units: number;
  responsibleDisplay: string;
  sector: MetricsSector;
}

/** Una fila interpretada del portapapeles: lo que se pudo leer + el error de cada celda. */
export interface ParsedMetricsRow {
  /** Posición (1-based) dentro de lo pegado, sin contar el encabezado. */
  line: number;
  /** Texto original de cada celda por campo (para mostrarlo y poder corregirlo). */
  raw: Partial<Record<MetricsField, string>>;
  metricDate: string | null;
  product: string | null;
  units: number | null;
  responsibleDisplay: string | null;
  sector: MetricsSector | null;
  errors: Partial<Record<MetricsField, string>>;
  /** ¿Toda la fila es válida? */
  valid: boolean;
}

/** Texto del portapapeles → matriz de celdas (TSV con comillas, CRLF/LF, sin la fila final vacía). */
export function parseClipboardTable(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellStarted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
      cellStarted = false;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      cellStarted = false;
    } else {
      cell += ch;
      cellStarted = true;
    }
  }
  if (cellStarted || cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Se descartan filas totalmente vacías (típico: línea final del portapapeles).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Entero con formato es-AR: «1.200», «1200», «1 200», «1200,0». Decimales reales → error. */
export function parseMetricUnits(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const text = raw.trim().replace(/\s| /g, "");
  if (!text) return { ok: false, message: "Unidades obligatorias." };
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) normalized = text.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(,\d+)?$/.test(text)) normalized = text.replace(",", ".");
  else if (/^\d+(\.\d+)?$/.test(text)) normalized = text;
  else return { ok: false, message: `«${raw.trim()}» no es un número.` };
  const n = Number(normalized);
  if (!Number.isFinite(n)) return { ok: false, message: `«${raw.trim()}» no es un número.` };
  if (n < 0) return { ok: false, message: "Las unidades no pueden ser negativas." };
  if (!Number.isInteger(n)) return { ok: false, message: "Las unidades deben ser un número entero (sin decimales)." };
  if (n > 2_000_000_000) return { ok: false, message: "Cantidad demasiado grande." };
  return { ok: true, value: n };
}

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Fecha: «15/10/2026», «15-10-26», «15.10.2026», «2026-10-15». Siempre día/mes/año (formato argentino). */
export function parseMetricDate(raw: string): { ok: true; iso: string } | { ok: false; message: string } {
  const text = raw.trim();
  if (!text) return { ok: false, message: "Fecha obligatoria." };
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(text);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (dmy) {
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
    if (dmy[3]!.length === 2) y += 2000;
  } else {
    return { ok: false, message: `«${text}» no es una fecha (usá dd/mm/aaaa).` };
  }
  if (y < 2000 || y > 2100) return { ok: false, message: `Año fuera de rango (${y}).` };
  if (!isRealDate(y, m, d)) return { ok: false, message: `«${text}» no es una fecha real.` };
  return { ok: true, iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function parseMetricSector(raw: string): MetricsSector | null {
  const t = fold(raw).replace(/[_\s]+/g, " ");
  if (!t) return null;
  if (t === "envasado masivo" || t === "masivo") return "ENVASADO_MASIVO";
  if (t === "envasado premium" || t === "premium") return "ENVASADO_PREMIUM";
  return null;
}

const HEADER_ALIASES: Record<string, MetricsField> = {
  fecha: "metricDate",
  dia: "metricDate",
  sector: "sector",
  producto: "product",
  articulo: "product",
  unidades: "units",
  unidad: "units",
  cantidad: "units",
  "cant.": "units",
  "un.": "units",
  responsable: "responsibleDisplay",
  operario: "responsibleDisplay",
};

function headerField(cell: string): MetricsField | null {
  return HEADER_ALIASES[fold(cell)] ?? null;
}

export interface InterpretOptions {
  /** Producción pega con columna Sector (o elige uno por defecto); Envasado usa siempre el suyo. */
  isAdmin: boolean;
  /** Sector que se aplica cuando la fila no trae Sector (obligatorio para Envasado; opcional para Producción). */
  defaultSector: MetricsSector | null;
}

export interface InterpretResult {
  rows: ParsedMetricsRow[];
  /** Campos en el orden en que vinieron en el portapapeles. */
  columns: MetricsField[];
  headerDetected: boolean;
}

/** Orden por defecto cuando no hay encabezado: Fecha · [Sector] · Producto · Unidades · Responsable. */
export function defaultColumnOrder(isAdmin: boolean): MetricsField[] {
  return isAdmin
    ? ["metricDate", "sector", "product", "units", "responsibleDisplay"]
    : ["metricDate", "product", "units", "responsibleDisplay"];
}

export function interpretMetricsPaste(text: string, opts: InterpretOptions): InterpretResult {
  const table = parseClipboardTable(text);
  if (table.length === 0) return { rows: [], columns: [], headerDetected: false };

  const first = table[0]!;
  const headerFields = first.map(headerField);
  const recognised = headerFields.filter((f): f is MetricsField => f != null);
  const headerDetected = recognised.length >= 2 && new Set(recognised).size === recognised.length;

  let columns: MetricsField[];
  let body: string[][];
  if (headerDetected) {
    // Columnas no reconocidas (p. ej. «Obs.») se ignoran; las reconocidas respetan el orden pegado.
    columns = headerFields.map((f) => f ?? ("ignore" as unknown as MetricsField));
    body = table.slice(1);
  } else {
    const order = defaultColumnOrder(opts.isAdmin);
    // Si el pegado trae 5 columnas y no es admin (o 4 y es admin) se asume el orden con/sin Sector según el ancho.
    const width = Math.max(...table.map((r) => r.length));
    columns = width === 5 ? defaultColumnOrder(true) : width <= 4 ? defaultColumnOrder(false) : order;
    body = table;
  }

  const rows = body.map((cells, idx): ParsedMetricsRow => {
    const raw: Partial<Record<MetricsField, string>> = {};
    columns.forEach((field, i) => {
      if ((field as string) === "ignore") return;
      raw[field] = (cells[i] ?? "").trim();
    });
    return validateParsedRow(idx + 1, raw, opts);
  });
  return {
    rows,
    columns: columns.filter((c) => (c as string) !== "ignore"),
    headerDetected,
  };
}

/** Valida una fila (también se usa al corregir una celda en la vista previa). */
export function validateParsedRow(
  line: number,
  raw: Partial<Record<MetricsField, string>>,
  opts: InterpretOptions
): ParsedMetricsRow {
  const errors: Partial<Record<MetricsField, string>> = {};

  const date = parseMetricDate(raw.metricDate ?? "");
  if (!date.ok) errors.metricDate = date.message;

  const units = parseMetricUnits(raw.units ?? "");
  if (!units.ok) errors.units = units.message;

  const responsibleDisplay = (raw.responsibleDisplay ?? "").trim();
  if (!responsibleDisplay) errors.responsibleDisplay = "Responsable obligatorio.";

  let sector: MetricsSector | null = null;
  if (opts.isAdmin) {
    const sectorText = (raw.sector ?? "").trim();
    if (sectorText) {
      sector = parseMetricSector(sectorText);
      if (!sector) errors.sector = `«${sectorText}» no es un sector válido (Masivo o Premium).`;
    } else if (opts.defaultSector) {
      sector = opts.defaultSector;
    } else {
      errors.sector = "Indicá el sector (Masivo o Premium).";
    }
  } else {
    sector = opts.defaultSector;
    if (!sector) errors.sector = "Sector no autorizado.";
  }

  const product = (raw.product ?? "").trim();
  return {
    line,
    raw,
    metricDate: date.ok ? date.iso : null,
    product: product || null,
    units: units.ok ? units.value : null,
    responsibleDisplay: responsibleDisplay || null,
    sector,
    errors,
    valid: Object.keys(errors).length === 0,
  };
}

/** Clave natural de un registro de Métricas: dos filas con la misma clave son «el mismo registro». */
export function metricNaturalKey(r: { sector: string; metricDate: string; product: string | null; responsibleDisplay: string }): string {
  return [r.sector, r.metricDate, fold(r.product ?? ""), normalizeResponsibleKey(r.responsibleDisplay)].join("|");
}

/** Revalidación estricta para el servidor (mismos criterios que el navegador). */
export function validateImportRow(input: unknown): { ok: true; row: MetricsImportRow } | { ok: false; message: string } {
  if (!input || typeof input !== "object") return { ok: false, message: "Fila inválida." };
  const r = input as Record<string, unknown>;
  const date = parseMetricDate(String(r.metricDate ?? ""));
  if (!date.ok) return { ok: false, message: date.message };
  const unitsRaw = typeof r.units === "number" ? String(r.units) : String(r.units ?? "");
  const units = parseMetricUnits(unitsRaw);
  if (!units.ok) return { ok: false, message: units.message };
  const responsibleDisplay = String(r.responsibleDisplay ?? "").trim();
  if (!responsibleDisplay) return { ok: false, message: "Responsable obligatorio." };
  const sector = String(r.sector ?? "");
  if (!(METRICS_SECTORS as readonly string[]).includes(sector)) return { ok: false, message: "Sector inválido." };
  const product = String(r.product ?? "").trim();
  return {
    ok: true,
    row: {
      metricDate: date.iso,
      product: product || null,
      units: units.value,
      responsibleDisplay,
      sector: sector as MetricsSector,
    },
  };
}
