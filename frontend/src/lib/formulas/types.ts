/** Normalización y tipos del banco privado de fórmulas (sin datos reales). */

export type FormulaVersionStatus =
  | "VIGENTE"
  | "HISTORICA"
  | "CONFLICTO"
  | "BORRADOR_PROPUESTA";

export type SourceConfidence = "CELL" | "SHEET" | "FILENAME" | "PENDING";
export type ExpressionType = "PERCENTAGE" | "QUANTITY";
export type PercentageSource =
  | "ORIGINAL"
  | "PROPORTION_SCALED"
  | "DERIVED_FROM_QUANTITY";

/** Sentinela de cliente sin resolver (no confundir con la carpeta raíz del ZIP). */
export const CLIENT_PENDING = "CLIENTE_PENDIENTE";
/** Sentinela de producto sin resolver. */
export const PRODUCT_PENDING = "PENDIENTE";

export type FormulaIngredient = {
  id: string;
  position: number;
  materialName: string;
  materialCodeOrPhase: string;
  percentage: number | null;
  /**
   * Cantidad original de procedencia (kg/unidad) SOLO como dato privado de origen.
   * NO representa kg definitivos de producción: en una OE los kg a pesar se calculan
   * después como porcentaje × kg_produccion / 100.
   */
  sourceQuantity?: number | null;
  notes: string;
};

export type FormulaProcedureStep = {
  id: string;
  position: number;
  instruction: string;
};

export type FormulaSpecification = {
  id: string;
  type: string;
  name: string;
  expectedValue: string;
  unit: string;
  notes: string;
};

export type FormulaVersionRecord = {
  id: string;
  productId: string;
  version: number;
  status: FormulaVersionStatus;
  sourceFile: string | null;
  sourceSheet: string | null;
  sourceModifiedAt: string | null;
  sourceHash: string;
  semanticHash: string;
  importedAt: string;
  percentageTotal: number | null;
  validationStatus: "OK" | "WARN" | "ERROR";
  warnings: string[];
  previousVersionId: string | null;
  conflictCode: string | null;
  altSourcePaths: string[];
  sourceConfidence?: SourceConfidence;
  expressionType?: ExpressionType;
  percentageSource?: PercentageSource;
  originalPercentageTotal?: number | null;
  reviewRequired?: boolean;
  reviewReasons?: string[];
  ingredients: FormulaIngredient[];
  procedureSteps: FormulaProcedureStep[];
  specifications: FormulaSpecification[];
};

export type FormulaProductRecord = {
  id: string;
  normalizedClient: string;
  normalizedProduct: string;
  displayClient: string;
  displayProduct: string;
  productCode: string;
  activeVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FormulaSnapshot = {
  formulaProductId: string;
  formulaVersionId: string;
  versionHash: string;
  displayClient: string;
  displayProduct: string;
  productCode: string;
  ingredients: FormulaIngredient[];
  procedureSteps: FormulaProcedureStep[];
  specifications: FormulaSpecification[];
  percentageTotal: number | null;
};

export type ParsedFormulaDraft = {
  displayClient: string;
  displayProduct: string;
  productCode: string;
  sourceFile: string;
  sourceSheet: string;
  sourceModifiedAt: string | null;
  sourceHash: string;
  semanticHash: string;
  ingredients: Omit<FormulaIngredient, "id">[];
  procedureSteps: Omit<FormulaProcedureStep, "id">[];
  specifications: Omit<FormulaSpecification, "id">[];
  percentageTotal: number | null;
  warnings: string[];
  altSourcePaths: string[];
  /** Origen del nombre de producto: celda etiquetada, hoja, filename o pendiente. */
  sourceConfidence?: SourceConfidence;
  /** Cómo está expresada la fórmula. */
  expressionType?: ExpressionType;
  /** Cómo se obtuvieron los porcentajes finales. */
  percentageSource?: PercentageSource;
  /** Total porcentual crudo original (antes de escalar/derivar), para auditoría. */
  originalPercentageTotal?: number | null;
  /** true si la fórmula no es importable automáticamente. */
  reviewRequired?: boolean;
  /** Motivos de revisión (códigos, sin datos sensibles). */
  reviewReasons?: string[];
};

export function normalizeSearchKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.:;/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nombre de hoja genérico de plantilla (no sirve como producto). */
export function isGenericSheetName(name: string): boolean {
  let n = normalizeSearchKey(name).replace(/^copia de\s+/, "");
  n = n.replace(/\(\s*\d+\s*\)/g, " ").replace(/\s+/g, " ").trim(); // "oe (2)" → "oe"
  if (!n) return true;
  if (/^\d+$/.test(n)) return true; // hoja nombrada solo con números (página/lote)
  return /^(hoja|sheet|oe)(\s*\d+)?$/.test(n);
}

/** true si el valor normalizado coincide con alguno de los clientes conocidos. */
export function matchesKnownClient(value: string, knownClients: string[]): boolean {
  const nv = normalizeSearchKey(value);
  if (!nv) return false;
  return knownClients.some((c) => normalizeSearchKey(c) === nv);
}

/**
 * Etiquetas de campo típicas de la plantilla OE. Se usan para descartar valores
 * "tipo etiqueta" cuando la celda de valor real está vacía y se saltaría a otra etiqueta.
 */
export const OE_FIELD_LABELS = new Set([
  "cliente",
  "client",
  "producto",
  "product",
  "nombre",
  "codigo",
  "code",
  "fecha",
  "fecha de elaboracion",
  "fecha de vencimiento",
  "lote",
  "hora",
  "equipo",
  "equipo calefactor n",
  "revision",
  "version",
  "pagina",
  "observaciones",
  "cantidad",
  "cantidad kg",
  "kg",
  "kg a pesar",
  "materia prima",
  "procedimiento",
  "formula",
  "formula %",
  "envase",
  "densidad",
  "ph",
  "aspecto",
  "color",
  "olor",
]);

/** true si el texto de una celda parece una etiqueta y no un valor real. */
export function looksLikeFieldLabel(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (/[:;]$/.test(t)) return true;
  return OE_FIELD_LABELS.has(normalizeSearchKey(t));
}

/**
 * Resuelve el cliente desde el nombre de archivo SOLO si coincide claramente con
 * exactamente uno de los clientes ya conocidos (por token completo). Si no, "".
 */
export function resolveClientFromFilename(
  sourceFile: string,
  knownClients: string[]
): string {
  const base = (sourceFile.split(/[\\/]/).pop() ?? sourceFile).replace(
    /\.(xlsx|xlsm|xlsb|xls)$/i,
    ""
  );
  const fileTokens = new Set(normalizeSearchKey(base).split(" ").filter(Boolean));
  const matches: string[] = [];
  for (const c of knownClients) {
    const ct = normalizeSearchKey(c).split(" ").filter(Boolean);
    if (ct.length && ct.every((t) => fileTokens.has(t))) matches.push(c);
  }
  const uniq = [...new Set(matches.map((m) => normalizeSearchKey(m)))];
  return uniq.length === 1 ? matches[0]! : "";
}

/** true si el cliente no está resuelto de forma confiable. */
export function isPendingClient(displayClient: string): boolean {
  const n = normalizeSearchKey(displayClient);
  return !n || n.includes("pendiente");
}

/** true si el producto no está resuelto. */
export function isPendingProduct(displayProduct: string): boolean {
  const n = normalizeSearchKey(displayProduct);
  return !n || n === "pendiente";
}

/** Número suelto: soporta coma decimal y signo %. NO aplica heurística de escala. */
export function parseLooseNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw)
    .replace(/%/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Deriva el nombre de producto desde el nombre de archivo.
 * - Quita extensión, número/código inicial y prefijos (OE, Copia de OE, ORDEN DE ELABORACION).
 * - Quita el cliente del final SOLO cuando coincide claramente con el cliente de carpeta.
 * - No elimina fragmentos con guiones que puedan ser parte real del producto.
 */
export function deriveProductFromFilename(
  sourceFile: string,
  knownClient?: string
): string {
  let name = (sourceFile.split(/[\\/]/).pop() ?? sourceFile).trim();
  name = name.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, "").trim();

  const stripLeadingPhrase = (value: string, phrase: string): string => {
    const words = value.split(/\s+/);
    const pw = phrase.split(" ");
    if (words.length < pw.length) return value;
    for (let k = 0; k < pw.length; k++) {
      if (normalizeSearchKey(words[k] ?? "") !== pw[k]) return value;
    }
    return words
      .slice(pw.length)
      .join(" ")
      .replace(/^[\s.:;/_–-]+/, "")
      .trim();
  };

  // Prefijos de encabezado (aplicar hasta estabilizar; el orden cubre "Copia de OE ...").
  for (let i = 0; i < 4; i++) {
    const before = name;
    name = stripLeadingPhrase(name, "copia de");
    name = stripLeadingPhrase(name, "orden de elaboracion");
    name = stripLeadingPhrase(name, "oe");
    if (name === before) break;
  }

  // Código/número de orden inicial: "240055 - ", "240231-3 - ", "230255  - ", etc.
  name = name.replace(/^\s*\d+(?:[-–]\d+)?\s*[-–.:;]?\s*/, "").trim();

  // Cliente al final SOLO si coincide claramente con el cliente de carpeta.
  if (knownClient && !isPendingClient(knownClient)) {
    const ct = normalizeSearchKey(knownClient).split(" ").filter(Boolean);
    if (ct.length) {
      const words = name.split(/\s+/);
      const normWords = words.map((w) => normalizeSearchKey(w));
      let wi = words.length - 1;
      let ci = ct.length - 1;
      let cut = words.length;
      while (ci >= 0 && wi >= 0) {
        if (normWords[wi] === "") {
          wi--;
          continue;
        }
        if (normWords[wi] === ct[ci]) {
          cut = wi;
          wi--;
          ci--;
        } else {
          break;
        }
      }
      if (ci < 0 && cut > 0) {
        const kept = words
          .slice(0, cut)
          .join(" ")
          .replace(/[\s.:;/_–-]+$/, "")
          .trim();
        if (kept) name = kept;
      }
    }
  }

  return name.replace(/\s+/g, " ").trim();
}

export function looksLikeCopyName(fileName: string): boolean {
  const n = fileName.toLowerCase();
  if (n.includes("copia de") || n.includes("copy of")) return true;
  if (/\(\d+\)\s*\./.test(n)) return true;
  if (/[_\-\s]\d+\.(xlsx|xls)$/i.test(n)) return true;
  return false;
}

export function shouldIgnoreArchiveEntry(name: string, sizeBytes?: number): boolean {
  const base = name.split("/").pop() ?? name;
  if (base.startsWith("~$") || base.startsWith("_$")) return true;
  if (/\.(docx|png|jpg|jpeg|gif|tmp)$/i.test(base)) return true;
  if (sizeBytes != null && sizeBytes > 0 && sizeBytes < 200 && /\.xls/i.test(base)) return true;
  if (!/\.(xlsx|xls)$/i.test(base)) return true;
  return false;
}

export function computePercentageTotal(
  ingredients: { percentage: number | null }[]
): number | null {
  const nums = ingredients.map((i) => i.percentage).filter((n): n is number => n != null);
  if (nums.length === 0) return null;
  return Number(nums.reduce((a, b) => a + b, 0).toFixed(6));
}

export function buildSemanticHashPayload(draft: {
  displayClient: string;
  displayProduct: string;
  ingredients: { materialName: string; materialCodeOrPhase: string; percentage: number | null }[];
  procedureSteps: { instruction: string }[];
}): string {
  const parts = [
    normalizeSearchKey(draft.displayClient),
    normalizeSearchKey(draft.displayProduct),
    ...draft.ingredients.map(
      (i) =>
        `${normalizeSearchKey(i.materialName)}|${normalizeSearchKey(i.materialCodeOrPhase)}|${i.percentage ?? ""}`
    ),
    ...draft.procedureSteps.map((s) => normalizeSearchKey(s.instruction)),
  ];
  return parts.join("::");
}
