import type { OeListItem, PedidoSummary } from "@/lib/adapters/drive/types/document.types";
import { buildOeSummaryFromIndex } from "@/lib/mappers/sheet-oe-to-entity";
import { buildPedidoSummaryCardData } from "@/lib/mappers/sheet-pedido-to-entity";
import type { LiberacionSummary } from "@/lib/mappers/sheet-liberacion-to-entity";
import type { LoteRow } from "@/lib/adapters/sheets/types/sheets-row.types";
import { buildLoteSummaryFromRow } from "@/lib/mappers/sheet-lote-to-entity";
import type { WorkspaceId } from "@/types/actions";
import type { WorkspacePanoramaMetric } from "@/types/workspace/workspace-task";
import { Status } from "@/types/ui/status";

export interface PanoramaBuildInput {
  oes: OeListItem[];
  pedidos: PedidoSummary[];
  lotes: LoteRow[];
  liberaciones: LiberacionSummary[];
}

export function buildDireccionPanorama(
  input: PanoramaBuildInput
): WorkspacePanoramaMetric[] {
  const oeEnCurso = input.oes.filter((entry) => {
    const summary = buildOeSummaryFromIndex(entry);
    return summary.status === Status.EN_CURSO;
  }).length;

  const lotesCuarentena = input.lotes.filter((lote) => {
    const summary = buildLoteSummaryFromRow(lote);
    return summary.status === Status.CUARENTENA;
  }).length;

  const pedidosRiesgo = input.pedidos.filter((pedido) => {
    const card = buildPedidoSummaryCardData(pedido);
    return card.status === Status.PARCIAL || card.status === Status.CRITICO;
  }).length;

  const liberadosHoy = input.liberaciones.filter(
    (lib) => lib.status === Status.LIBERADO
  ).length;

  return [
    {
      id: "oe-curso",
      label: "OE en curso",
      value: String(oeEnCurso),
      hint: "Elaboración activa",
      tone: oeEnCurso > 0 ? "attention" : "ok",
    },
    {
      id: "cuarentena",
      label: "Lotes en cuarentena",
      value: String(lotesCuarentena),
      hint: "Esperando Calidad",
      tone: lotesCuarentena > 0 ? "attention" : "ok",
    },
    {
      id: "pedidos-riesgo",
      label: "Pedidos en riesgo",
      value: String(pedidosRiesgo),
      hint: "Compromiso ≤ 7 días",
      tone: pedidosRiesgo > 0 ? "problem" : "ok",
    },
    {
      id: "liberados-hoy",
      label: "Liberados hoy",
      value: String(liberadosHoy),
      hint: "PT + Granel",
      tone: "ok",
    },
  ];
}

export function buildWorkspacePanorama(
  input: PanoramaBuildInput
): Partial<Record<WorkspaceId, WorkspacePanoramaMetric[]>> {
  return {
    direccion: buildDireccionPanorama(input),
  };
}
