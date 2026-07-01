import { Truck } from "lucide-react";
import {
  oaPageHref,
  PEDIDO_FLOW,
} from "@/config/entity-pages";
import { ActionIds } from "@/types/actions";
import {
  labClients,
  labPeople,
  labProducts,
} from "@/mocks/workspace/lab-context";
import { CROSS_LINK } from "@/mocks/entity-pages/cross-link";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";

const PEDIDO_1205: EntityPageModel = {
  kind: EntityPageKinds.PEDIDO,
  entityId: CROSS_LINK.pedidoId,
  title: labClients.tyl,
  subtitle: "Compromiso 05/07/2026",
  status: Status.PARCIAL,
  identityIcon: Truck,
  statusFlow: PEDIDO_FLOW,
  currentStageId: "parcial",
  primaryAction: { label: "Seguir despacho", actionId: ActionIds.PEDIDO_DESPACHAR },
  sections: [
    {
      id: "datos",
      title: "Datos del pedido",
      content: {
        type: "key-values",
        items: [
          { id: "cliente", label: "Cliente", value: labClients.tyl },
          { id: "compromiso", label: "Compromiso", value: "05/07/2026" },
          { id: "avance", label: "Avance despacho", value: "3/5 renglones" },
          { id: "comercial", label: "Ejecutivo", value: labPeople.alberto },
          { id: "prioridad", label: "Prioridad", value: "Alta" },
        ],
      },
    },
    {
      id: "renglones",
      title: "Renglones",
      description: "Detalle de ítems del pedido — tabla de auditoría.",
      content: {
        type: "audit-table",
        table: {
          id: "renglones-ped-1205",
          columns: [
            { id: "producto", label: "Producto" },
            { id: "cantidad", label: "Cantidad" },
            { id: "despachado", label: "Despachado" },
            { id: "estado", label: "Estado" },
            { id: "oa", label: "OA" },
          ],
          rows: [
            {
              id: "r1",
              cells: {
                producto: labProducts.bodySplashVerbena,
                cantidad: "6.000 u",
                despachado: "6.000 u",
                estado: "Completo",
                oa: CROSS_LINK.oaId,
              },
            },
            {
              id: "r2",
              cells: {
                producto: labProducts.cremaHidratante,
                cantidad: "4.800 u",
                despachado: "4.800 u",
                estado: "Completo",
                oa: "OA-2026-0085",
              },
            },
            {
              id: "r3",
              cells: {
                producto: labProducts.shampooNutritivo,
                cantidad: "3.600 u",
                despachado: "3.600 u",
                estado: "Completo",
                oa: "—",
              },
            },
            {
              id: "r4",
              cells: {
                producto: labProducts.gelLimpiador,
                cantidad: "2.400 u",
                despachado: "0 u",
                estado: "Pendiente",
                oa: "—",
              },
            },
            {
              id: "r5",
              cells: {
                producto: labProducts.serumAntioxidante,
                cantidad: "1.200 u",
                despachado: "0 u",
                estado: "Pendiente",
                oa: "—",
              },
            },
          ],
        },
      },
    },
    {
      id: "produccion",
      title: "Producción vinculada",
      content: {
        type: "cards",
        cards: [
          {
            id: "oa-principal",
            title: "OA en curso",
            status: Status.EN_CURSO,
            items: [
              {
                id: "oa",
                label: "OA",
                value: CROSS_LINK.oaId,
                href: oaPageHref(CROSS_LINK.oaId),
              },
              { id: "producto", label: "Producto", value: labProducts.bodySplashVerbena },
              { id: "avance", label: "Avance OA", value: "52 %" },
            ],
          },
        ],
      },
    },
  ],
  activityLog: [
    {
      id: "p1",
      timestamp: "Hoy 07:15",
      user: labPeople.alberto,
      action: "Actualizó compromiso",
      description: "Cliente confirmó recepción parcial · 3/5 renglones.",
    },
    {
      id: "p2",
      timestamp: "28/06 11:00",
      user: labPeople.francisco,
      action: "Despachó renglón",
      description: "Shampoo Nutritivo · 3.600 u · remito R-2026-0892.",
    },
  ],
  relatedObjects: [
    {
      id: "rel-oa",
      kind: EntityPageKinds.OA,
      entityId: CROSS_LINK.oaId,
      title: labProducts.bodySplashVerbena,
      status: Status.EN_CURSO,
    },
    {
      id: "rel-oe",
      kind: EntityPageKinds.OE,
      entityId: CROSS_LINK.oeId,
      title: labProducts.granelBodySplash,
      status: Status.EN_CURSO,
    },
  ],
};

const PEDIDO_REGISTRY: Record<string, EntityPageModel> = {
  [CROSS_LINK.pedidoId]: PEDIDO_1205,
};

export function getPedidoEntityPage(id: string): EntityPageModel | undefined {
  return PEDIDO_REGISTRY[id];
}

export { PEDIDO_1205 };
