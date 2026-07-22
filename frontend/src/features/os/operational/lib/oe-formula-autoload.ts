/**
 * Autoload de fórmula maestra en OE — lógica pura (tests sintéticos).
 * No imprime ni loguea contenido de fórmulas.
 */
import { normalizeSearchKey } from "@/lib/formulas/types";
import {
  emptyOeMaterial,
  recomputeOeDerived,
} from "@/lib/orders/content";
import type { OeContent, OeMaterialRow, OeProcedureStep } from "@/lib/orders/types";

export type FormulaAutoloadStatus =
  | "idle"
  | "select_client"
  | "select_product"
  | "searching"
  | "found"
  | "not_found"
  | "multiple"
  | "conflict"
  | "error"
  | "skipped_manual"
  | "awaiting_confirm"
  | "did_you_mean";

export type FormulaResolvePayload = {
  found: boolean;
  conflict?: boolean;
  conflictCode?: string;
  reason?: string;
  message?: string;
  persistenceReady?: boolean;
  error?: string;
  snapshot?: {
    formulaProductId: string;
    formulaVersionId: string;
    versionHash: string;
  };
  materials?: Array<{
    materiaPrima: string;
    codigo: string;
    formulaPct: number | null;
  }>;
  procedureSteps?: Array<{ id: string; text: string }>;
};

export function formulaIdentityKey(client: string, product: string): string {
  return `${normalizeSearchKey(client)}||${normalizeSearchKey(product)}`;
}

/** True si hay contenido de fórmula que el usuario pudo haber editado. */
export function oeHasFormulaContent(content: OeContent): boolean {
  const hasMaterials = content.materials.some(
    (m) =>
      m.materiaPrima.trim() !== "" ||
      m.codigo.trim() !== "" ||
      m.formulaPct != null ||
      (m.kgAPesar != null && m.kgAPesar !== 0) ||
      m.lote.trim() !== ""
  );
  const hasProcedure = content.procedureSteps.some((s) => s.text.trim() !== "");
  return hasMaterials || hasProcedure;
}

/**
 * Si ya hay fórmula cargada/editada y cambia la identidad, pedir confirmación.
 */
export function needsReplaceConfirmation(args: {
  previousIdentity: string | null;
  nextIdentity: string;
  hasContent: boolean;
}): boolean {
  if (!args.hasContent) return false;
  if (!args.previousIdentity) return true;
  return args.previousIdentity !== args.nextIdentity;
}

export function applyFormulaResolveToOe(
  content: OeContent,
  payload: FormulaResolvePayload
): {
  content: OeContent;
  formulaProductId: string;
  formulaVersionId: string;
  formulaVersionHash: string;
} | null {
  if (!payload.found || !payload.snapshot || !payload.materials) return null;
  const materials: OeMaterialRow[] = payload.materials.map((m) =>
    emptyOeMaterial({
      materiaPrima: m.materiaPrima,
      codigo: m.codigo,
      formulaPct: m.formulaPct,
      kgAPesar: null, // nunca kg fijos del Excel como producción
    })
  );
  const procedureSteps: OeProcedureStep[] = (payload.procedureSteps ?? []).map(
    (s) => ({
      id: s.id,
      text: s.text,
    })
  );
  const next: OeContent = {
    ...content,
    // Cantidad Kg permanece como esté (vacía inicialmente).
    materials,
    procedureSteps,
  };
  return {
    content: recomputeOeDerived(next),
    formulaProductId: payload.snapshot.formulaProductId,
    formulaVersionId: payload.snapshot.formulaVersionId,
    formulaVersionHash: payload.snapshot.versionHash,
  };
}

export function clearFormulaFromOe(content: OeContent): OeContent {
  return recomputeOeDerived({
    ...content,
    materials: [emptyOeMaterial()],
    procedureSteps: [],
  });
}

export function statusMessage(
  status: FormulaAutoloadStatus,
  detail?: string
): string {
  switch (status) {
    case "select_client":
      return "Seleccioná un cliente.";
    case "select_product":
      return "Seleccioná un producto.";
    case "searching":
      return "Buscando fórmula…";
    case "found":
      return "Fórmula encontrada y cargada.";
    case "not_found":
      return (
        detail ||
        "No existe fórmula activa; podés completar la OE manualmente."
      );
    case "multiple":
      return "Hay varias coincidencias: elegí una.";
    case "did_you_mean":
      return detail ? `¿Quisiste decir ${detail}?` : "¿Quisiste decir…?";
    case "conflict":
      return "Fórmula excluida por conflicto; no se eligió automáticamente.";
    case "error":
      return "No pudimos consultar el banco de fórmulas";
    case "skipped_manual":
      return "Se conservó la fórmula editada manualmente";
    case "awaiting_confirm":
      return "¿Reemplazar la fórmula cargada por la del nuevo cliente/producto?";
    default:
      return "";
  }
}

/** Mapea reason del API a mensaje de estado. */
export function messageForResolveReason(reason?: string, apiMessage?: string): string {
  switch (reason) {
    case "pending_client":
      return "Cliente pendiente: la fórmula no está disponible para OE.";
    case "review_required":
      return "Fórmula requiere revisión y no está disponible para OE.";
    case "no_active":
      return "Producto sin fórmula activa; podés completar la OE manualmente.";
    case "ambiguous":
      return "Hay varias coincidencias: elegí una.";
    case "name_mismatch":
      return "No se encontró por diferencia de nombre; podés completar manualmente.";
    default:
      return (
        apiMessage ||
        "No existe fórmula activa; podés completar la OE manualmente."
      );
  }
}
