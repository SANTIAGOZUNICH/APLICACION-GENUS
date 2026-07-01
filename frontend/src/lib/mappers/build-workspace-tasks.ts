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

function pushTask(
  tasks: WorkspaceTask[],
  task: WorkspaceTask,
  limit: number
) {
  if (tasks.length < limit) {
    tasks.push(task);
  }
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

  input.oes.slice(0, 8).forEach((entry, index) => {
    const summary = buildOeSummaryFromIndex(entry);
    const sectionId =
      summary.status === Status.BLOQUEADO
        ? "problemas"
        : summary.status === Status.PLANIFICADA
          ? "en-cola"
          : summary.status === Status.CERRADA
            ? "finalizados"
            : "en-curso";

    pushTask(produccion, {
      id: `prod-oe-${entry.fileId}`,
      sectionId,
      urgencyScore: 900 - index * 10,
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
            label: "Continuar producción",
            actionId: ActionIds.OE_REGISTRAR_CONTROL,
          },
          href: oePageHref(summary.lookupKey),
        },
      },
    }, 12);
  });

  input.oas.slice(0, 8).forEach((entry, index) => {
    const summary = buildOaSummaryFromIndex(entry);
    pushTask(produccion, {
      id: `prod-oa-${entry.fileId}`,
      sectionId: summary.status === Status.PLANIFICADA ? "en-cola" : "en-curso",
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
    }, 12);
  });

  input.liberaciones.slice(0, 10).forEach((lib, index) => {
    pushTask(calidad, {
      id: `cal-lib-${lib.liberacionId}`,
      sectionId:
        lib.status === Status.BORRADOR_EN_REVISION
          ? "esperando-decision"
          : lib.status === Status.LIBERADO
            ? "finalizados"
            : "en-revision",
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
    }, 10);

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
      }, 9);
    }
  });

  input.lotes.slice(0, 10).forEach((lote, index) => {
    const summary = buildLoteSummaryFromRow(lote);
    pushTask(calidad, {
      id: `cal-lote-${summary.loteId}`,
      sectionId:
        summary.status === Status.POR_VENCER || summary.status === Status.BLOQUEADO
          ? "problemas"
          : "en-revision",
      urgencyScore: 820 - index * 8,
      payload: {
        entityType: BandejaEntityType.LOTE,
        data: {
          ...summary,
          primaryAction: { label: "Ver trazabilidad", onClick: () => undefined },
          href: lotePageHref(summary.loteId),
        },
      },
    }, 10);

    pushTask(deposito, {
      id: `dep-lote-${summary.loteId}`,
      sectionId: "stock",
      urgencyScore: 700 - index * 8,
      payload: {
        entityType: BandejaEntityType.LOTE,
        data: {
          ...summary,
          primaryAction: { label: "Ver trazabilidad", onClick: () => undefined },
          href: lotePageHref(summary.loteId),
        },
      },
    }, 12);
  });

  input.pedidos.slice(0, 10).forEach((pedido, index) => {
    const card = buildPedidoSummaryCardData(pedido);
    pushTask(comercial, {
      id: `com-ped-${pedido.pedidoId}`,
      sectionId:
        card.status === Status.COMPLETO
          ? "finalizados"
          : card.status === Status.CRITICO || card.status === Status.PARCIAL
            ? "compromisos"
            : "en-curso",
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
    }, 7);

    pushTask(deposito, {
      id: `dep-ped-${pedido.pedidoId}`,
      sectionId: "despacho",
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
    }, 12);

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
      }, 12);
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
