import {
  coercePedidoFields,
  type ProductionPedidoInput,
  type ProductionPedidoStatus,
} from "./types";

export type FieldKey = keyof ProductionPedidoInput | "kgIgnored";

export type ColumnAssociation = {
  sourceIndex: number;
  sourceHeader: string;
  field: FieldKey | null;
  label: string;
  status: "mapped" | "ignored" | "conflict";
  conflictWithIndex?: number;
};

export type PastePreviewRow = {
  rowIndex: number;
  input: ProductionPedidoInput;
  op: string | null;
  fecha: string | null;
  nroOc: string | null;
  cliente: string | null;
  producto: string | null;
  s: string | null;
  q: number | null;
  ml: number | null;
  kg: number | null;
  estado: ProductionPedidoStatus | null;
  errors: string[];
  warnings: string[];
  valid: boolean;
};

export type ParseExcelPasteResult = {
  rows: PastePreviewRow[];
  headerDetected: boolean;
  mode: "by-header" | "by-position";
  associations: ColumnAssociation[];
  ignoredHeaders: string[];
  missingFields: string[];
  validCount: number;
  invalidCount: number;
  summary: string;
};

const FIELD_LABELS: Record<string, string> = {
  op: "OP",
  fecha: "Fecha",
  nroOc: "N.º OC",
  cliente: "Cliente",
  producto: "Producto",
  s: "S",
  q: "Q",
  ml: "ML",
  kgIgnored: "KG (ignorado, se recalcula)",
  estado: "Estado",
};

/** Alias → campo Genus. Keys already normalized via normalizeHeaderKey. */
const HEADER_ALIASES: Record<string, FieldKey> = {
  // OP
  op: "op",
  "o p": "op",
  "orden de produccion": "op",
  "orden produccion": "op",
  // FECHA
  fecha: "fecha",
  "fecha pedido": "fecha",
  "fecha de pedido": "fecha",
  // N.º OC
  "n oc": "nroOc",
  "nro oc": "nroOc",
  "numero oc": "nroOc",
  "orden de compra": "nroOc",
  oc: "nroOc",
  // CLIENTE
  cliente: "cliente",
  "razon social": "cliente",
  // PRODUCTO
  producto: "producto",
  "nombre producto": "producto",
  "producto / descripcion": "producto",
  "producto descripcion": "producto",
  // S
  s: "s",
  // Q
  q: "q",
  cantidad: "q",
  cant: "q",
  unidades: "q",
  "cantidad unidades": "q",
  // ML
  ml: "ml",
  "m l": "ml",
  mililitros: "ml",
  "contenido ml": "ml",
  "ml por unidad": "ml",
  // KG (ignored)
  kg: "kgIgnored",
  kilos: "kgIgnored",
  kilogramos: "kgIgnored",
  "peso kg": "kgIgnored",
  // ESTADO
  estado: "estado",
  status: "estado",
  situacion: "estado",
};

const DEFAULT_ORDER: Array<keyof ProductionPedidoInput> = [
  "op",
  "fecha",
  "nroOc",
  "cliente",
  "producto",
  "s",
  "q",
  "ml",
  "estado",
];

/**
 * Normaliza encabezado para matching:
 * - trim, lower, sin acentos
 * - unifica °/º → o
 * - colapsa espacios
 * - quita puntuación marginal (. : - _)
 */
export function normalizeHeaderKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[°º]/g, "")
    .replace(/[/\\]+/g, " ")
    .replace(/[._:\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveHeaderField(raw: string): FieldKey | null {
  const key = normalizeHeaderKey(raw);
  if (!key) return null;
  if (HEADER_ALIASES[key]) return HEADER_ALIASES[key]!;
  // compact form without spaces: "nrooc", "ordencompra"
  const compact = key.replace(/\s+/g, "");
  const compactMap: Record<string, FieldKey> = {
    op: "op",
    oporden: "op",
    ordendeproduccion: "op",
    ordenproduccion: "op",
    fecha: "fecha",
    fechapedido: "fecha",
    fechadepedido: "fecha",
    noc: "nroOc",
    nrooc: "nroOc",
    numerooc: "nroOc",
    ordendecompra: "nroOc",
    oc: "nroOc",
    cliente: "cliente",
    razonsocial: "cliente",
    producto: "producto",
    nombreproducto: "producto",
    productodescripcion: "producto",
    s: "s",
    q: "q",
    cantidad: "q",
    cant: "q",
    unidades: "q",
    cantidadunidades: "q",
    ml: "ml",
    mililitros: "ml",
    contenidoml: "ml",
    mlporunidad: "ml",
    kg: "kgIgnored",
    kilos: "kgIgnored",
    kilogramos: "kgIgnored",
    pesokg: "kgIgnored",
    estado: "estado",
    status: "estado",
    situacion: "estado",
  };
  return compactMap[compact] ?? null;
}

function splitRows(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((r) => r.trim().length > 0);
}

/**
 * Split columns preserving empty cells (no shift).
 * Prefer tabs (Excel). Fallback: semicolon, then pipe.
 */
export function splitCols(line: string): string[] {
  let cols: string[];
  if (line.includes("\t")) cols = line.split("\t");
  else if (line.includes(";")) cols = line.split(";");
  else if (line.includes("|")) cols = line.split("|");
  else cols = [line];
  // Trim edges of each cell only — keep internal spaces; keep empty slots.
  return cols.map((c) => c.replace(/^\s+|\s+$/g, ""));
}

function detectHeaderRow(cols: string[]): {
  hitCount: number;
  fields: Array<FieldKey | null>;
} {
  const fields = cols.map((c) => resolveHeaderField(c));
  const hitCount = fields.filter((f) => f && f !== "kgIgnored").length;
  return { hitCount, fields };
}

function buildAssociations(
  headers: string[],
  fields: Array<FieldKey | null>
): { associations: ColumnAssociation[]; conflicts: boolean } {
  const firstIndex = new Map<string, number>();
  let conflicts = false;
  const associations: ColumnAssociation[] = headers.map((sourceHeader, sourceIndex) => {
    const field = fields[sourceIndex] ?? null;
    if (!field) {
      return {
        sourceIndex,
        sourceHeader,
        field: null,
        label: "No utilizada",
        status: "ignored" as const,
      };
    }
    const prev = firstIndex.get(field);
    if (prev != null && field !== "kgIgnored") {
      conflicts = true;
      return {
        sourceIndex,
        sourceHeader,
        field,
        label: FIELD_LABELS[field] ?? field,
        status: "conflict" as const,
        conflictWithIndex: prev,
      };
    }
    firstIndex.set(field, sourceIndex);
    return {
      sourceIndex,
      sourceHeader,
      field,
      label: FIELD_LABELS[field] ?? field,
      status: "mapped" as const,
    };
  });
  return { associations, conflicts };
}

function rowToInputByHeader(
  cols: string[],
  associations: ColumnAssociation[],
  preferredIndexByField: Map<string, number>
): ProductionPedidoInput {
  const input: ProductionPedidoInput = {};
  for (const [field, idx] of preferredIndexByField) {
    if (field === "kgIgnored") continue;
    input[field as keyof ProductionPedidoInput] = cols[idx] ?? "";
  }
  // Ensure empty string for missing mapped fields isn't required — coerce handles.
  void associations;
  return input;
}

function rowToInputByPosition(cols: string[]): ProductionPedidoInput {
  const input: ProductionPedidoInput = {};
  DEFAULT_ORDER.forEach((key, i) => {
    input[key] = cols[i] ?? "";
  });
  return input;
}

function preferredFieldIndexes(associations: ColumnAssociation[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of associations) {
    if (!a.field || a.status === "ignored") continue;
    if (a.status === "conflict") continue; // wait — we want first occurrence
    if (!map.has(a.field)) map.set(a.field, a.sourceIndex);
  }
  // For conflicts: use first occurrence (already set); conflict rows skipped above
  // Actually conflict status means duplicate — first mapped wins. Re-scan:
  map.clear();
  for (const a of associations) {
    if (!a.field || a.field === "kgIgnored") continue;
    if (a.status === "ignored") continue;
    if (!map.has(a.field)) map.set(a.field, a.sourceIndex);
  }
  return map;
}

function duplicateKey(r: {
  op: string | null;
  nroOc: string | null;
  cliente: string | null;
  producto: string | null;
  fecha: string | null;
}): string {
  return [r.op ?? "", r.nroOc ?? "", r.cliente ?? "", r.producto ?? "", r.fecha ?? ""]
    .join("|")
    .toLowerCase();
}

function toPreviewRow(
  idx: number,
  input: ProductionPedidoInput,
  existing: Set<string>,
  seen: Map<string, number>
): PastePreviewRow {
  const coerced = coercePedidoFields(input);
  const warnings: string[] = [];
  const key = duplicateKey(coerced);
  const empty =
    !coerced.op &&
    !coerced.fecha &&
    !coerced.nroOc &&
    !coerced.cliente &&
    !coerced.producto &&
    !coerced.s &&
    coerced.q == null &&
    coerced.ml == null &&
    !coerced.estado;
  if (empty) coerced.errors.push("Fila vacía");
  if (seen.has(key) && key !== "||||") {
    warnings.push(`Posible duplicado interno (fila ${seen.get(key)! + 1})`);
  } else {
    seen.set(key, idx);
  }
  if (existing.has(key) && key !== "||||") {
    warnings.push("Posible duplicado con un pedido ya guardado");
  }
  return {
    rowIndex: idx + 1,
    input,
    op: coerced.op,
    fecha: coerced.fecha,
    nroOc: coerced.nroOc,
    cliente: coerced.cliente,
    producto: coerced.producto,
    s: coerced.s,
    q: coerced.q,
    ml: coerced.ml,
    kg: coerced.kg,
    estado: coerced.estado,
    errors: coerced.errors,
    warnings,
    valid: coerced.errors.length === 0,
  };
}

export type ParseExcelPasteOptions = {
  existingKeys?: string[];
  /** Force positional mapping even if headers look present. */
  forcePosition?: boolean;
  /**
   * When headers conflict (duplicates), which source index to use per field.
   * Defaults to first occurrence.
   */
  fieldSourceOverrides?: Partial<Record<keyof ProductionPedidoInput, number>>;
};

/**
 * Parsea clipboard Excel → preview.
 * Con encabezados: asocia por nombre (orden irrelevante).
 * Sin encabezados: orden estándar OP|FECHA|N.ºOC|CLIENTE|PRODUCTO|S|Q|ML|ESTADO.
 * KG de Excel nunca se confía; se recalcula.
 */
export function parseExcelPaste(
  text: string,
  existingKeysOrOpts: string[] | ParseExcelPasteOptions = []
): ParseExcelPasteResult {
  const opts: ParseExcelPasteOptions = Array.isArray(existingKeysOrOpts)
    ? { existingKeys: existingKeysOrOpts }
    : existingKeysOrOpts;
  const existingKeys = opts.existingKeys ?? [];
  const lines = splitRows(text);
  if (!lines.length) {
    return {
      rows: [],
      headerDetected: false,
      mode: "by-position",
      associations: [],
      ignoredHeaders: [],
      missingFields: DEFAULT_ORDER.map((f) => FIELD_LABELS[f]!),
      validCount: 0,
      invalidCount: 0,
      summary: "Sin filas para importar",
    };
  }

  const firstCols = splitCols(lines[0]!);
  const detected = detectHeaderRow(firstCols);
  // Require ≥2 mapped business fields OR 1 field + kgIgnored to avoid mistaking data for headers.
  // Prefer ≥2 real fields; also accept if ≥1 real and several look like headers.
  const headerLikely =
    !opts.forcePosition &&
    detected.hitCount >= 2 &&
    firstCols.some((c) => resolveHeaderField(c) != null);

  const headerDetected = headerLikely;
  const mode: "by-header" | "by-position" = headerDetected ? "by-header" : "by-position";

  let associations: ColumnAssociation[] = [];
  let dataLines = lines;
  let fieldIndex = new Map<string, number>();

  if (headerDetected) {
    const built = buildAssociations(firstCols, detected.fields);
    associations = built.associations;
    fieldIndex = preferredFieldIndexes(associations);
    if (opts.fieldSourceOverrides) {
      for (const [field, idx] of Object.entries(opts.fieldSourceOverrides)) {
        if (typeof idx === "number") fieldIndex.set(field, idx);
      }
      associations = associations.map((a) => {
        if (!a.field || a.field === "kgIgnored") return a;
        const chosen = fieldIndex.get(a.field);
        if (chosen == null) return a;
        if (a.sourceIndex === chosen) {
          return { ...a, status: "mapped" as const, conflictWithIndex: undefined };
        }
        if (a.field && detected.fields[a.sourceIndex] === a.field) {
          return {
            ...a,
            status: "conflict" as const,
            conflictWithIndex: chosen,
            label: `${FIELD_LABELS[a.field]} (no usada)`,
          };
        }
        return a;
      });
    }
    dataLines = lines.slice(1);
  } else {
    associations = DEFAULT_ORDER.map((field, sourceIndex) => ({
      sourceIndex,
      sourceHeader: FIELD_LABELS[field] ?? field,
      field,
      label: FIELD_LABELS[field] ?? field,
      status: "mapped" as const,
    }));
  }

  const existing = new Set(existingKeys.map((k) => k.toLowerCase()));
  const seen = new Map<string, number>();
  const rows: PastePreviewRow[] = dataLines.map((line, idx) => {
    const cols = splitCols(line);
    const input = headerDetected
      ? rowToInputByHeader(cols, associations, fieldIndex)
      : rowToInputByPosition(cols);
    return toPreviewRow(idx, input, existing, seen);
  });

  const ignoredHeaders = associations
    .filter((a) => a.status === "ignored")
    .map((a) => a.sourceHeader);
  const mappedFields = new Set(
    associations.filter((a) => a.status === "mapped" && a.field && a.field !== "kgIgnored").map((a) => a.field)
  );
  const missingFields = DEFAULT_ORDER.filter((f) => !mappedFields.has(f) && headerDetected).map(
    (f) => FIELD_LABELS[f]!
  );
  const validCount = rows.filter((r) => r.valid).length;
  const invalidCount = rows.length - validCount;
  const summary = headerDetected
    ? `Encabezados detectados · ${associations.filter((a) => a.status === "mapped").length} columnas asociadas · ${ignoredHeaders.length} ignoradas · ${validCount} filas válidas`
    : `Sin encabezados · pegado por orden estándar · ${validCount} filas válidas`;

  return {
    rows,
    headerDetected,
    mode,
    associations,
    ignoredHeaders,
    missingFields,
    validCount,
    invalidCount,
    summary,
  };
}

export function duplicateKeyFromRecord(r: {
  op: string | null;
  nroOc: string | null;
  cliente: string | null;
  producto: string | null;
  fecha: string | null;
}): string {
  return duplicateKey(r);
}
