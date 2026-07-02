import {
  oePageHref,
  oaPageHref,
  pedidoPageHref,
  liberacionPageHref,
  lotePageHref,
} from "@/config/entity-pages";
import type { OeListItem, OaListItem, PedidoSummary } from "@/lib/adapters/drive/types/document.types";
import { buildOeSummaryFromIndex } from "@/lib/mappers/sheet-oe-to-entity";
import { buildOaSummaryFromIndex } from "@/lib/mappers/sheet-oa-to-entity";
import { buildPedidoSummaryCardData } from "@/lib/mappers/sheet-pedido-to-entity";
import { buildLoteSummaryFromRow } from "@/lib/mappers/sheet-lote-to-entity";
import {
  resolveProduccionSectionId,
  sortOesByRecency,
} from "@/lib/mappers/oe-section-utils";
import type { LiberacionSummary } from "@/lib/mappers/sheet-liberacion-to-entity";
import type { LoteRow } from "@/lib/adapters/sheets/types/sheets-row.types";
import { ActionIds } from "@/types/actions";
import type { WorkspaceId } from "@/types/actions";
import { BandejaEntityType } from "@/types/bandeja/bandeja-task";
import type { WorkspaceTask } from "@/types/workspace/workspace-task";
import { Status } from "@/types/ui/status";

export interface WorkspaceBuildInput {
  oes: OeListItem[];
  oas: OaListItem[];
  pedidos: PedidoSummary[];
  lotes: LoteRow[];
  liberaciones: LiberacionSummary[];
}

const MAX_PRODUCCION_OES = 100;
const MAX_LOTES = 50;
const MAX_PEDIDOS = 50;

function pushTask(
  tasks: WorkspaceTask[],
  task: WorkspaceTask,
  limit: number
) {
  if (tasks.length < limit) {
    tasks.push(task);
  }
}

function sectionForCalidadLote(status: Status): string {
  if (status === Status.LIBERADO) return "finalizados";
  if (status === Status.POR_VENCER || status === Status.BLOQUEADO || status === Status.FUERA_DE_TOLERANCIA) {
    return "problemas";
  }
  return "para-analizar";
}

function sectionForCalidadLiberacion(status: Status): string {
  if (status === Status.LIBERADO) return "finalizados";
  if (status === Status.BORRADOR_EN_REVISION) return "esperando-firma";
  if (status === Status.BLOQUEADO || status === Status.RECHAZADO) return "problemas";
  return "para-analizar";
}

function sectionForComercialPedido(status: Status): string {
  if (status === Status.COMPLETO) return "cerrados";
  if (status === Status.CRITICO || status === Status.PARCIAL) return "problemas";
  if (status === Status.PENDIENTE) return "necesita-seguimiento";
  return "en-produccion";
}

function sectionForDepositoPedido(status: Status): string {
  if (status === Status.COMPLETO) return "finalizados";
  if (status === Status.CRITICO || status === Status.POR_VENCER || status === Status.BLOQUEADO) {
    return "problemas";
  }
  return "para-mover";
}

function sectionForDepositoLote(status: Status): string {
  if (status === Status.LIBERADO) return "finalizados";
  if (status === Status.POR_VENCER || status === Status.BLOQUEADO) return "problemas";
  if (status === Status.CUARENTENA) return "esperando-otros";
  return "para-mover";
}

export function buildWorkspaceTasks(
  input: WorkspaceBuildInput
): Record<WorkspaceId, WorkspaceTask[]> {
  const produccion: WorkspaceTask[] = [];
  const calidad: WorkspaceTask[] = [];
  const deposito: WorkspaceTask[] = [];
  const comercial: WorkspaceTask[] = [];
  const direccion: WorkspaceTask[] = [];
  const dt: WorkspaceTask[] = [];

  sortOesByRecency(input.oes).forEach((entry, index) => {
    const summary = buildOeSummaryFromIndex(entry);
    const sectionId = resolveProduccionSectionId(entry);

    pushTask(produccion, {
      id: `prod-oe-${entry.fileId}`,
      sectionId,
      urgencyScore: 900 - index,
      payload: {
        entityType: BandejaEntityType.OE,
        data: {
          oeId: summary.oeId,
          productName: summary.productName,
          status: summary.status,
          loteGranel: summary.loteGranel,
          batchSize: summary.batchSize,
          responsable: summary.responsable,
          progressPercent: summary.progressPercent,
          primaryAction: {
            label: "Abrir ficha",
          },
          href: oePageHref(summary.lookupKey),
        },
      },
    }, MAX_PRODUCCION_OES);
  });

  input.oas.slice(0, 20).forEach((entry, index) => {
    const summary = buildOaSummaryFromIndex(entry);
    pushTask(produccion, {
      id: `prod-oa-${entry.fileId}`,
      sectionId: summary.status === Status.PLANIFICADA ? "esperando-otros" : "en-curso",
      urgencyScore: 850 - index * 10,
      payload: {
        entityType: BandejaEntityType.OA,
        data: {
          oaId: summary.oaId,
          skuName: summary.skuName,
          status: summary.status,
          lotePt: summary.lotePt,
          unidades: summary.unidades,
          responsable: summary.responsable,
          progressPercent: summary.progressPercent,
          primaryAction: {
            label: "Registrar avance",
            actionId: ActionIds.OA_REGISTRAR_CONSUMO,
          },
          href: oaPageHref(summary.lookupKey),
        },
      },
    }, MAX_PRODUCCION_OES);
  });

  input.liberaciones.slice(0, 20).forEach((lib, index) => {
    const sectionId = sectionForCalidadLiberacion(lib.status);

    pushTask(calidad, {
      id: `cal-lib-${lib.liberacionId}`,
      sectionId,
      urgencyScore: 880 - index * 8,
      payload: {
        entityType: BandejaEntityType.LIBERACION,
        data: {
          loteNumber: lib.loteNumber,
          ordenRef: lib.ordenRef,
          status: lib.status,
          evidencia: lib.evidencia,
          diasCuarentena: lib.diasCuarentena,
          primaryAction: {
            label: "Revisar disposición",
            actionId: ActionIds.LIBERACION_PREPARAR_DISPOSICION,
          },
          href: liberacionPageHref(lib.liberacionId),
        },
      },
    }, MAX_LOTES);

    if (lib.status === Status.BORRADOR_EN_REVISION) {
      pushTask(dt, {
        id: `dt-lib-${lib.liberacionId}`,
        sectionId: "esperando-firma",
        urgencyScore: 860 - index * 8,
        payload: {
          entityType: BandejaEntityType.LIBERACION,
          data: {
            loteNumber: lib.loteNumber,
            ordenRef: lib.ordenRef,
            status: lib.status,
            evidencia: lib.evidencia,
            diasCuarentena: lib.diasCuarentena,
            primaryAction: {
              label: "Revisar disposición",
              actionId: ActionIds.LIBERACION_PREPARAR_DISPOSICION,
            },
            href: liberacionPageHref(lib.liberacionId),
          },
        },
      }, 20);
    }
  });

  input.lotes.slice(0, MAX_LOTES).forEach((lote, index) => {
    const summary = buildLoteSummaryFromRow(lote);
    const calidadSection = sectionForCalidadLote(summary.status);
    const depositoSection = sectionForDepositoLote(summary.status);

    pushTask(calidad, {
      id: `cal-lote-${summary.loteId}`,
      sectionId: calidadSection,
      urgencyScore: 820 - index * 8,
      payload: {
        entityType: BandejaEntityType.LOTE,
        data: {
          ...summary,
          primaryAction: { label: "Ver trazabilidad", onClick: () => undefined },
          href: lotePageHref(summary.loteId),
        },
      },
    }, MAX_LOTES);

    pushTask(deposito, {
      id: `dep-lote-${summary.loteId}`,
      sectionId: depositoSection,
      urgencyScore: 700 - index * 8,
      payload: {
        entityType: BandejaEntityType.LOTE,
        data: {
          ...summary,
          primaryAction: { label: "Ver trazabilidad", onClick: () => undefined },
          href: lotePageHref(summary.loteId),
        },
      },
    }, MAX_LOTES);
  });

  input.pedidos.slice(0, MAX_PEDIDOS).forEach((pedido, index) => {
    const card = buildPedidoSummaryCardData(pedido);
    const comercialSection = sectionForComercialPedido(card.status);
    const depositoSection = sectionForDepositoPedido(card.status);

    pushTask(comercial, {
      id: `com-ped-${pedido.pedidoId}`,
      sectionId: comercialSection,
      urgencyScore: 780 - index * 8,
      payload: {
        entityType: BandejaEntityType.PEDIDO,
        data: {
          ...card,
          primaryAction: {
            label: "Seguir despacho",
            actionId: ActionIds.PEDIDO_DESPACHAR,
          },
          href: pedidoPageHref(pedido.pedidoId),
        },
      },
    }, MAX_PEDIDOS);

    pushTask(deposito, {
      id: `dep-ped-${pedido.pedidoId}`,
      sectionId: depositoSection,
      urgencyScore: 760 - index * 8,
      payload: {
        entityType: BandejaEntityType.PEDIDO,
        data: {
          ...card,
          primaryAction: {
            label: "Seguir despacho",
            actionId: ActionIds.PEDIDO_DESPACHAR,
          },
          href: pedidoPageHref(pedido.pedidoId),
        },
      },
    }, MAX_PEDIDOS);

    if (card.status === Status.PARCIAL || card.status === Status.CRITICO) {
      pushTask(direccion, {
        id: `dir-ped-${pedido.pedidoId}`,
        sectionId: "excepciones",
        urgencyScore: 950 - index * 8,
        payload: {
          entityType: BandejaEntityType.PEDIDO,
          data: {
            ...card,
            primaryAction: { label: "Escalar", onClick: () => undefined },
            href: pedidoPageHref(pedido.pedidoId),
          },
        },
      }, MAX_PEDIDOS);
    }
  });

  return {
    produccion,
    calidad,
    deposito,
    comercial,
    direccion,
    dt,
  };
}
