import { Package } from "lucide-react";
import {
  lotePageHref,
  oePageHref,
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

const OA_0089: EntityPageModel = {
  kind: EntityPageKinds.OA,
  entityId: CROSS_LINK.oaId,
  title: labProducts.bodySplashVerbena,
  subtitle: `${labSectors.envasadoMasivo} · 14.400 u`,
  status: Status.EN_CURSO,
  identityIcon: Package,
  statusFlow: PRODUCTION_ORDER_FLOW,
  currentStageId: "en-curso",
  primaryAction: { label: "Registrar avance", actionId: ActionIds.OA_REGISTRAR_CONSUMO },
  sections: [
    {
      id: "datos",
      title: "Datos de la orden",
      content: {
        type: "key-values",
        items: [
          { id: "sku", label: "SKU", value: labProducts.bodySplashVerbena },
          { id: "unidades", label: "Unidades", value: "14.400 u" },
          { id: "lote-pt", label: "Lote PT", value: CROSS_LINK.lotePt },
          {
            id: "lote-granel",
            label: "Lote granel origen",
            value: CROSS_LINK.loteGranel,
            href: lotePageHref(CROSS_LINK.loteGranel),
          },
          {
            id: "oe",
            label: "OE origen",
            value: CROSS_LINK.oeId,
            href: oePageHref(CROSS_LINK.oeId),
          },
          { id: "sector", label: "Sector", value: labSectors.envasadoMasivo },
          { id: "responsable", label: "Responsable", value: labPeople.joaquin },
          { id: "avance", label: "Avance", value: "52 %" },
        ],
      },
    },
    {
      id: "consumos",
      title: "Consumos de envasado",
      description: "Materiales de acondicionamiento consumidos.",
      content: {
        type: "audit-table",
        table: {
          id: "consumos-oa-0089",
          columns: [
            { id: "material", label: "Material" },
            { id: "lote", label: "Lote" },
            { id: "teorico", label: "Teórico" },
            { id: "real", label: "Real" },
          ],
          rows: [
            {
              id: "c1",
              cells: {
                material: "Frasco 250 ml",
                lote: "EM-2026-0440",
                teorico: "14.400 u",
                real: "7.488 u",
              },
            },
            {
              id: "c2",
              cells: {
                material: "Tapa spray",
                lote: "EM-2026-0441",
                teorico: "14.400 u",
                real: "7.488 u",
              },
            },
            {
              id: "c3",
              cells: {
                material: "Granel BS Verbena",
                lote: CROSS_LINK.loteGranel,
                teorico: "432 kg",
                real: "224 kg",
              },
            },
          ],
        },
      },
    },
  ],
  activityLog: [
    {
      id: "oa1",
      timestamp: "Hoy 08:00",
      user: labPeople.joaquin,
      action: "Registró avance de envasado",
      description: "52 % completado · línea L-03.",
    },
    {
      id: "oa2",
      timestamp: "29/06 14:00",
      user: labPeople.joaquin,
      action: "Inició acondicionamiento",
      description: "OA asignada a Envasado Masivo.",
    },
  ],
  relatedObjects: [
    {
      id: "rel-oe",
      kind: EntityPageKinds.OE,
      entityId: CROSS_LINK.oeId,
      title: labProducts.granelBodySplash,
      status: Status.EN_CURSO,
    },
    {
      id: "rel-lote",
      kind: EntityPageKinds.LOTE,
      entityId: CROSS_LINK.loteGranel,
      title: labProducts.granelBodySplash,
      status: Status.CUARENTENA,
    },
  ],
};

const OA_REGISTRY: Record<string, EntityPageModel> = {
  [CROSS_LINK.oaId]: OA_0089,
};

export function getOaEntityPage(id: string): EntityPageModel | undefined {
  return OA_REGISTRY[id];
}

export { OA_0089 };
