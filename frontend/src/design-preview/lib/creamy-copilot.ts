import type { WorkItem } from "@/types/operational/work-item";
import type { CreamyContextDefinition } from "@/lib/role-engine";

export interface CopilotContext {
  headline: string;
  hint: string;
  suggestions: string[];
}

/** Creamy AI como copiloto contextual — configuración del sector + estado del día. */
export function buildCopilotContext(
  items: WorkItem[],
  sectorTitle: string,
  creamy: CreamyContextDefinition
): CopilotContext {
  if (items.length === 0) {
    return {
      headline: "Sin trabajo asignado",
      hint: creamy.defaultHint,
      suggestions: creamy.baseSuggestions,
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
      suggestions: mergeSuggestions(creamy.baseSuggestions, ["Ver bloqueos", "Reportar faltante"]),
    };
  }

  if (urgent) {
    const label = urgent.client ?? urgent.product ?? "trabajo prioritario";
    return {
      headline: `Prioridad: ${label}`,
      hint: `${urgent.line ?? sectorTitle} — ${label}. Te guío con los pasos para cerrar el día.`,
      suggestions: mergeSuggestions(creamy.baseSuggestions, ["Abrir OA", "Ver insumos"]),
    };
  }

  if (inProgress.length > 0) {
    return {
      headline: `${inProgress.length} en proceso`,
      hint: "Hay trabajos abiertos. Puedo ayudarte a cerrar unidades o marcar terminado sin salir del puesto.",
      suggestions: mergeSuggestions(creamy.baseSuggestions, ["Marcar terminado", "Ver entregas"]),
    };
  }

  return {
    headline: `${items.length} pendiente(s)`,
    hint: "Trabajos listos para arrancar. ¿Por cuál empezamos?",
    suggestions: creamy.baseSuggestions,
  };
}

function mergeSuggestions(base: string[], dynamic: string[]): string[] {
  return [...new Set([...dynamic, ...base])].slice(0, 5);
}
