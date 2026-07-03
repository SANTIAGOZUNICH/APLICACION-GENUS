/** Genus OS — tipos oficiales de cards. No crear variantes fuera del sistema. */

export type GenusCardType =
  | "work"
  | "summary"
  | "panel"
  | "warning"
  | "empty"
  | "creamy";

export interface GenusCardDefinition {
  id: GenusCardType;
  name: string;
  purpose: string;
  padding: string;
  radius: string;
  shadow: string;
  border: string;
  background: string;
  minHeight?: string;
}

export const genusCardDefinitions: Record<GenusCardType, GenusCardDefinition> = {
  work: {
    id: "work",
    name: "Work Card",
    purpose: "Unidad principal de trabajo — cliente, producto, cantidad, acciones.",
    padding: "var(--genus-space-6)",
    radius: "var(--genus-radius-xl)",
    shadow: "var(--genus-shadow-md)",
    border: "1px solid var(--genus-neutral-200)",
    background: "var(--genus-surface-card)",
    minHeight: "12rem",
  },
  summary: {
    id: "summary",
    name: "Summary Card",
    purpose: "Contador rápido — Para hacer, En progreso, Terminadas, Bloqueadas.",
    padding: "var(--genus-space-4)",
    radius: "var(--genus-radius-lg)",
    shadow: "var(--genus-shadow-sm)",
    border: "1px solid var(--genus-neutral-200)",
    background: "var(--genus-surface-card)",
  },
  panel: {
    id: "panel",
    name: "Panel Card",
    purpose: "Bloques laterales — entregas, problemas, contexto.",
    padding: "var(--genus-space-4)",
    radius: "var(--genus-radius-lg)",
    shadow: "var(--genus-shadow-sm)",
    border: "1px solid var(--genus-neutral-200)",
    background: "var(--genus-surface-card)",
  },
  warning: {
    id: "warning",
    name: "Warning Card",
    purpose: "Alertas operativas — bloqueos, faltantes, urgencias.",
    padding: "var(--genus-space-4)",
    radius: "var(--genus-radius-lg)",
    shadow: "none",
    border: "1px solid rgb(180 83 9 / 0.25)",
    background: "var(--genus-warning-soft)",
  },
  empty: {
    id: "empty",
    name: "Empty Card",
    purpose: "Sin trabajo asignado — mensaje claro, borde punteado.",
    padding: "var(--genus-space-8)",
    radius: "var(--genus-radius-xl)",
    shadow: "none",
    border: "1px dashed var(--genus-neutral-300)",
    background: "var(--genus-surface-muted)",
    minHeight: "10rem",
  },
  creamy: {
    id: "creamy",
    name: "Creamy Card",
    purpose: "Copiloto contextual — integrado al OS, no chatbot flotante.",
    padding: "var(--genus-space-4)",
    radius: "var(--genus-radius-lg)",
    shadow: "var(--genus-shadow-sm)",
    border: "1px solid var(--genus-brand-primary-muted)",
    background: "linear-gradient(135deg, var(--genus-brand-primary-soft), var(--genus-surface-card))",
  },
};

export const genusCardList = Object.values(genusCardDefinitions);
