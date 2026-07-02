/** Genus OS — paneles estructurales del OS Shell. Reglas conceptuales. */

export type GenusPanelType = "sidebar" | "header" | "main" | "context" | "statusBar";

export interface GenusPanelDefinition {
  id: GenusPanelType;
  name: string;
  rules: string[];
  dimensions?: { width?: string; height?: string };
  background: string;
  border?: string;
}

export const genusPanelDefinitions: Record<GenusPanelType, GenusPanelDefinition> = {
  sidebar: {
    id: "sidebar",
    name: "Sidebar",
    background: "var(--genus-surface-sidebar)",
    dimensions: { width: "16rem" },
    rules: [
      "Navy petróleo — identidad OS persistente",
      "Logo + sector activo + nav + Creamy abajo",
      "Sin KPIs, sin tablas",
      "Ítems con padding generoso, icono + label",
    ],
  },
  header: {
    id: "header",
    name: "Header",
    background: "var(--genus-surface-card)",
    dimensions: { height: "3.75rem" },
    border: "1px solid var(--genus-neutral-200)",
    rules: [
      "Título mínimo + notificaciones + perfil",
      "Sin KPIs, sin fecha fija global",
      "Altura fija, aire horizontal",
    ],
  },
  main: {
    id: "main",
    name: "Main",
    background: "var(--genus-surface-bg)",
    rules: [
      "Área de trabajo — máximo aire",
      "Padding page: 32px desktop",
      "Contenido resuelto por Role Engine",
    ],
  },
  context: {
    id: "context",
    name: "Context Panel",
    background: "transparent",
    dimensions: { width: "20rem" },
    rules: [
      "Panel lateral sticky en desktop",
      "Entregas, problemas, Creamy",
      "Colapsa bajo main en tablet/mobile",
    ],
  },
  statusBar: {
    id: "statusBar",
    name: "Status Bar",
    background: "var(--genus-surface-bg)",
    dimensions: { height: "2rem" },
    border: "1px solid var(--genus-neutral-100)",
    rules: [
      "Fuente de datos + última sync",
      "Tipografía caption, muted",
      "Sin acciones primarias",
    ],
  },
};

export const genusPanelList = Object.values(genusPanelDefinitions);
