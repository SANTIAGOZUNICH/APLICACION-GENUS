import { ScanBarcode } from "lucide-react";
import {
  liberacionPageHref,
  LOTE_FLOW,
  oePageHref,
  oaPageHref,
} from "@/config/entity-pages";
import {
  labPeople,
  labProducts,
  labSectors,
  noop,
} from "@/mocks/workspace/lab-context";
import { CROSS_LINK } from "@/mocks/entity-pages/cross-link";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";

const LOTE_0842: EntityPageModel = {
  kind: EntityPageKinds.LOTE,
  entityId: CROSS_LINK.loteGranel,
  title: labProducts.granelBodySplash,
  subtitle: "Granel · Elaboración",
  status: Status.CUARENTENA,
  identityIcon: ScanBarcode,
  statusFlow: LOTE_FLOW,
  currentStageId: "cuarentena",
  primaryAction: { label: "Cargar análisis", onClick: noop },
  secondaryActions: [
    { label: "Ver OE origen", variant: "secondary", href: oePageHref(CROSS_LINK.oeId) },
  ],
  sections: [
    {
      id: "datos",
      title: "Datos del lote",
      description: "Identificación y estado de inventario.",
      content: {
        type: "key-values",
        items: [
          { id: "tipo", label: "Tipo", value: "Granel" },
          { id: "producto", label: "Producto", value: labProducts.granelBodySplash },
          { id: "saldo", label: "Saldo", value: "480 kg" },
          { id: "ubicacion", label: "Ubicación", value: "Cuarentena · CQ-03" },
          { id: "vencimiento", label: "Vencimiento", value: "14/08/2027" },
          {
            id: "oe",
            label: "OE origen",
            value: CROSS_LINK.oeId,
            href: oePageHref(CROSS_LINK.oeId),
          },
          { id: "elaborado", label: "Elaborado", value: "30/06/2026" },
          { id: "responsable", label: "Responsable CQ", value: labPeople.gabriel },
        ],
      },
    },
    {
      id: "analisis",
      title: "Análisis y controles",
      description: "Resultados de calidad — representados como cards.",
      content: {
        type: "cards",
        cards: [
          {
            id: "micro",
            title: "Análisis microbiológico",
            status: Status.PENDIENTE,
            description: "Muestra enviada · resultado esperado 02/07",
            items: [
              { id: "muestra", label: "Muestra", value: "M-LG-0842-A" },
              { id: "lab", label: "Laboratorio", value: "Interno" },
            ],
          },
          {
            id: "fisico",
            title: "Control físico-químico",
            status: Status.EN_CURSO,
            items: [
              { id: "ph", label: "pH", value: "5.4 (spec 5.0–5.8)" },
              { id: "visc", label: "Viscosidad", value: "Pendiente" },
              { id: "aspecto", label: "Aspecto", value: "Conforme" },
            ],
          },
          {
            id: "disposicion",
            title: "Disposición",
            status: Status.CUARENTENA,
            description: "Pendiente completar análisis",
            items: [
              {
                id: "lib",
                label: "Liberación",
                value: CROSS_LINK.liberacionId,
                href: liberacionPageHref(CROSS_LINK.liberacionId),
              },
            ],
          },
        ],
      },
    },
    {
      id: "movimientos",
      title: "Movimientos",
      description: "Auditoría de movimientos de stock del lote.",
      content: {
        type: "audit-table",
        table: {
          id: "mov-lote-0842",
          columns: [
            { id: "fecha", label: "Fecha" },
            { id: "tipo", label: "Tipo" },
            { id: "cantidad", label: "Cantidad" },
            { id: "ubicacion", label: "Ubicación" },
            { id: "usuario", label: "Usuario" },
          ],
          rows: [
            {
              id: "m1",
              cells: {
                fecha: "30/06 14:30",
                tipo: "Producción",
                cantidad: "+480 kg",
                ubicacion: "Elaboración → Cuarentena",
                usuario: labPeople.cristian,
              },
            },
            {
              id: "m2",
              cells: {
                fecha: "30/06 14:45",
                tipo: "Transferencia",
                cantidad: "480 kg",
                ubicacion: "CQ-03",
                usuario: labPeople.joaquin,
              },
            },
            {
              id: "m3",
              cells: {
                fecha: "30/06 15:00",
                tipo: "Muestreo",
                cantidad: "−0.5 kg",
                ubicacion: "Laboratorio",
                usuario: labPeople.gabriel,
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
            id: "downstream-oa",
            title: "Destino acondicionamiento",
            status: Status.PLANIFICADA,
            items: [
              {
                id: "oa",
                label: "OA",
                value: CROSS_LINK.oaId,
                href: oaPageHref(CROSS_LINK.oaId),
              },
              { id: "sku", label: "SKU PT", value: labProducts.bodySplashVerbena },
              { id: "sector", label: "Sector destino", value: labSectors.envasadoMasivo },
            ],
          },
        ],
      },
    },
  ],
  activityLog: [
    {
      id: "l1",
      timestamp: "Hoy 09:30",
      user: labPeople.gabriel,
      action: "Recibió muestra",
      description: "Muestra M-LG-0842-A ingresada a laboratorio interno.",
    },
    {
      id: "l2",
      timestamp: "30/06 15:00",
      user: labPeople.gabriel,
      action: "Registró muestreo",
      description: "0.5 kg retirados para análisis físico-químico.",
    },
    {
      id: "l3",
      timestamp: "30/06 14:45",
      user: labPeople.joaquin,
      action: "Transferió a cuarentena",
      description: "Lote ubicado en CQ-03 · estado Cuarentena.",
    },
    {
      id: "l4",
      timestamp: "30/06 14:30",
      user: labPeople.cristian,
      action: "Cerró producción de batch",
      description: "480 kg transferidos desde Elaboración.",
    },
  ],
  relatedObjects: [
    {
      id: "rel-oe",
      kind: EntityPageKinds.OE,
      entityId: CROSS_LINK.oeId,
      title: labProducts.granelBodySplash,
      status: Status.EN_CURSO,
      subtitle: "Orden de elaboración",
    },
    {
      id: "rel-oa",
      kind: EntityPageKinds.OA,
      entityId: CROSS_LINK.oaId,
      title: labProducts.bodySplashVerbena,
      status: Status.EN_CURSO,
      subtitle: "Acondicionamiento planificado",
    },
    {
      id: "rel-lib",
      kind: EntityPageKinds.LIBERACION,
      entityId: CROSS_LINK.liberacionId,
      title: `Liberación ${CROSS_LINK.loteGranel}`,
      status: Status.BORRADOR_EN_REVISION,
      subtitle: "Disposición de calidad",
    },
  ],
};

const LOTE_REGISTRY: Record<string, EntityPageModel> = {
  [CROSS_LINK.loteGranel]: LOTE_0842,
};

export function getLoteEntityPage(id: string): EntityPageModel | undefined {
  return LOTE_REGISTRY[id];
}

export { LOTE_0842 };
