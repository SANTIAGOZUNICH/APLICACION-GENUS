/**
 * Control de integridad de fórmula de una OE (seguridad de formulación). Funciones PURAS: comparan las filas de la OE contra la fórmula
 * aprobada (versión del banco vinculada a la OE o fórmula re-leída de la fuente) y detectan composiciones sospechosas.
 *
 * Nunca modifican nada: solo describen diferencias. Una OE con diferencias queda «Fórmula pendiente de verificación» (se bloquea
 * entregar / contabilizar consumos) hasta que Producción/Dirección la verifique.
 */
import { normalizeSearchKey } from "@/lib/formulas/types";

export const PCT_SUM_LO = 98;
export const PCT_SUM_HI = 102;
/** Diferencia tolerada entre % de la OE y % aprobado (solo redondeo de visualización). */
export const PCT_DIFF_TOLERANCE = 0.0005;

export type ApprovedIngredient = { materialName: string; materialCodeOrPhase?: string; percentage: number | null };
export type OeFormulaRow = {
  materiaPrima: string;
  codigo: string;
  formulaPct: number | null;
  /** Fila de lote adicional de la misma MP (sin % propio): se ignora. */
  parentRowId?: string | null;
};

export type FormulaDiffStatus = "OK" | "DIFERENTE" | "FALTA_EN_OE" | "SOBRA_EN_OE" | "SIN_PORCENTAJE";

export type FormulaDiffRow = {
  materiaPrima: string;
  codigo: string;
  pctAprobado: number | null;
  pctOe: number | null;
  diferencia: number | null;
  status: FormulaDiffStatus;
};

export type FormulaIssue =
  | "SUMA_FUERA_DE_RANGO"
  | "PORCENTAJE_DISTINTO"
  | "MP_FALTANTE"
  | "MP_EXTRA"
  | "SIN_PORCENTAJE"
  | "FORMULA_NO_VERIFICABLE";

export type OeFormulaEvaluation = {
  /** true = la composición coincide con la fórmula aprobada (o no hay motivo para dudar). */
  consistent: boolean;
  /** true = hay una fuente aprobada contra la cual se comparó. */
  comparedAgainstSource: boolean;
  issues: FormulaIssue[];
  oePctSum: number | null;
  approvedPctSum: number | null;
  rows: FormulaDiffRow[];
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const key = (name: string, code: string) => normalizeSearchKey(`${name}`) + "|" + normalizeSearchKey(code ?? "");

/** Suma de % de las filas «principales» de la OE (los lotes adicionales no llevan %). */
export function oePercentageSum(rows: OeFormulaRow[]): number | null {
  const own = rows.filter((r) => !r.parentRowId && r.formulaPct != null);
  if (own.length === 0) return null;
  return round6(own.reduce((a, r) => a + (r.formulaPct as number), 0));
}

/** Controles que no necesitan fuente: suma de % y filas sin %. */
export function selfCheckOeRows(rows: OeFormulaRow[]): { issues: FormulaIssue[]; sum: number | null } {
  const own = rows.filter((r) => !r.parentRowId && (r.materiaPrima.trim() || r.codigo.trim()));
  const issues: FormulaIssue[] = [];
  if (own.length === 0) return { issues, sum: null };
  const sum = oePercentageSum(own);
  if (own.some((r) => r.formulaPct == null)) issues.push("SIN_PORCENTAJE");
  if (sum != null && (sum < PCT_SUM_LO || sum > PCT_SUM_HI)) issues.push("SUMA_FUERA_DE_RANGO");
  return { issues, sum };
}

/**
 * Compara fila por fila (código + nombre; si el código no alcanza, solo nombre). Sin fuente solo aplica el autocontrol.
 * No reescala ni «completa por diferencia»: lo que la OE tiene se compara tal cual con lo aprobado.
 */
export function evaluateOeFormula(rows: OeFormulaRow[], approved: ApprovedIngredient[] | null): OeFormulaEvaluation {
  const own = rows.filter((r) => !r.parentRowId && (r.materiaPrima.trim() || r.codigo.trim()));
  const self = selfCheckOeRows(own);
  const issues = new Set<FormulaIssue>(self.issues);
  const diff: FormulaDiffRow[] = [];

  if (!approved) {
    return {
      consistent: issues.size === 0,
      comparedAgainstSource: false,
      issues: [...issues],
      oePctSum: self.sum,
      approvedPctSum: null,
      rows: own.map((r) => ({
        materiaPrima: r.materiaPrima,
        codigo: r.codigo,
        pctAprobado: null,
        pctOe: r.formulaPct,
        diferencia: null,
        status: r.formulaPct == null ? "SIN_PORCENTAJE" : "OK",
      })),
    };
  }

  const pool = [...own];
  const take = (a: ApprovedIngredient): OeFormulaRow | undefined => {
    let i = pool.findIndex((r) => key(r.materiaPrima, r.codigo) === key(a.materialName, a.materialCodeOrPhase ?? ""));
    if (i < 0) i = pool.findIndex((r) => normalizeSearchKey(r.materiaPrima) === normalizeSearchKey(a.materialName));
    if (i < 0) return undefined;
    return pool.splice(i, 1)[0];
  };

  for (const a of approved) {
    const r = take(a);
    if (!r) {
      issues.add("MP_FALTANTE");
      diff.push({ materiaPrima: a.materialName, codigo: a.materialCodeOrPhase ?? "", pctAprobado: a.percentage, pctOe: null, diferencia: null, status: "FALTA_EN_OE" });
      continue;
    }
    if (r.formulaPct == null || a.percentage == null) {
      issues.add("SIN_PORCENTAJE");
      diff.push({ materiaPrima: r.materiaPrima, codigo: r.codigo, pctAprobado: a.percentage, pctOe: r.formulaPct, diferencia: null, status: "SIN_PORCENTAJE" });
      continue;
    }
    const d = round6(r.formulaPct - a.percentage);
    const same = Math.abs(d) <= PCT_DIFF_TOLERANCE;
    if (!same) issues.add("PORCENTAJE_DISTINTO");
    diff.push({ materiaPrima: r.materiaPrima, codigo: r.codigo, pctAprobado: a.percentage, pctOe: r.formulaPct, diferencia: d, status: same ? "OK" : "DIFERENTE" });
  }
  for (const r of pool) {
    issues.add("MP_EXTRA");
    diff.push({ materiaPrima: r.materiaPrima, codigo: r.codigo, pctAprobado: null, pctOe: r.formulaPct, diferencia: null, status: "SOBRA_EN_OE" });
  }

  const apprNums = approved.map((a) => a.percentage).filter((n): n is number => n != null);
  return {
    consistent: issues.size === 0,
    comparedAgainstSource: true,
    issues: [...issues],
    oePctSum: self.sum,
    approvedPctSum: apprNums.length ? round6(apprNums.reduce((a, b) => a + b, 0)) : null,
    rows: diff,
  };
}

/** Firma estable de los % de una OE: una verificación manual solo vale mientras no cambie la composición. */
export function oeCompositionSignature(rows: OeFormulaRow[]): string {
  return rows
    .filter((r) => !r.parentRowId)
    .map((r) => `${key(r.materiaPrima, r.codigo)}=${r.formulaPct == null ? "" : round6(r.formulaPct)}`)
    .join(";");
}

export const FORMULA_ISSUE_LABEL: Record<FormulaIssue, string> = {
  SUMA_FUERA_DE_RANGO: "Los porcentajes no suman 100 % (98–102).",
  PORCENTAJE_DISTINTO: "Hay porcentajes distintos a los de la fórmula aprobada.",
  MP_FALTANTE: "Falta una materia prima de la fórmula aprobada.",
  MP_EXTRA: "Hay una materia prima que no está en la fórmula aprobada.",
  SIN_PORCENTAJE: "Hay materias primas sin porcentaje.",
  FORMULA_NO_VERIFICABLE: "No se pudo contrastar con la fórmula aprobada.",
};
