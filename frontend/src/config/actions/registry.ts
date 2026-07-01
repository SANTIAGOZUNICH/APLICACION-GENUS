import { Status } from "@/types/ui/status";
import { EntityPageKinds } from "@/types/entity-page";
import {
  ActionIds,
  RoleIds,
  type ActionDefinition,
} from "@/types/actions";

const oeRegistrarConsumo: ActionDefinition = {
  id: ActionIds.OE_REGISTRAR_CONSUMO,
  label: "Registrar consumo",
  description: "Registrá la materia prima consumida en este batch.",
  risk: "medium",
  entityKinds: [EntityPageKinds.OE],
  allowedStatuses: [Status.EN_CURSO],
  allowedRoles: [RoleIds.OP, RoleIds.SU],
  effectSummary: "Se agrega un consumo al batch y se actualiza el avance.",
  riskDescription: "Verificá lote y cantidad antes de confirmar.",
  flow: {
    steps: [
      {
        type: "form",
        id: "consumo",
        title: "Consumo de materia prima",
        description: "Ingresá el lote y la cantidad real consumida.",
        fields: [
          {
            id: "mp",
            label: "Materia prima",
            type: "select",
            required: true,
            options: [
              { value: "vitamina-e", label: "Vitamina E" },
              { value: "extracto-verbena", label: "Extracto de verbena" },
              { value: "conservante-k", label: "Conservante K" },
            ],
          },
          {
            id: "loteMp",
            label: "Lote MP",
            type: "text",
            required: true,
            placeholder: "Ej. MP-2026-0331",
          },
          {
            id: "cantidad",
            label: "Cantidad real",
            type: "text",
            required: true,
            placeholder: "Ej. 2.4 kg",
          },
        ],
      },
      { type: "review", id: "review", title: "Revisá antes de registrar" },
    ],
  },
};

const oeRegistrarControl: ActionDefinition = {
  id: ActionIds.OE_REGISTRAR_CONTROL,
  label: "Registrar control",
  description: "Registrá el resultado de un control en proceso.",
  risk: "low",
  entityKinds: [EntityPageKinds.OE],
  allowedStatuses: [Status.EN_CURSO],
  allowedRoles: [RoleIds.OP, RoleIds.SU],
  effectSummary: "Se actualiza el control en proceso del batch.",
  riskDescription: "El valor debe estar dentro de especificación.",
  flow: {
    steps: [
      {
        type: "form",
        id: "control",
        title: "Control en proceso",
        fields: [
          {
            id: "punto",
            label: "Punto de control",
            type: "select",
            required: true,
            options: [
              { value: "temp", label: "Temperatura mezclado" },
              { value: "ph", label: "pH intermedio" },
              { value: "aspecto", label: "Homogeneidad visual" },
            ],
          },
          {
            id: "valor",
            label: "Valor medido",
            type: "text",
            required: true,
            placeholder: "Ej. 57 °C o 5.4",
          },
          {
            id: "observacion",
            label: "Observación",
            type: "textarea",
            placeholder: "Opcional",
          },
        ],
      },
      { type: "review", id: "review", title: "Revisá el control" },
    ],
  },
};

const oeCerrar: ActionDefinition = {
  id: ActionIds.OE_CERRAR,
  label: "Cerrar OE",
  description: "Finalizá la orden de elaboración. No podrás modificarla.",
  risk: "irreversible",
  entityKinds: [EntityPageKinds.OE],
  allowedStatuses: [Status.EN_CURSO],
  allowedRoles: [RoleIds.SU],
  effectSummary: "La OE pasa a Cerrada y el lote granel queda en cuarentena para Calidad.",
  riskDescription: "Esta acción es irreversible. Verificá que el batch esté completo.",
  flow: {
    steps: [
      {
        type: "review",
        id: "review",
        title: "Revisá el cierre",
        description: "Confirmá que todos los consumos y controles están registrados.",
      },
      {
        type: "confirm",
        id: "confirm",
        title: "Cerrar orden de elaboración",
        description:
          "Vas a cerrar esta OE. No podrás modificarla. El lote pasará a cuarentena para análisis de Calidad.",
        confirmLabel: "Cerrar OE",
        variant: "destructive",
      },
    ],
  },
};

const oaRegistrarConsumo: ActionDefinition = {
  id: ActionIds.OA_REGISTRAR_CONSUMO,
  label: "Registrar consumo",
  description: "Registrá materiales de envasado consumidos.",
  risk: "medium",
  entityKinds: [EntityPageKinds.OA],
  allowedStatuses: [Status.EN_CURSO],
  allowedRoles: [RoleIds.OP, RoleIds.SU],
  effectSummary: "Se agrega un consumo de envasado a la OA.",
  riskDescription: "Cada material debe registrarse por lote.",
  flow: {
    steps: [
      {
        type: "form",
        id: "consumo",
        title: "Consumo de envasado",
        fields: [
          {
            id: "material",
            label: "Material",
            type: "select",
            required: true,
            options: [
              { value: "frasco", label: "Frasco 250 ml" },
              { value: "tapa", label: "Tapa spray" },
              { value: "granel", label: "Granel origen" },
            ],
          },
          {
            id: "lote",
            label: "Lote",
            type: "text",
            required: true,
            placeholder: "Ej. EM-2026-0440",
          },
          {
            id: "cantidad",
            label: "Cantidad",
            type: "text",
            required: true,
            placeholder: "Ej. 7.488 u",
          },
        ],
      },
      { type: "review", id: "review", title: "Revisá el consumo" },
    ],
  },
};

const oaCerrar: ActionDefinition = {
  id: ActionIds.OA_CERRAR,
  label: "Cerrar OA",
  description: "Finalizá la orden de acondicionamiento.",
  risk: "irreversible",
  entityKinds: [EntityPageKinds.OA],
  allowedStatuses: [Status.EN_CURSO],
  allowedRoles: [RoleIds.SU],
  effectSummary: "La OA pasa a Cerrada y el lote PT queda en cuarentena.",
  riskDescription: "Esta acción es irreversible.",
  flow: {
    steps: [
      { type: "review", id: "review", title: "Revisá el cierre de acondicionamiento" },
      {
        type: "confirm",
        id: "confirm",
        title: "Cerrar orden de acondicionamiento",
        description:
          "Vas a cerrar esta OA. El producto terminado pasará a cuarentena para Calidad.",
        confirmLabel: "Cerrar OA",
        variant: "destructive",
      },
    ],
  },
};

const loteCargarAnalisis: ActionDefinition = {
  id: ActionIds.LOTE_CARGAR_ANALISIS,
  label: "Cargar análisis",
  description: "Registrá el resultado de un ensayo de calidad.",
  risk: "medium",
  entityKinds: [EntityPageKinds.LOTE],
  allowedStatuses: [Status.CUARENTENA, Status.EN_CURSO],
  allowedRoles: [RoleIds.CA],
  effectSummary: "Se agrega evidencia de análisis al lote.",
  riskDescription: "Los resultados deben ser conformes a especificación.",
  flow: {
    steps: [
      {
        type: "form",
        id: "analisis",
        title: "Resultado de análisis",
        fields: [
          {
            id: "ensayo",
            label: "Tipo de ensayo",
            type: "select",
            required: true,
            options: [
              { value: "micro", label: "Microbiológico" },
              { value: "fq", label: "Físico-químico" },
              { value: "aspecto", label: "Aspecto organoléptico" },
            ],
          },
          {
            id: "resultado",
            label: "Resultado",
            type: "select",
            required: true,
            options: [
              { value: "conforme", label: "Conforme" },
              { value: "no-conforme", label: "No conforme" },
            ],
          },
          {
            id: "detalle",
            label: "Detalle",
            type: "textarea",
            placeholder: "Ej. pH 5.4 — spec 5.0–5.8",
          },
        ],
      },
      { type: "review", id: "review", title: "Revisá el análisis" },
    ],
  },
};

const liberacionPrepararDisposicion: ActionDefinition = {
  id: ActionIds.LIBERACION_PREPARAR_DISPOSICION,
  label: "Preparar disposición",
  description: "Prepará el borrador de disposición para Dirección Técnica.",
  risk: "medium",
  entityKinds: [EntityPageKinds.LIBERACION],
  allowedStatuses: [Status.BORRADOR_EN_REVISION, Status.CUARENTENA],
  allowedRoles: [RoleIds.CA],
  effectSummary: "La liberación queda lista para firma de DT.",
  riskDescription: "Verificá que toda la evidencia esté completa.",
  flow: {
    steps: [
      {
        type: "form",
        id: "disposicion",
        title: "Disposición propuesta",
        fields: [
          {
            id: "decision",
            label: "Disposición propuesta",
            type: "select",
            required: true,
            options: [
              { value: "liberado", label: "Liberado" },
              { value: "condicional", label: "Condicional" },
              { value: "rechazado", label: "Rechazado" },
            ],
          },
          {
            id: "evidencia",
            label: "Resumen de evidencia",
            type: "textarea",
            required: true,
          },
        ],
      },
      { type: "review", id: "review", title: "Revisá la disposición" },
    ],
  },
};

const liberacionFirmar: ActionDefinition = {
  id: ActionIds.LIBERACION_FIRMAR,
  label: "Firmar liberación",
  description: "Registrá la decisión firmada sobre el lote.",
  risk: "irreversible",
  entityKinds: [EntityPageKinds.LIBERACION],
  allowedStatuses: [Status.BORRADOR_EN_REVISION],
  allowedRoles: [RoleIds.DT],
  effectSummary: "El lote cambia de estado según la decisión firmada.",
  riskDescription: "Acto legal de Dirección Técnica. Irreversible.",
  flow: {
    steps: [
      {
        type: "form",
        id: "firma",
        title: "Decisión de liberación",
        fields: [
          {
            id: "decision",
            label: "Decisión",
            type: "select",
            required: true,
            options: [
              { value: "liberado", label: "Liberado" },
              { value: "rechazado", label: "Rechazado" },
              { value: "condicional", label: "Condicional" },
              { value: "bloqueado", label: "Bloqueado" },
            ],
          },
          {
            id: "observacion",
            label: "Observación",
            type: "textarea",
            placeholder: "Opcional",
          },
        ],
      },
      { type: "review", id: "review", title: "Revisá antes de firmar" },
      {
        type: "confirm",
        id: "confirm",
        title: "Firmar liberación",
        description:
          "Vas a registrar la decisión firmada. Esta acción es irreversible y tiene validez GMP.",
        confirmLabel: "Firmar",
        variant: "destructive",
      },
    ],
  },
};

const pedidoDespachar: ActionDefinition = {
  id: ActionIds.PEDIDO_DESPACHAR,
  label: "Despachar",
  description: "Registrá el despacho de producto terminado contra el pedido.",
  risk: "medium",
  entityKinds: [EntityPageKinds.PEDIDO],
  allowedStatuses: [Status.PARCIAL, Status.PENDIENTE],
  allowedRoles: [RoleIds.OP, RoleIds.SU],
  effectSummary: "Se registra el movimiento de despacho y avanza el renglón.",
  riskDescription: "Solo PT liberado. Cantidad ≤ saldo del lote.",
  flow: {
    steps: [
      {
        type: "form",
        id: "despacho",
        title: "Datos del despacho",
        fields: [
          {
            id: "renglon",
            label: "Renglón",
            type: "select",
            required: true,
            options: [
              { value: "r4", label: "Gel Limpiador — 2.400 u pendientes" },
              { value: "r5", label: "Serum Antioxidante — 1.200 u pendientes" },
            ],
          },
          {
            id: "lotePt",
            label: "Lote PT",
            type: "text",
            required: true,
            placeholder: "Ej. PT-2026-4421",
          },
          {
            id: "cantidad",
            label: "Cantidad a despachar",
            type: "text",
            required: true,
            placeholder: "Ej. 2.400 u",
          },
        ],
      },
      { type: "review", id: "review", title: "Revisá el despacho" },
    ],
  },
};

export const ACTION_REGISTRY: Record<
  import("@/types/actions").ActionId,
  ActionDefinition
> = {
  [ActionIds.OE_REGISTRAR_CONSUMO]: oeRegistrarConsumo,
  [ActionIds.OE_REGISTRAR_CONTROL]: oeRegistrarControl,
  [ActionIds.OE_CERRAR]: oeCerrar,
  [ActionIds.OA_REGISTRAR_CONSUMO]: oaRegistrarConsumo,
  [ActionIds.OA_CERRAR]: oaCerrar,
  [ActionIds.LOTE_CARGAR_ANALISIS]: loteCargarAnalisis,
  [ActionIds.LIBERACION_PREPARAR_DISPOSICION]: liberacionPrepararDisposicion,
  [ActionIds.LIBERACION_FIRMAR]: liberacionFirmar,
  [ActionIds.PEDIDO_DESPACHAR]: pedidoDespachar,
};

export const ALL_ACTION_DEFINITIONS = Object.values(ACTION_REGISTRY);

export function getActionDefinition(
  actionId: import("@/types/actions").ActionId
): ActionDefinition | undefined {
  return ACTION_REGISTRY[actionId];
}
