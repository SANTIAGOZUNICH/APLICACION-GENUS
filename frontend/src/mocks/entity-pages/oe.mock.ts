import { Factory } from "lucide-react";
import {
  lotePageHref,
  oaPageHref,
  pedidoPageHref,
  PRODUCTION_ORDER_FLOW,
} from "@/config/entity-pages";
import { ActionIds } from "@/types/actions";
import {
  labPeople,
  labProducts,
  labSectors,
} from "@/mocks/workspace/lab-context";
import { CROSS_LINK } from "@/mocks/entity-pages/cross-link";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";

const OE_0142: EntityPageModel = {
  kind: EntityPageKinds.OE,
  entityId: CROSS_LINK.oeId,
  title: labProducts.granelBodySplash,
  subtitle: `${labSectors.elaboracion} · Batch 480 kg`,
  status: Status.EN_CURSO,
  identityIcon: Factory,
  statusFlow: PRODUCTION_ORDER_FLOW,
  currentStageId: "en-curso",
  primaryAction: { label: "Continuar elaboración", actionId: ActionIds.OE_REGISTRAR_CONTROL },
  secondaryActions: [{ label: "Registrar consumo", variant: "secondary", actionId: ActionIds.OE_REGISTRAR_CONSUMO }],
  sections: [
    {
      id: "datos",
      title: "Datos de la orden",
      description: "Identificación y planificación del batch.",
      content: {
        type: "key-values",
        items: [
          { id: "producto", label: "Producto", value: labProducts.granelBodySplash },
          { id: "formula", label: "Fórmula", value: "F-BS-VERB-012" },
          { id: "batch", label: "Tamaño de batch", value: "480 kg" },
          {
            id: "lote",
            label: "Lote granel",
            value: CROSS_LINK.loteGranel,
            href: lotePageHref(CROSS_LINK.loteGranel),
          },
          { id: "sector", label: "Sector", value: labSectors.elaboracion },
          { id: "responsable", label: "Responsable", value: labPeople.cristian },
          { id: "inicio", label: "Inicio", value: "30/06/2026 08:15" },
          { id: "avance", label: "Avance", value: "78 %" },
        ],
      },
    },
    {
      id: "controles",
      title: "Controles en proceso",
      description: "Puntos de control del batch — cards, no tablas.",
      content: {
        type: "cards",
        cards: [
          {
            id: "cp-temp",
            title: "Temperatura mezclado",
            status: Status.EN_TOLERANCIA,
            description: "Punto 3 · Tanque T-02",
            items: [
              { id: "spec", label: "Especificación", value: "55 – 60 °C" },
              { id: "valor", label: "Último valor", value: "57 °C" },
              { id: "hora", label: "Registrado", value: "Hoy 11:40" },
            ],
          },
          {
            id: "cp-ph",
            title: "pH en proceso",
            status: Status.EN_TOLERANCIA,
            description: "Punto 5 · Muestra intermedia",
            items: [
              { id: "spec", label: "Especificación", value: "5.0 – 5.8" },
              { id: "valor", label: "Último valor", value: "5.4" },
              { id: "hora", label: "Registrado", value: "Hoy 10:20" },
            ],
          },
          {
            id: "cp-homog",
            title: "Homogeneidad visual",
            status: Status.EN_CURSO,
            description: "Pendiente verificación final",
            items: [
              { id: "spec", label: "Criterio", value: "Sin grumos · color uniforme" },
              { id: "resp", label: "Responsable", value: labPeople.natalia },
            ],
          },
        ],
      },
    },
    {
      id: "consumos",
      title: "Consumos",
      description: "Auditoría de materias primas consumidas en el batch.",
      content: {
        type: "audit-table",
        table: {
          id: "consumos-oe-0142",
          columns: [
            { id: "mp", label: "Materia prima" },
            { id: "lote", label: "Lote MP" },
            { id: "teorico", label: "Teórico" },
            { id: "real", label: "Real" },
            { id: "desvio", label: "Desvío" },
          ],
          rows: [
            {
              id: "c1",
              cells: {
                mp: "Agua purificada",
                lote: "—",
                teorico: "285 kg",
                real: "284.5 kg",
                desvio: "−0.2 %",
              },
            },
            {
              id: "c2",
              cells: {
                mp: "Extracto de verbena",
                lote: "MP-2026-0210",
                teorico: "4.8 kg",
                real: "4.8 kg",
                desvio: "0 %",
              },
            },
            {
              id: "c3",
              cells: {
                mp: "Vitamina E",
                lote: "MP-2026-0331",
                teorico: "2.4 kg",
                real: "2.52 kg",
                desvio: "+5.0 %",
              },
            },
            {
              id: "c4",
              cells: {
                mp: "Conservante K",
                lote: "MP-2026-0198",
                teorico: "0.96 kg",
                real: "0.95 kg",
                desvio: "−1.0 %",
              },
            },
          ],
        },
      },
    },
    {
      id: "trazabilidad",
      title: "Trazabilidad",
      content: {
        type: "cards",
        cards: [
          {
            id: "oa-vinculada",
            title: "Orden de acondicionamiento",
            status: Status.EN_CURSO,
            items: [
              {
                id: "oa",
                label: "OA",
                value: CROSS_LINK.oaId,
                href: oaPageHref(CROSS_LINK.oaId),
              },
              { id: "sku", label: "SKU", value: labProducts.bodySplashVerbena },
              { id: "pt", label: "Lote PT", value: CROSS_LINK.lotePt },
            ],
          },
          {
            id: "pedido-vinculado",
            title: "Pedido comercial",
            status: Status.PARCIAL,
            items: [
              {
                id: "pedido",
                label: "Pedido",
                value: CROSS_LINK.pedidoId,
                href: pedidoPageHref(CROSS_LINK.pedidoId),
              },
              { id: "cliente", label: "Cliente", value: "TYL" },
            ],
          },
        ],
      },
    },
  ],
  activityLog: [
    {
      id: "a1",
      timestamp: "Hoy 11:42",
      user: labPeople.cristian,
      action: "Registró control en proceso",
      description: "Temperatura mezclado 57 °C — dentro de especificación.",
    },
    {
      id: "a2",
      timestamp: "Hoy 10:22",
      user: labPeople.natalia,
      action: "Registró control en proceso",
      description: "pH intermedio 5.4 — dentro de especificación.",
    },
    {
      id: "a3",
      timestamp: "Hoy 09:05",
      user: labPeople.cristian,
      action: "Consumo de MP registrado",
      description: "Vitamina E — lote MP-2026-0331 — desvío leve +5 % reportado.",
    },
    {
      id: "a4",
      timestamp: "30/06 08:15",
      user: labPeople.cristian,
      action: "Inició elaboración",
      description: "OE asignada a tanque T-02 · sector Elaboración.",
    },
    {
      id: "a5",
      timestamp: "29/06 16:30",
      user: labPeople.santiago,
      action: "Planificó orden",
      description: "Batch 480 kg programado para 30/06.",
    },
  ],
  relatedObjects: [
    {
      id: "rel-lote",
      kind: EntityPageKinds.LOTE,
      entityId: CROSS_LINK.loteGranel,
      title: labProducts.granelBodySplash,
      status: Status.CUARENTENA,
      subtitle: "Lote granel",
    },
    {
      id: "rel-oa",
      kind: EntityPageKinds.OA,
      entityId: CROSS_LINK.oaId,
      title: labProducts.bodySplashVerbena,
      status: Status.EN_CURSO,
      subtitle: "Orden de acondicionamiento",
    },
    {
      id: "rel-pedido",
      kind: EntityPageKinds.PEDIDO,
      entityId: CROSS_LINK.pedidoId,
      title: "TYL",
      status: Status.PARCIAL,
      subtitle: "Pedido comercial",
    },
  ],
};

const OE_REGISTRY: Record<string, EntityPageModel> = {
  [CROSS_LINK.oeId]: OE_0142,
};

export function getOeEntityPage(id: string): EntityPageModel | undefined {
  return OE_REGISTRY[id];
}

export { OE_0142 };
