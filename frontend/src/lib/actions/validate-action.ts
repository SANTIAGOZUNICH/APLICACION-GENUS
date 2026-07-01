import type {
  ActionContext,
  ActionDefinition,
  ActionFlowData,
  OperationsState,
  ValidationCheckResult,
} from "@/types/actions";
import { ActionIds } from "@/types/actions";

function requireFormStep(
  flowData: ActionFlowData,
  stepId: string,
  fields: string[]
): ValidationCheckResult {
  const step = flowData[stepId];
  if (!step) {
    return { valid: false, message: "Completá todos los pasos antes de continuar." };
  }

  const fieldErrors: Record<string, string> = {};
  for (const field of fields) {
    if (!step[field]?.trim()) {
      fieldErrors[field] = "Este campo es obligatorio.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors, message: "Revisá los campos marcados." };
  }

  return { valid: true };
}

/** Mock validation — UX rules only, not GMP logic. */
export function validateAction(
  definition: ActionDefinition,
  _context: ActionContext,
  _state: OperationsState,
  flowData: ActionFlowData
): ValidationCheckResult {
  switch (definition.id) {
    case ActionIds.OE_REGISTRAR_CONSUMO:
      return requireFormStep(flowData, "consumo", ["mp", "loteMp", "cantidad"]);

    case ActionIds.OE_REGISTRAR_CONTROL:
      return requireFormStep(flowData, "control", ["punto", "valor"]);

    case ActionIds.OA_REGISTRAR_CONSUMO:
      return requireFormStep(flowData, "consumo", ["material", "lote", "cantidad"]);

    case ActionIds.LOTE_CARGAR_ANALISIS:
      return requireFormStep(flowData, "analisis", ["ensayo", "resultado"]);

    case ActionIds.LIBERACION_PREPARAR_DISPOSICION:
      return requireFormStep(flowData, "disposicion", ["decision", "evidencia"]);

    case ActionIds.LIBERACION_FIRMAR: {
      const base = requireFormStep(flowData, "firma", ["decision"]);
      if (!base.valid) return base;
      return { valid: true };
    }

    case ActionIds.PEDIDO_DESPACHAR: {
      const base = requireFormStep(flowData, "despacho", [
        "renglon",
        "lotePt",
        "cantidad",
      ]);
      if (!base.valid) return base;
      const lote = flowData.despacho?.lotePt ?? "";
      if (lote.includes("MP-")) {
        return {
          valid: false,
          fieldErrors: {
            lotePt: "Solo se despacha producto terminado liberado.",
          },
          message: "Ese lote no es apto para despacho.",
        };
      }
      return { valid: true };
    }

    case ActionIds.OE_CERRAR:
    case ActionIds.OA_CERRAR:
      return { valid: true };

    default:
      return { valid: true };
  }
}
