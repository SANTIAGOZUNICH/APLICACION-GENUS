import type { WorkItem } from "@/types/operational/work-item";

export interface CopilotContext {
  headline: string;
  hint: string;
  suggestions: string[];
}

/** Creamy AI como copiloto contextual — no chatbot genérico. */
export function buildCopilotContext(items: WorkItem[], sectorLabel: string): CopilotContext {
  if (items.length === 0) {
    return {
      headline: "Sin trabajo asignado",
      hint: "No hay trabajos para este día en SEMANAS 2026. Puedo ayudarte a revisar el plan semanal o consultar un pedido.",
      suggestions: ["Ver plan semanal", "Consultar pedido", "Revisar bloqueos"],
    };
  }

  const blocked = items.filter((item) => item.status === "bloqueado");
  const inProgress = items.filter((item) => item.status === "en_curso");
  const urgent = items.find(
    (item) => item.priority === "URGENTE" || item.priority === "HOY"
  );

  if (blocked.length > 0) {
    return {
      headline: `${blocked.length} bloqueo(s) activo(s)`,
      hint: "Hay trabajos detenidos. Puedo señalar dependencias o faltantes antes de que frenen la línea.",
      suggestions: ["Ver bloqueos", "Reportar faltante", "Consultar insumos"],
    };
  }

  if (urgent) {
    const label = urgent.client ?? urgent.product ?? "trabajo prioritario";
    return {
      headline: `Prioridad: ${label}`,
      hint: `${urgent.line ?? sectorLabel} — ${label}. Te guío con la OA y los pasos para cerrar el día.`,
      suggestions: ["Abrir OA", "Ver insumos", "Marcar avance"],
    };
  }

  if (inProgress.length > 0) {
    return {
      headline: `${inProgress.length} en proceso`,
      hint: "Hay trabajos abiertos. Puedo ayudarte a cerrar unidades o marcar terminado sin salir del puesto.",
      suggestions: ["Marcar terminado", "Ver entregas", "Registrar observación"],
    };
  }

  return {
    headline: `${items.length} pendiente(s)`,
    hint: "Trabajos listos para arrancar. ¿Ordenamos por entrega o por línea?",
    suggestions: ["Ordenar por entrega", "Ver por línea", "Crear OA"],
  };
}
