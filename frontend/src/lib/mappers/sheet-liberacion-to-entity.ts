import { ShieldCheck } from "lucide-react";
import { LIBERACION_FLOW, lotePageHref } from "@/config/entity-pages";
import type { LoteRow } from "@/lib/adapters/sheets/types/sheets-row.types";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";
import { ActionIds } from "@/types/actions";
import {
  inferLiberacionStatus,
  isLiberacionCandidate,
  liberacionIdFromLote,
  loteIdFromLiberacion,
  pickField,
} from "@/lib/mappers/sheet-field-resolver";

export interface LiberacionSummary {
  liberacionId: string;
  loteId: string;
  loteNumber: string;
  ordenRef: string;
  producto: string;
  estado: string;
  status: Status;
  evidencia: string;
  diasCuarentena: number;
}

function inferStageId(status: Status): string {
  switch (status) {
    case Status.LIBERADO:
      return "liberado";
    case Status.RECHAZADO:
      return "rechazado";
    case Status.BORRADOR_EN_REVISION:
      return "borrador";
    default:
      return "cuarentena";
  }
}

function estimateDiasCuarentena(fechaRecepcion: string): number {
  if (!fechaRecepcion) return 0;
  const parsed = Date.parse(fechaRecepcion);
  if (Number.isNaN(parsed)) return 0;
  const diffMs = Date.now() - parsed;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export function buildLiberacionSummaryFromLote(lote: LoteRow): LiberacionSummary | null {
  if (!isLiberacionCandidate(lote.estado || "")) {
    return null;
  }

  const loteId = lote.loteId || lote.nroLote;
  if (!loteId) return null;

  const status = inferLiberacionStatus(lote.estado || "cuarentena");

  return {
    liberacionId: liberacionIdFromLote(loteId),
    loteId,
    loteNumber: loteId,
    ordenRef: pickField(lote as unknown as Record<string, string>, "oeRef", "referencia_id") || "—",
    producto: lote.itemId || lote.tipoItem || loteId,
    estado: lote.estado,
    status,
    evidencia: lote.estado || "En revisión de calidad",
    diasCuarentena: estimateDiasCuarentena(lote.fechaRecepcion),
  };
}

export function buildLiberacionSummariesFromLotes(
  lotes: LoteRow[]
): LiberacionSummary[] {
  return lotes
    .map(buildLiberacionSummaryFromLote)
    .filter((item): item is LiberacionSummary => item !== null);
}

export function buildLiberacionEntityPageFromLote(lote: LoteRow): EntityPageModel | null {
  const summary = buildLiberacionSummaryFromLote(lote);
  if (!summary) return null;

  return {
    kind: EntityPageKinds.LIBERACION,
    entityId: summary.liberacionId,
    title: `Liberación ${summary.loteNumber}`,
    subtitle: summary.producto,
    status: summary.status,
    identityIcon: ShieldCheck,
    statusFlow: LIBERACION_FLOW,
    currentStageId: inferStageId(summary.status),
    primaryAction:
      summary.status === Status.LIBERADO
        ? undefined
        : {
            label: "Revisar disposición",
            actionId: ActionIds.LIBERACION_PREPARAR_DISPOSICION,
          },
    sections: [
      {
        id: "datos",
        title: "Datos de la liberación",
        content: {
          type: "key-values",
          items: [
            {
              id: "lote",
              label: "Lote",
              value: summary.loteNumber,
              href: lotePageHref(summary.loteNumber),
            },
            { id: "producto", label: "Producto", value: summary.producto },
            { id: "estado", label: "Estado", value: summary.estado || "—" },
            {
              id: "dias-cq",
              label: "Días en cuarentena",
              value: `${summary.diasCuarentena} días`,
            },
            { id: "evidencia", label: "Evidencia", value: summary.evidencia },
          ],
        },
      },
    ],
    activityLog: [
      {
        id: "lib-loaded",
        timestamp: new Date().toISOString(),
        user: "Sistema",
        action: "Derivado de ASIGNACION DE LOTES 2026",
        description: `Liberación construida desde el lote ${summary.loteNumber}.`,
      },
    ],
    relatedObjects: [],
  };
}

export function findLiberacionEntityPage(
  lotes: LoteRow[],
  lookupKey: string
): EntityPageModel | null {
  const targetLoteId = loteIdFromLiberacion(lookupKey).toLowerCase();

  for (const lote of lotes) {
    const loteId = (lote.loteId || lote.nroLote).toLowerCase();
    const liberacionId = liberacionIdFromLote(loteId).toLowerCase();

    if (
      loteId === targetLoteId ||
      liberacionId === lookupKey.trim().toLowerCase()
    ) {
      return buildLiberacionEntityPageFromLote(lote);
    }
  }

  return null;
}
