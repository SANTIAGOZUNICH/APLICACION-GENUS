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

export const handleOeRegistrarConsumo: PureHandler = (state, context, flowData) => {
  const key = entityPageKey(EntityPageKinds.OE, context.entityId);
  const model = state.entityPages[key];
  if (!model) {
    return {
      result: {
        ok: false,
        code: "handler",
        feedback: { tone: "problem", title: "OE no encontrada" },
      },
    };
  }

  const data = getFormData(flowData, "consumo");
  let next = cloneState(state);
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
                mp: data.mp ?? "—",
                lote: data.loteMp ?? "—",
                teorico: "—",
                real: data.cantidad ?? "—",
                desvio: "—",
              },
            },
          ],
        },
      },
    };
  });

  const updated = appendActivity(
    {
      ...model,
      status: Status.EN_CURSO,
      sections: updatedSections,
    },
    {
      timestamp: nowLabel(),
      user: context.userName,
      action: "Consumo de MP registrado",
      description: `${data.mp} — lote ${data.loteMp} — ${data.cantidad}`,
    }
  );

  next.entityPages[key] = updated;
  next = bumpDayPulse(next);

  return success(next, {
    tone: "ok",
    title: "Consumo registrado",
    description: "El consumo se agregó al batch.",
  });
};

export const handleOeRegistrarControl: PureHandler = (state, context, flowData) => {
  const key = entityPageKey(EntityPageKinds.OE, context.entityId);
  const model = state.entityPages[key];
  if (!model) {
    return {
      result: {
        ok: false,
        code: "handler",
        feedback: { tone: "problem", title: "OE no encontrada" },
      },
    };
  }

  const data = getFormData(flowData, "control");
  const updatedSections = model.sections.map((section) => {
    if (section.id !== "controles" || section.content.type !== "cards") {
      return section;
    }
    return {
      ...section,
      content: {
        ...section.content,
        cards: section.content.cards.map((card) =>
          card.id === `cp-${data.punto === "temp" ? "temp" : data.punto === "ph" ? "ph" : "homog"}`
            ? {
                ...card,
                status: Status.EN_TOLERANCIA,
                items: [
                  ...card.items.filter((i) => i.id !== "valor" && i.id !== "hora"),
                  { id: "valor", label: "Último valor", value: data.valor ?? "—" },
                  { id: "hora", label: "Registrado", value: nowLabel() },
                ],
              }
            : card
        ),
      },
    };
  });

  const updated = appendActivity(
    { ...model, sections: updatedSections },
    {
      timestamp: nowLabel(),
      user: context.userName,
      action: "Registró control en proceso",
      description: `${data.punto}: ${data.valor}${data.observacion ? ` — ${data.observacion}` : ""}`,
    }
  );

  const next = cloneState(state);
  next.entityPages[key] = updated;

  return success(next, {
    tone: "ok",
    title: "Control registrado",
    description: "El punto de control se actualizó.",
  });
};

export const handleOeCerrar: PureHandler = (state, context, flowData) => {
  void flowData;
  const key = entityPageKey(EntityPageKinds.OE, context.entityId);
  const model = state.entityPages[key];
  if (!model) {
    return {
      result: {
        ok: false,
        code: "handler",
        feedback: { tone: "problem", title: "OE no encontrada" },
      },
    };
  }

  let next = cloneState(state);
  const updated = appendActivity(
    {
      ...model,
      status: Status.CERRADA,
      currentStageId: "cerrada",
      primaryAction: undefined,
    },
    {
      timestamp: nowLabel(),
      user: context.userName,
      action: "Cerró orden de elaboración",
      description: "Batch completo · lote en cuarentena para Calidad.",
    }
  );
  next.entityPages[key] = updated;

  next.bandejaTasks = next.bandejaTasks.map((task) => {
    if (
      task.payload.entityType === "oe" &&
      task.payload.data.oeId === context.entityId
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

  next.workspaceTasks.produccion = next.workspaceTasks.produccion.map((task) => {
    if (
      task.payload.entityType === "oe" &&
      task.payload.data.oeId === context.entityId
    ) {
      return {
        ...task,
        sectionId: "finalizados",
        urgencyScore: 100,
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

  const loteKey = entityPageKey(EntityPageKinds.LOTE, CROSS_LINK.loteGranel);
  const lote = next.entityPages[loteKey];
  if (lote) {
    next.entityPages[loteKey] = appendActivity(lote, {
      timestamp: nowLabel(),
      user: "Sistema",
      action: "OE cerrada — lote en cuarentena",
      description: `Origen ${context.entityId} cerrada.`,
    });
  }

  next = bumpDayPulse(next);

  return success(
    next,
    {
      tone: "ok",
      title: "OE cerrada",
      description: `${context.entityId} quedó cerrada e inmutable.`,
    },
    "El lote pasó a Calidad para analizar."
  );
};
