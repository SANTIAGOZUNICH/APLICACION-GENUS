import { Status } from "@/types/ui/status";
import { ActionIds, entityPageKey } from "@/types/actions";
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

export const handleLoteCargarAnalisis: PureHandler = (state, context, flowData) => {
  const key = entityPageKey(EntityPageKinds.LOTE, context.entityId);
  const model = state.entityPages[key];
  if (!model) {
    return {
      result: {
        ok: false,
        code: "handler",
        feedback: { tone: "problem", title: "Lote no encontrado" },
      },
    };
  }

  const data = getFormData(flowData, "analisis");
  const conforme = data.resultado === "conforme";

  const updatedSections = model.sections.map((section) => {
    if (section.id !== "analisis" || section.content.type !== "cards") {
      return section;
    }
    const cardId =
      data.ensayo === "micro" ? "micro" : data.ensayo === "fq" ? "fisico" : "disposicion";
    return {
      ...section,
      content: {
        ...section.content,
        cards: section.content.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                status: conforme ? Status.LIBERADO : Status.RECHAZADO,
                items: [
                  ...card.items,
                  {
                    id: "resultado",
                    label: "Resultado",
                    value: data.detalle ?? (conforme ? "Conforme" : "No conforme"),
                  },
                ],
              }
            : card
        ),
      },
    };
  });

  let next = cloneState(state);
  next.entityPages[key] = appendActivity(
    {
      ...model,
      currentStageId: "analisis",
      sections: updatedSections,
    },
    {
      timestamp: nowLabel(),
      user: context.userName,
      action: "Cargó análisis",
      description: `${data.ensayo}: ${data.resultado}${data.detalle ? ` — ${data.detalle}` : ""}`,
    }
  );

  const libKey = entityPageKey(EntityPageKinds.LIBERACION, CROSS_LINK.liberacionId);
  const lib = next.entityPages[libKey];
  if (lib && conforme) {
    next.entityPages[libKey] = appendActivity(
      {
        ...lib,
        status: Status.BORRADOR_EN_REVISION,
        currentStageId: "borrador",
      },
      {
        timestamp: nowLabel(),
        user: "Sistema",
        action: "Evidencia actualizada",
        description: "Análisis conforme — preparar disposición.",
      }
    );
  }

  next = bumpDayPulse(next);

  return success(
    next,
    {
      tone: conforme ? "ok" : "attention",
      title: "Análisis registrado",
      description: conforme
        ? "La evidencia se agregó al lote."
        : "Resultado no conforme — revisá con Calidad.",
    },
    conforme ? "Prepará la disposición para Dirección Técnica." : undefined
  );
};

export const handleLiberacionPrepararDisposicion: PureHandler = (
  state,
  context,
  flowData
) => {
  const key = entityPageKey(EntityPageKinds.LIBERACION, context.entityId);
  const model = state.entityPages[key];
  if (!model) {
    return {
      result: {
        ok: false,
        code: "handler",
        feedback: { tone: "problem", title: "Liberación no encontrada" },
      },
    };
  }

  const data = getFormData(flowData, "disposicion");
  let next = cloneState(state);

  next.entityPages[key] = appendActivity(
    {
      ...model,
      status: Status.BORRADOR_EN_REVISION,
      currentStageId: "esperando-firma",
      primaryAction: { label: "Firmar liberación", actionId: ActionIds.LIBERACION_FIRMAR },
    },
    {
      timestamp: nowLabel(),
      user: context.userName,
      action: "Preparó disposición",
      description: data.evidencia ?? "Evidencia completa.",
    },
  );

  next.workspaceTasks.dt = next.workspaceTasks.dt.map((task) =>
    task.payload.entityType === "liberacion" &&
    task.payload.data.loteNumber === CROSS_LINK.loteGranel
      ? { ...task, sectionId: "esperando-firma", urgencyScore: 900 }
      : task
  );

  next = bumpDayPulse(next);

  return success(
    next,
    {
      tone: "ok",
      title: "Disposición preparada",
      description: "Enviada a Dirección Técnica para firma.",
    },
    "Dirección Técnica recibirá la tarea de firma."
  );
};

export const handleLiberacionFirmar: PureHandler = (state, context, flowData) => {
  const key = entityPageKey(EntityPageKinds.LIBERACION, context.entityId);
  const model = state.entityPages[key];
  if (!model) {
    return {
      result: {
        ok: false,
        code: "handler",
        feedback: { tone: "problem", title: "Liberación no encontrada" },
      },
    };
  }

  const data = getFormData(flowData, "firma");
  const decision = data.decision ?? "liberado";
  const statusMap: Record<string, Status> = {
    liberado: Status.LIBERADO,
    rechazado: Status.RECHAZADO,
    condicional: Status.EN_TOLERANCIA,
    bloqueado: Status.BLOQUEADO,
  };
  const newStatus = statusMap[decision] ?? Status.LIBERADO;

  let next = cloneState(state);
  next.entityPages[key] = appendActivity(
    {
      ...model,
      status: newStatus,
      currentStageId: "firmada",
      primaryAction: undefined,
    },
    {
      timestamp: nowLabel(),
      user: context.userName,
      action: "Firmó liberación",
      description: `Decisión: ${decision}${data.observacion ? ` — ${data.observacion}` : ""}`,
    }
  );

  const loteKey = entityPageKey(EntityPageKinds.LOTE, CROSS_LINK.loteGranel);
  const lote = next.entityPages[loteKey];
  if (lote && decision === "liberado") {
    next.entityPages[loteKey] = appendActivity(
      {
        ...lote,
        status: Status.LIBERADO,
        currentStageId: "liberado",
      },
      {
        timestamp: nowLabel(),
        user: context.userName,
        action: "Lote liberado",
        description: "Disposición firmada por Dirección Técnica.",
      }
    );
  }

  next = bumpDayPulse(next);

  return success(
    next,
    {
      tone: decision === "liberado" ? "ok" : "attention",
      title: "Liberación firmada",
      description: `Decisión registrada: ${decision}.`,
    },
    decision === "liberado"
      ? "El granel está liberado — podés iniciar acondicionamiento."
      : undefined
  );
};

export const handlePedidoDespachar: PureHandler = (state, context, flowData) => {
  const key = entityPageKey(EntityPageKinds.PEDIDO, context.entityId);
  const model = state.entityPages[key];
  if (!model) {
    return {
      result: {
        ok: false,
        code: "handler",
        feedback: { tone: "problem", title: "Pedido no encontrado" },
      },
    };
  }

  const data = getFormData(flowData, "despacho");
  const updatedSections = model.sections.map((section) => {
    if (section.id !== "renglones" || section.content.type !== "audit-table") {
      return section;
    }
    const renglonId = data.renglon ?? "r4";
    return {
      ...section,
      content: {
        ...section.content,
        table: {
          ...section.content.table,
          rows: section.content.table.rows.map((row) =>
            row.id === renglonId
              ? {
                  ...row,
                  cells: {
                    ...row.cells,
                    despachado: data.cantidad ?? row.cells.despachado,
                    estado: "Completo",
                  },
                }
              : row
          ),
        },
      },
    };
  });

  let next = cloneState(state);
  next.entityPages[key] = appendActivity(
    {
      ...model,
      status: Status.PARCIAL,
      sections: updatedSections,
    },
    {
      timestamp: nowLabel(),
      user: context.userName,
      action: "Despacho registrado",
      description: `${data.cantidad} del lote ${data.lotePt}`,
    }
  );

  next.workspaceTasks.deposito = next.workspaceTasks.deposito.map((task) =>
    task.payload.entityType === "pedido" &&
    task.payload.data.pedidoId === context.entityId
      ? {
          ...task,
          payload: {
            ...task.payload,
            data: {
              ...task.payload.data,
              avanceDespacho: "4/5 renglones",
            },
          },
        }
      : task
  );

  next = bumpDayPulse(next);

  return success(
    next,
    {
      tone: "ok",
      title: "Despacho registrado",
      description: "El movimiento se registró contra el pedido.",
    },
    "Comercial puede hacer seguimiento del avance."
  );
};
