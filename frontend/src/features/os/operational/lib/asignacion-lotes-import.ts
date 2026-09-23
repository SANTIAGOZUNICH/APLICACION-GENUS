import type { AsignacionLoteUpsertInput } from "../adapters/asignacion-lotes-repository";
import { parseNonNegativeNumber } from "./clipboard-import";
import type { ExcelPreviewIssue } from "./excel-import-preview-utils";
import { parseFlexibleDate } from "./delivery-date";

/**
 * Aliases de encabezado (solo títulos). El contenido de celdas no se
 * normaliza aquí.
 *
 * CAUSA RAÍZ (auditoría del pegado desde Excel): el matcher de encabezados
 * (`headerMatchesAlias` en clipboard-import.ts) exige coincidencia exacta o
 * por token completo — no tolera plural/singular ni abreviaturas. "CJ
 * Muestras"/"Cajas Muestras" (plural, la forma real más usada) no
 * matcheaban contra los alias en singular ("cj muestra"/"cajas muestra"),
 * y "F. Analisis" (abreviatura real común) no matcheaba ningún alias de
 * fechaAnalisis — ambos quedaban sin mapear y el dato se perdía en
 * silencio. Se agregan las variantes reales encontradas en vez de tocar el
 * algoritmo de matching compartido (usado también por MP Hub/ME
 * Ingresos-Salidas) — fix acotado al lugar correcto.
 */
export const ASIGNACION_LOTES_FIELD_ALIASES: Record<string, string[]> = {
  lote: ["lote", "n° lote", "nº lote", "nro lote", "batch"],
  fecha: ["fecha", "fecha asignacion", "fecha asignación"],
  producto: ["producto", "nombre producto", "descripcion", "descripción"],
  codigo: ["codigo", "código", "cod.", "cod", "codigo producto", "código producto"],
  marca: ["marca"],
  cantidades: ["cantidad", "cantidades", "cant."],
  vto: ["vto", "vencimiento", "fecha vto", "fecha vencimiento", "fecha de vencimiento"],
  muestras: ["muestras", "muestra"],
  cjMuestra: [
    "cj muestra",
    "cj muestras",
    "cj. muestra",
    "cj. muestras",
    "cajas muestra",
    "cajas muestras",
    "cajas de muestra",
    "cajas de muestras",
  ],
  fechaAnalisis: [
    "fecha analisis",
    "fecha análisis",
    "f analisis",
    "f análisis",
    "f. analisis",
    "f. análisis",
    "fecha de analisis",
    "fecha de análisis",
  ],
  observaciones: ["observaciones", "observacion", "observación", "notas", "comentarios"],
  cliente: ["cliente", "razon social", "razón social"],
};

export interface AsignacionLoteMappedRow {
  lote: string;
  fecha: string;
  producto: string;
  codigo: string;
  marca: string;
  cantidades: string;
  vto: string;
  muestras: string;
  cjMuestra: string;
  fechaAnalisis: string;
  observaciones: string;
  cliente: string;
}

/**
 * Tokens reales confirmados en Asignación de Lotes (hoja SEPTIEMBRE 2026,
 * columna FECHA ANÁLISIS) para "no aplica"/"sin dato" — nunca un intento de
 * fecha mal escrito. Whitelist exacta (case/espacios-insensible, nunca
 * fuzzy) para no confundir un dato realmente ilegible (que sí debe
 * bloquear, ver AUDIT_EXCEL_VTO_BUG) con un campo secundario
 * explícitamente marcado como no disponible.
 */
const NO_DATA_TOKENS = new Set([
  "n/a",
  "na",
  "n.a.",
  "n.a",
  "s/d",
  "sd",
  "-",
  "—",
  "sin dato",
  // "envían [la muestra]" — confirmado en la hoja real (SEPTIEMBRE 2026):
  // todavía no se mandó a analizar, no es una fecha mal escrita.
  "envian",
  "envían",
]);

function isNoDataToken(value: string): boolean {
  return NO_DATA_TOKENS.has(value.trim().toLowerCase());
}

/**
 * FECHA ANÁLISIS real (hoja SEPTIEMBRE 2026, validado contra la planilla en
 * vivo): además de fechas completas, esta columna suele tener solo "día-mes"
 * sin año (ej. "2-9", "16/9") — una nota informal de cuándo se mandó la
 * muestra, asumiendo el año en curso. `parseFlexibleDate` no lo reconoce (su
 * único patrón de 2 dígitos es mm/yy con año, no día/mes sin año) — antes
 * esto bloqueaba ~31% de las filas activas de la hoja real como "inválidas"
 * y nunca llegaban a sincronizarse. Se resuelve el año a partir de la propia
 * FECHA de la fila (mismo año casi siempre — la muestra se manda cerca de la
 * fecha del lote) en vez de asumir el año calendario actual, que sería
 * incorrecto al sincronizar una fuente de un año anterior (ej. "Asignación
 * de Lotes 2025").
 */
export function parseAnalysisDateShorthand(
  raw: string,
  referenceIso?: string | null,
  now = new Date()
): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const referenceYear = referenceIso?.match(/^(\d{4})-/)?.[1];
  const year = referenceYear ? Number(referenceYear) : now.getFullYear();

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Texto de preview cuando el código importado está vacío (no se persiste). */
export function formatAsignacionCodigoPreview(codigo: string | null | undefined): string {
  return codigo?.trim() ? codigo.trim() : "Sin código";
}

/**
 * Código tal como viene de la celda CÓDIGO (trim extremos).
 * Vacío → "". Nunca usa PRODUCTO ni genera valores.
 */
export function normalizeImportedCodigo(raw: string | null | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Carga flexible (celdas vacías permitidas): ningún campo bloquea la
 * importación de la fila por estar vacío — lote/fecha/producto/cantidades
 * quedan como null/"" igual que código, que ya era opcional. Solo se
 * advierte cuando el dato SÍ está presente pero tiene un formato inválido
 * (fecha/VTO no parseable) o cuando la fila entera está vacía (lo cubre
 * `excel-import-preview-dialog.tsx`'s `emptyIssueCheck`, no acá). La
 * validación de "obligatorio para tal acción" (ej. entregar sin VTO) queda
 * para el momento en que esa acción se ejecuta, no en la carga.
 */
export function validateAsignacionLoteRow(
  row: Partial<AsignacionLoteMappedRow>,
  rowIndex = 1
): ExcelPreviewIssue[] {
  const issues: ExcelPreviewIssue[] = [];

  if (row.fecha?.trim() && !parseFlexibleDate(row.fecha)) {
    issues.push({ rowIndex, field: "fecha", message: "Fecha inválida.", severity: "warning" });
  }

  // A diferencia de "fecha" (que conserva el texto crudo si no puede
  // parsearse), VTO y Fecha análisis se persisten como null cuando no se
  // pueden interpretar (dateOnly() en asignacion-lotes-service.ts escribe
  // sobre una columna date real — guardar texto crudo ahí rompería el
  // insert). Por eso, si el dato SÍ vino pero es ilegible, esto debe ser un
  // error que deja la fila fuera de la selección por defecto — nunca un
  // warning silencioso que permita importar con el valor perdido sin que
  // nadie lo note (ver AUDIT_EXCEL_VTO_BUG).
  const vto = row.vto?.trim();
  if (vto && !isNoDataToken(vto) && !parseFlexibleDate(vto)) {
    issues.push({ rowIndex, field: "vto", message: "VTO inválido.", severity: "error" });
  }

  const fechaAnalisis = row.fechaAnalisis?.trim();
  if (
    fechaAnalisis &&
    !isNoDataToken(fechaAnalisis) &&
    !parseFlexibleDate(fechaAnalisis) &&
    !parseAnalysisDateShorthand(fechaAnalisis, row.fecha ? parseFlexibleDate(row.fecha) : null)
  ) {
    issues.push({
      rowIndex,
      field: "fechaAnalisis",
      message: "Fecha análisis inválida.",
      severity: "error",
    });
  }

  return issues;
}

export function buildAsignacionLoteFromMappedRow(
  row: Partial<AsignacionLoteMappedRow>,
  updatedBy: string
): AsignacionLoteUpsertInput {
  return {
    lote: row.lote?.trim() ?? "",
    fecha: row.fecha?.trim() ? parseFlexibleDate(row.fecha) ?? row.fecha.trim() : null,
    producto: row.producto?.trim() ?? "",
    codigo: normalizeImportedCodigo(row.codigo),
    // "cliente" es alias de encabezado separado de "marca" (ver
    // ASIGNACION_LOTES_FIELD_ALIASES) — si la planilla real usa una columna
    // "Cliente" en vez de "Marca", sin este fallback el dato se mapeaba a
    // `row.cliente` y nunca llegaba a persistirse (quedaba en un campo que
    // esta función no leía). Marca tiene prioridad si ambas vinieran cargadas.
    marca: row.marca?.trim() || row.cliente?.trim() || "",
    cantidades: parseNonNegativeNumber(row.cantidades ?? "") ?? 0,
    vto: row.vto?.trim() ? parseFlexibleDate(row.vto) : null,
    muestras: row.muestras?.trim() ?? "",
    cjMuestra: row.cjMuestra?.trim() ?? "",
    fechaAnalisis: row.fechaAnalisis?.trim()
      ? (parseFlexibleDate(row.fechaAnalisis) ??
        parseAnalysisDateShorthand(
          row.fechaAnalisis,
          row.fecha ? parseFlexibleDate(row.fecha) : null
        ))
      : null,
    observaciones: row.observaciones?.trim() ?? "",
    updatedBy,
    createdBy: updatedBy,
  };
}
