export const genusDesignSystemNav = [
  { id: "filosofia", label: "Filosofía" },
  { id: "colores", label: "Colores" },
  { id: "tipografia", label: "Tipografía" },
  { id: "espaciado", label: "Espaciado" },
  { id: "botones", label: "Botones" },
  { id: "estados", label: "Estados" },
  { id: "cards", label: "Cards" },
  { id: "paneles", label: "Paneles" },
  { id: "creamy", label: "Creamy" },
  { id: "motion", label: "Motion" },
  { id: "conceptos", label: "Componentes" },
  { id: "reglas", label: "Reglas" },
] as const;

export type GenusDesignSystemNavItem = (typeof genusDesignSystemNav)[number];
