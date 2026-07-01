import { ShieldCheck } from "lucide-react";
import {
  LIBERACION_FLOW,
  lotePageHref,
  oePageHref,
} from "@/config/entity-pages";
import {
  labPeople,
  labProducts,
  noop,
} from "@/mocks/workspace/lab-context";
import { CROSS_LINK } from "@/mocks/entity-pages/cross-link";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";

const LIB_0042: EntityPageModel = {
  kind: EntityPageKinds.LIBERACION,
  entityId: CROSS_LINK.liberacionId,
  title: `Liberación ${CROSS_LINK.loteGranel}`,
  subtitle: labProducts.granelBodySplash,
  status: Status.BORRADOR_EN_REVISION,
  identityIcon: ShieldCheck,
  statusFlow: LIBERACION_FLOW,
  currentStageId: "borrador",
  primaryAction: { label: "Revisar disposición", onClick: noop },
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
            value: CROSS_LINK.loteGranel,
            href: lotePageHref(CROSS_LINK.loteGranel),
          },
          {
            id: "oe",
            label: "OE referencia",
            value: CROSS_LINK.oeId,
            href: oePageHref(CROSS_LINK.oeId),
          },
          { id: "producto", label: "Producto", value: labProducts.granelBodySplash },
          { id: "dias-cq", label: "Días en cuarentena", value: "6 días" },
          { id: "analista", label: "Analista", value: labPeople.gabriel },
          { id: "evidencia", label: "Evidencia", value: "Análisis microbiológico OK · pH en spec" },
        ],
      },
    },
    {
      id: "evidencias",
      title: "Evidencias de calidad",
      content: {
        type: "cards",
        cards: [
          {
            id: "ev-micro",
            title: "Microbiológico",
            status: Status.LIBERADO,
            items: [
              { id: "resultado", label: "Resultado", value: "Conforme" },
              { id: "fecha", label: "Fecha", value: "01/07/2026" },
            ],
          },
          {
            id: "ev-fq",
            title: "Físico-químico",
            status: Status.EN_TOLERANCIA,
            items: [
              { id: "ph", label: "pH", value: "5.4" },
              { id: "aspecto", label: "Aspecto", value: "Conforme" },
            ],
          },
        ],
      },
    },
  ],
  activityLog: [
    {
      id: "lib1",
      timestamp: "Hoy 10:00",
      user: labPeople.gabriel,
      action: "Preparó borrador de disposición",
      description: "Evidencias completas · pendiente revisión DT.",
    },
    {
      id: "lib2",
      timestamp: "01/07 16:20",
      user: labPeople.gabriel,
      action: "Cargó resultado microbiológico",
      description: "Análisis conforme · lote apto para disposición.",
    },
  ],
  relatedObjects: [
    {
      id: "rel-lote",
      kind: EntityPageKinds.LOTE,
      entityId: CROSS_LINK.loteGranel,
      title: labProducts.granelBodySplash,
      status: Status.CUARENTENA,
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

const LIBERACION_REGISTRY: Record<string, EntityPageModel> = {
  [CROSS_LINK.liberacionId]: LIB_0042,
  [CROSS_LINK.loteGranel]: LIB_0042,
};

export function getLiberacionEntityPage(id: string): EntityPageModel | undefined {
  return LIBERACION_REGISTRY[id];
}

export { LIB_0042 };
