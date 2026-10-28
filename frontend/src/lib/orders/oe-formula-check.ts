/**
 * «Fórmula pendiente de verificación»: contención de seguridad. Una OE cuya composición no coincide con la fórmula aprobada (o no se
 * puede contrastar y es sospechosa) no puede entregarse ni contabilizar consumos de MP hasta que Producción/Dirección la verifique.
 * Solo LEE: no modifica fórmulas aprobadas ni consumos ya registrados.
 */
import type { FormulaBankService } from "@/lib/formulas/formula-bank-service";
import {
  evaluateOeFormula,
  oeCompositionSignature,
  type ApprovedIngredient,
  type FormulaIssue,
  type OeFormulaEvaluation,
} from "@/lib/formulas/oe-formula-compare";
import type { OeContent } from "@/lib/orders/types";

export type OeFormulaCheck = {
  /** true = «Fórmula pendiente de verificación»: bloquea entrega y consumos. */
  pending: boolean;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  issues: FormulaIssue[];
  /** Versión del banco vinculada a la OE (si hay). */
  formulaVersionId: string | null;
  evaluation: OeFormulaEvaluation;
  message: string | null;
};

export const FORMULA_PENDING_MESSAGE =
  "Fórmula pendiente de verificación: la composición de esta OE no coincide con la fórmula aprobada. Producción o Dirección debe verificarla antes de entregar o descontar materias primas.";

export function checkOeFormula(
  content: OeContent,
  link: { formulaVersionId: string | null },
  bank: FormulaBankService | null
): OeFormulaCheck {
  let approved: ApprovedIngredient[] | null = null;
  const issues: FormulaIssue[] = [];
  if (link.formulaVersionId && bank) {
    const snap = bank.getVersionForAuthorizedOrder(link.formulaVersionId);
    const trace = bank.getVersionTrace(link.formulaVersionId);
    if (snap) {
      approved = snap.ingredients.map((i) => ({ materialName: i.materialName, materialCodeOrPhase: i.materialCodeOrPhase, percentage: i.percentage }));
    }
    // Versión importada con % reescalados (parser anterior) o marcada en revisión: la propia fuente no es confiable.
    if (trace && (trace.suspectDerivation || trace.reviewRequired)) issues.push("FORMULA_NO_VERIFICABLE");
  }
  const evaluation = evaluateOeFormula(content.materials, approved);
  const all = [...new Set([...evaluation.issues, ...issues])];
  const signature = oeCompositionSignature(content.materials);
  const v = content.formulaVerification;
  const verified = v?.status === "VERIFICADA" && v.signature === signature;
  const consistent = all.length === 0;
  // Se bloquea cuando la OE proviene de una fórmula (vinculada al banco o armada por la preparación automática) o su fuente es
  // sospechosa. Una OE armada a mano sin fuente solo informa (el autocontrol de suma se ve en la auditoría y en el aviso).
  const fromFormula = link.formulaVersionId != null || content.autoPrep != null;
  const blocking = !consistent && (fromFormula || all.includes("FORMULA_NO_VERIFICABLE"));
  const pending = blocking && !verified;
  return {
    pending,
    verified: verified && blocking,
    verifiedBy: verified ? v!.by : null,
    verifiedAt: verified ? v!.at : null,
    issues: all,
    formulaVersionId: link.formulaVersionId,
    evaluation,
    message: pending ? FORMULA_PENDING_MESSAGE : null,
  };
}
