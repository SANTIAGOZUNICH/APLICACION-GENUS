import { Status } from "@/types/ui/status";
import { entityPageKey } from "@/types/actions";
import { EntityPageKinds } from "@/types/entity-page";
import { CROSS_LINK } from "@/mocks/entity-pages/cross-link";
import {
  appendActivity,
  bumpDayPulse,
  cloneState,
  getFormData,
  nowLabel,
  success,
  type PureHandler,
} from "./helpers";

export const handleOaRegistrarConsumo: PureHandler = (state, context, flowData) => {
  const key = entityPageKey(EntityPageKinds.OA, context.entityId);
  const model = state.entityPages[key];
  if (!model) {
    return {
      result: {
        ok: false,
        code: "handler",
        feedback: { tone: "problem", title: "OA no encontrada" },
      },
    };
  }

  const data = getFormData(flowData, "consumo");
  const updatedSections = model.sections.map((section) => {
    if (section.id !== "consumos" || section.content.type !== "audit-table") {
      return section;
    }
    return {
      ...section,
      content: {
        ...section.content,
        table: {
          ...section.content.table,
          rows: [
            ...section.content.table.rows,
            {
              id: `c-${Date.now()}`,
              cells: {
                material: data.material ?? "—",
                lote: data.lote ?? "—",
                teorico: "—",
                real: data.cantidad ?? "—",
              },
            },
          ],
        },
      },
    };
  });

  const updated = appendActivity(
    { ...model, status: Status.EN_CURSO, sections: updatedSections },
    {
      timestamp: nowLabel(),
      user: context.userName,
      action: "Consumo de envasado registrado",
      description: `${data.material} — ${data.cantidad}`,
    }
  );

  const next = cloneState(state);
  next.entityPages[key] = updated;

  return success(next, {
    tone: "ok",
    title: "Consumo registrado",
    description: "El material de envasado se agregó a la OA.",
  });
};

export const handleOaCerrar: PureHandler = (state, context, flowData) => {
  void flowData;
  const key = entityPageKey(EntityPageKinds.OA, context.entityId);
  const model = state.entityPages[key];
  if (!model) {
    return {
      result: {
        ok: false,
        code: "handler",
        feedback: { tone: "problem", title: "OA no encontrada" },
      },
    };
  }

  let next = cloneState(state);
  next.entityPages[key] = appendActivity(
    {
      ...model,
      status: Status.CERRADA,
      currentStageId: "cerrada",
      primaryAction: undefined,
    },
    {
      timestamp: nowLabel(),
      user: context.userName,
      action: "Cerró orden de acondicionamiento",
      description: "PT en cuarentena para análisis de Calidad.",
    }
  );

  next.workspaceTasks.produccion = next.workspaceTasks.produccion.map((task) => {
    if (
      task.payload.entityType === "oa" &&
      task.payload.data.oaId === context.entityId
    ) {
      return {
        ...task,
        sectionId: "finalizados",
        payload: {
          ...task.payload,
          data: {
            ...task.payload.data,
            status: Status.CERRADA,
            progressPercent: 100,
            primaryAction: undefined,
          },
        },
      };
    }
    return task;
  });

  next = bumpDayPulse(next);

  return success(
    next,
    {
      tone: "ok",
      title: "OA cerrada",
      description: `${context.entityId} quedó cerrada.`,
    },
    `El lote ${CROSS_LINK.lotePt} pasó a cuarentena para Calidad.`
  );
};
