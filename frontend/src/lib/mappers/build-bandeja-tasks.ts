import {
  oePageHref,
  oaPageHref,
  pedidoPageHref,
  liberacionPageHref,
  lotePageHref,
} from "@/config/entity-pages";
import type { OeListItem, PedidoSummary } from "@/lib/adapters/drive/types/document.types";
import type { OaListItem } from "@/lib/adapters/drive/types/document.types";
import { buildOeSummaryFromIndex } from "@/lib/mappers/sheet-oe-to-entity";
import { buildOaSummaryFromIndex } from "@/lib/mappers/sheet-oa-to-entity";
import { buildPedidoSummaryCardData } from "@/lib/mappers/sheet-pedido-to-entity";
import { buildLoteSummaryFromRow } from "@/lib/mappers/sheet-lote-to-entity";
import { sortOesByRecency } from "@/lib/mappers/oe-section-utils";
import type { LiberacionSummary } from "@/lib/mappers/sheet-liberacion-to-entity";
import type { LoteRow } from "@/lib/adapters/sheets/types/sheets-row.types";
import { ActionIds } from "@/types/actions";
import { BandejaSectionId } from "@/types/bandeja/bandeja-section";
import {
  BandejaEntityType,
  type BandejaDayPulse,
  type BandejaTask,
} from "@/types/bandeja/bandeja-task";
import { Status } from "@/types/ui/status";

export interface BandejaBuildInput {
  oes: OeListItem[];
  oas: OaListItem[];
  pedidos: PedidoSummary[];
  lotes: LoteRow[];
  liberaciones: LiberacionSummary[];
}

function sectionForOeStatus(status: Status): BandejaSectionId {
  if (status === Status.CERRADA) return BandejaSectionId.FINALIZADOS;
  if (status === Status.BLOQUEADO) return BandejaSectionId.PROBLEMAS;
  if (status === Status.PLANIFICADA) return BandejaSectionId.EN_COLA;
  return BandejaSectionId.AHORA;
}

function sectionForOaStatus(status: Status): BandejaSectionId {
  if (status === Status.CERRADA) return BandejaSectionId.FINALIZADOS;
  if (status === Status.BLOQUEADO) return BandejaSectionId.PROBLEMAS;
  if (status === Status.PLANIFICADA) return BandejaSectionId.EN_COLA;
  return BandejaSectionId.AHORA;
}

function sectionForPedidoStatus(status: Status): BandejaSectionId {
  if (status === Status.COMPLETO) return BandejaSectionId.FINALIZADOS;
  if (status === Status.CRITICO || status === Status.PARCIAL) {
    return BandejaSectionId.PROBLEMAS;
  }
  if (status === Status.PENDIENTE) return BandejaSectionId.EN_COLA;
  return BandejaSectionId.AHORA;
}

function sectionForLoteStatus(status: Status): BandejaSectionId {
  if (status === Status.LIBERADO) return BandejaSectionId.FINALIZADOS;
  if (status === Status.POR_VENCER || status === Status.BLOQUEADO) {
    return BandejaSectionId.PROBLEMAS;
  }
  return BandejaSectionId.ESPERANDO_OTROS;
}

function sectionForLiberacionStatus(status: Status): BandejaSectionId {
  if (status === Status.LIBERADO) return BandejaSectionId.FINALIZADOS;
  if (status === Status.BORRADOR_EN_REVISION) {
    return BandejaSectionId.ESPERANDO_DECISION;
  }
  if (status === Status.BLOQUEADO || status === Status.RECHAZADO) {
    return BandejaSectionId.PROBLEMAS;
  }
  return BandejaSectionId.ESPERANDO_OTROS;
}

function urgencyForSection(sectionId: BandejaSectionId, index: number): number {
  const base: Record<BandejaSectionId, number> = {
    [BandejaSectionId.PROBLEMAS]: 960,
    [BandejaSectionId.AHORA]: 900,
    [BandejaSectionId.ESPERANDO_DECISION]: 840,
    [BandejaSectionId.EN_COLA]: 600,
    [BandejaSectionId.ESPERANDO_OTROS]: 380,
    [BandejaSectionId.FINALIZADOS]: 100,
  };
  return base[sectionId] - index * 5;
}

export function buildBandejaTasks(input: BandejaBuildInput): BandejaTask[] {
  const tasks: BandejaTask[] = [];
  let counter = 0;

  for (const entry of sortOesByRecency(input.oes).slice(0, 50)) {
    const summary = buildOeSummaryFromIndex(entry);
    const sectionId = sectionForOeStatus(summary.status);
    tasks.push({
      id: `oe-${entry.fileId}`,
      sectionId,
      urgencyScore: urgencyForSection(sectionId, counter++),
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
    });
  }

  for (const entry of input.oas.slice(0, 20)) {
    const summary = buildOaSummaryFromIndex(entry);
    const sectionId = sectionForOaStatus(summary.status);
    tasks.push({
      id: `oa-${entry.fileId}`,
      sectionId,
      urgencyScore: urgencyForSection(sectionId, counter++),
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
    });
  }

  for (const pedido of input.pedidos.slice(0, 30)) {
    const card = buildPedidoSummaryCardData(pedido);
    const sectionId = sectionForPedidoStatus(card.status);
    tasks.push({
      id: `ped-${pedido.pedidoId}`,
      sectionId,
      urgencyScore: urgencyForSection(sectionId, counter++),
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
    });
  }

  for (const lote of input.lotes.slice(0, 30)) {
    const summary = buildLoteSummaryFromRow(lote);
    const sectionId = sectionForLoteStatus(summary.status);
    tasks.push({
      id: `lote-${summary.loteId}`,
      sectionId,
      urgencyScore: urgencyForSection(sectionId, counter++),
      payload: {
        entityType: BandejaEntityType.LOTE,
        data: {
          ...summary,
          primaryAction: { label: "Ver trazabilidad", onClick: () => undefined },
          href: lotePageHref(summary.loteId),
        },
      },
    });
  }

  for (const lib of input.liberaciones.slice(0, 20)) {
    const sectionId = sectionForLiberacionStatus(lib.status);
    tasks.push({
      id: `lib-${lib.liberacionId}`,
      sectionId,
      urgencyScore: urgencyForSection(sectionId, counter++),
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
    });
  }

  return tasks.sort((a, b) => b.urgencyScore - a.urgencyScore);
}

export function buildDayPulse(tasks: BandejaTask[]): BandejaDayPulse {
  const pending = tasks.filter(
    (task) => task.sectionId !== BandejaSectionId.FINALIZADOS
  ).length;
  const completed = tasks.filter(
    (task) => task.sectionId === BandejaSectionId.FINALIZADOS
  ).length;

  return { completed, pending };
}
