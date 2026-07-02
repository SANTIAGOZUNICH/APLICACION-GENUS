/** Genus OS — layout y breakpoints. Desktop first. */

export const genusBreakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

export const genusLayout = {
  maxWidth: {
    content: "72rem",
    wide: "90rem",
    narrow: "40rem",
  },
  sidebarWidth: "16rem",
  contextPanelWidth: "20rem",
  headerHeight: "3.75rem",
  statusBarHeight: "2rem",
  pagePadding: {
    desktop: "var(--genus-space-8)",
    tablet: "var(--genus-space-6)",
    mobile: "var(--genus-space-4)",
  },
} as const;

export const genusResponsiveRules = {
  desktop: {
    priority: "absolute",
    layout: "Sidebar fija + main + context panel lateral",
    columns: "12 column grid, gap 24px",
    minWidth: `${genusBreakpoints.lg}px`,
  },
  tablet: {
    layout: "Sidebar colapsable o icon-only, context bajo main",
    columns: "8 column grid",
    range: `${genusBreakpoints.md}px – ${genusBreakpoints.lg - 1}px`,
  },
  mobile: {
    layout: "Single column, nav inferior o drawer",
    columns: "4 column grid",
    maxWidth: `${genusBreakpoints.md - 1}px`,
    note: "Operarios usan desktop — mobile es consulta rápida only",
  },
} as const;

/** Componentes conceptuales — reglas visuales, no implementación. */
export const genusConceptualComponents = {
  sidebar: genusResponsiveRules.desktop.layout,
  header: "Altura fija, sin scroll",
  timeline: "Vertical, dots sutiles, labels caption — plan semanal L-V",
  workItem: "Work Card — línea, cliente, producto, cantidad, entrega, acciones",
  calendar: "Días L-V clickeables, día activo destacado turquesa",
  checklist: "Depósito — inputs numéricos inline, sin tabla densa",
  table: "Evitar. Preferir cards. Si inevitable: filas altas, sin bordes duros",
  form: "Campos apilados, max 2 columnas en desktop",
  modal: "Radius xl, shadow lg, padding 32px, overlay 40% navy",
  drawer: "Desde derecha, motion drawer preset, width 24rem max",
  spotlight: "Consulta — input centrado, resultados agrupados, estilo Raycast",
} as const;
