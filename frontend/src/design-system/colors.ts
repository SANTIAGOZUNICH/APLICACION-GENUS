/**
 * Genus OS — INDUSTRIAL GLASS palette (mirrors genus-tokens.css).
 * CSS --genus-* is source of truth.
 */

export const genusColors = {
  brand: {
    primary: { hex: "#12BFB7", name: "Turquesa Genus", css: "var(--genus-brand-primary)" },
    primarySoft: { hex: "#E6FAF8", name: "Turquesa suave", css: "var(--genus-brand-primary-soft)" },
    primaryMuted: {
      hex: "rgb(18 191 183 / 0.14)",
      name: "Turquesa muted",
      css: "var(--genus-brand-primary-muted)",
    },
    primaryGlow: { hex: "#55E2D8", name: "Turquesa luminoso", css: "var(--genus-brand-primary-glow)" },
    action: { hex: "#1769E0", name: "Azul Genus", css: "var(--genus-brand-action)" },
    actionSoft: { hex: "#E8F1FC", name: "Azul suave", css: "var(--genus-brand-action-soft)" },
    secondary: { hex: "#0B2636", name: "Navy secundario", css: "var(--genus-brand-secondary)" },
    secondarySoft: { hex: "#E8EEF3", name: "Navy suave", css: "var(--genus-brand-secondary-soft)" },
    navyDark: { hex: "#071925", name: "Navy profundo", css: "var(--genus-brand-navy-dark)" },
  },
  neutral: {
    50: { hex: "#F4F8FA", css: "var(--genus-neutral-50)" },
    100: { hex: "#EEF4F7", css: "var(--genus-neutral-100)" },
    200: { hex: "#DCE6EC", css: "var(--genus-neutral-200)" },
    300: { hex: "#C5D3DB", css: "var(--genus-neutral-300)" },
    400: { hex: "#93A4AE", css: "var(--genus-neutral-400)" },
    500: { hex: "#60727C", css: "var(--genus-neutral-500)" },
    600: { hex: "#4A5B65", css: "var(--genus-neutral-600)" },
    700: { hex: "#334650", css: "var(--genus-neutral-700)" },
    800: { hex: "#1F323C", css: "var(--genus-neutral-800)" },
    900: { hex: "#10232D", css: "var(--genus-neutral-900)" },
  },
  semantic: {
    success: { hex: "#15803D", name: "Éxito", css: "var(--genus-success)" },
    successSoft: { hex: "#ECFDF3", css: "var(--genus-success-soft)" },
    warning: { hex: "#B45309", name: "Advertencia", css: "var(--genus-warning)" },
    warningSoft: { hex: "#FFFBEB", css: "var(--genus-warning-soft)" },
    error: { hex: "#B91C1C", name: "Error", css: "var(--genus-error)" },
    errorSoft: { hex: "#FEF2F2", css: "var(--genus-error-soft)" },
    info: { hex: "#1769E0", name: "Información", css: "var(--genus-info)" },
    infoSoft: { hex: "#E8F1FC", css: "var(--genus-info-soft)" },
  },
  surface: {
    bg: { hex: "#F4F8FA", css: "var(--genus-surface-bg)" },
    card: { hex: "#FFFFFF", css: "var(--genus-surface-card)" },
    glass: { hex: "rgb(255 255 255 / 0.78)", css: "var(--genus-surface-glass)" },
    muted: { hex: "#EEF4F7", css: "var(--genus-surface-muted)" },
    sidebar: { hex: "#071925", css: "var(--genus-surface-sidebar)" },
  },
  text: {
    primary: { hex: "#10232D", css: "var(--genus-text-primary)" },
    secondary: { hex: "#60727C", css: "var(--genus-text-secondary)" },
    inverse: { css: "var(--genus-text-inverse)" },
  },
} as const;

export const genusColorSwatches = [
  { group: "Marca", items: Object.values(genusColors.brand) },
  {
    group: "Neutros",
    items: Object.entries(genusColors.neutral).map(([key, v]) => ({
      ...v,
      name: `Neutral ${key}`,
    })),
  },
  {
    group: "Estados",
    items: [
      genusColors.semantic.success,
      genusColors.semantic.warning,
      genusColors.semantic.error,
      genusColors.semantic.info,
    ],
  },
] as const;
