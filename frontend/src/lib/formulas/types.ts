/** Normalización y tipos del banco privado de fórmulas (sin datos reales). */

export type FormulaVersionStatus =
  | "VIGENTE"
  | "HISTORICA"
  | "CONFLICTO"
  | "BORRADOR_PROPUESTA";

export type FormulaIngredient = {
  id: string;
  position: number;
  materialName: string;
  materialCodeOrPhase: string;
  percentage: number | null;
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
};

export function normalizeSearchKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[./_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
