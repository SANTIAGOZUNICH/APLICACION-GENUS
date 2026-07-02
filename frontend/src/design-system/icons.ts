/**
 * Genus OS — iconografía oficial (Lucide).
 * Tamaños y reglas de uso — no iconos decorativos.
 */

export const genusIconSizes = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export const genusIconRules = {
  strokeWidth: 1.75,
  colorDefault: "var(--genus-text-secondary)",
  colorActive: "var(--genus-brand-primary)",
  colorInverse: "var(--genus-text-inverse)",
} as const;

/** Mapa semántico icono → significado operativo. */
export const genusIconMap = {
  work: "Briefcase",
  calendar: "Calendar",
  search: "Search",
  package: "Package",
  quality: "Shield",
  settings: "Settings",
  production: "Factory",
  direction: "LayoutDashboard",
  alert: "AlertCircle",
  success: "CheckCircle2",
  blocked: "OctagonAlert",
  pending: "Clock",
  inProgress: "Loader2",
  urgent: "Flame",
  oa: "FileBox",
  oe: "FlaskConical",
  lote: "TestTube2",
  pedido: "ShoppingCart",
  creamy: "Sparkles",
  chevron: "ChevronRight",
  close: "X",
} as const;

export type GenusIconName = keyof typeof genusIconMap;
