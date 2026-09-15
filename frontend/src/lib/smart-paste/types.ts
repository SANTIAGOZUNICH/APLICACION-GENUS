/**
 * Smart Paste — contrato de tipos, compartido por el motor (engine.ts) y
 * cualquier pantalla que lo use (piloto: Asignación de Lotes).
 *
 * Diseño deliberado: NADA de esto depende de IA generativa. Todo es
 * determinístico — parser + regex + maestros reales de GENUS OS + scoring.
 * Ver row-resolver.ts para el algoritmo de asignación.
 */

/** Campos que Asignación de Lotes necesita reconocer. Cada pantalla futura declara los suyos. */
export type SmartPasteFieldKey =
  | "producto"
  | "cliente"
  | "lote"
  | "vto"
  | "cantidad"
  | "codigo";

export type SmartPasteConfidence = "alta" | "media" | "baja";

/** Un candidato de campo para una celda cruda, con su score y motivo explicable. */
export interface SmartPasteFieldCandidate {
  field: SmartPasteFieldKey;
  /** 0..1 — nunca "probabilidad" real, solo un score comparable dentro de la misma fila. */
  score: number;
  /** Motivo legible — se muestra en el tooltip de la celda ("Interpretamos G26078 como LOTE"). */
  reason: string;
  /** Forma normalizada/canónica si el motor pudo resolverla (ej. cliente con mayúsculas/acentos corregidos). */
  normalizedValue?: string;
}

/** Resultado de clasificar UNA celda contra TODOS los campos posibles — nunca asume una columna fija. */
export interface SmartPasteCellClassification {
  raw: string;
  columnIndex: number;
  /** Ordenados desc por score. */
  candidates: SmartPasteFieldCandidate[];
}

export interface SmartPasteFieldAssignment {
  field: SmartPasteFieldKey;
  /** Valor final a persistir (normalizado cuando aplica). */
  value: string;
  raw: string;
  columnIndex: number;
  confidence: SmartPasteConfidence;
  reason: string;
  /** Otros campos plausibles para esta misma celda, cuando confidence no es "alta". */
  alternativeFields?: SmartPasteFieldKey[];
}

export type SmartPasteRowStatus = "valido" | "revisar" | "error" | "duplicado";

export interface SmartPasteRowIssue {
  field?: SmartPasteFieldKey;
  message: string;
  severity: "error" | "warning";
}

export interface SmartPasteRow {
  rowIndex: number;
  assignments: Partial<Record<SmartPasteFieldKey, SmartPasteFieldAssignment>>;
  /** Celdas que no se pudieron asociar a ningún campo con confianza suficiente. */
  unassignedCells: Array<{ raw: string; columnIndex: number }>;
  status: SmartPasteRowStatus;
  issues: SmartPasteRowIssue[];
  /** true si el dominio (caller) determinó que es un posible duplicado de un registro existente. */
  possibleDuplicateOf?: string;
}

export interface SmartPasteSummary {
  totalRows: number;
  valid: number;
  review: number;
  error: number;
  duplicate: number;
}

export interface SmartPasteResult {
  rows: SmartPasteRow[];
  summary: SmartPasteSummary;
  /** Encabezado detectado (si había) — solo informativo, el motor NO depende de él para resolver filas. */
  detectedHeader: string[] | null;
  batchId: string;
}

/**
 * "Diccionario operativo" de GENUS OS — derivado de datos reales, nunca
 * hardcodeado. Ver master-data.ts para cómo se construye a partir de
 * registros históricos de cada dominio.
 */
export interface SmartPasteMasterData {
  /** Lotes históricos, normalizados (mayúsculas, sin espacios). */
  lotes: ReadonlySet<string>;
  /** Formas sintácticas reales observadas (ver deriveLoteShapes) — nunca una regex fija tipo G/A/E. */
  loteShapes: ReadonlySet<string>;
  /** Clientes/marcas canónicos tal cual se guardan (para sustituir la forma normalizada). */
  clientesByNormalized: ReadonlyMap<string, string>;
  productosByNormalized: ReadonlyMap<string, string>;
  codigosByNormalized: ReadonlyMap<string, string>;
  /** `${productoNormalizado}::${clienteNormalizado}` — para el boost relacional. */
  productoClientePairs: ReadonlySet<string>;
}

export function emptyMasterData(): SmartPasteMasterData {
  return {
    lotes: new Set(),
    loteShapes: new Set(),
    clientesByNormalized: new Map(),
    productosByNormalized: new Map(),
    codigosByNormalized: new Map(),
    productoClientePairs: new Set(),
  };
}
