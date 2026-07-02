/**
 * Genus OS — paleta oficial (F9.5).
 * Turquesa institucional + petróleo + neutros desaturados.
 */

export const genusColors = {
  brand: {
    primary: { hex: "#1FA39A", name: "Turquesa Genus", css: "var(--genus-brand-primary)" },
    primarySoft: { hex: "#E6F7F6", name: "Turquesa suave", css: "var(--genus-brand-primary-soft)" },
    primaryMuted: { hex: "rgb(31 163 154 / 0.14)", name: "Turquesa muted", css: "var(--genus-brand-primary-muted)" },
    secondary: { hex: "#0F4C5C", name: "Azul petróleo", css: "var(--genus-brand-secondary)" },
    secondarySoft: { hex: "#E8F1F3", name: "Petroleo suave", css: "var(--genus-brand-secondary-soft)" },
  },
  neutral: {
    50: { hex: "#F8FAFC", css: "var(--genus-neutral-50)" },
    100: { hex: "#F1F5F9", css: "var(--genus-neutral-100)" },
    200: { hex: "#E2E8F0", css: "var(--genus-neutral-200)" },
    300: { hex: "#CBD5E1", css: "var(--genus-neutral-300)" },
    400: { hex: "#94A3B8", css: "var(--genus-neutral-400)" },
    500: { hex: "#64748B", css: "var(--genus-neutral-500)" },
    600: { hex: "#475569", css: "var(--genus-neutral-600)" },
    700: { hex: "#334155", css: "var(--genus-neutral-700)" },
    800: { hex: "#1E293B", css: "var(--genus-neutral-800)" },
    900: { hex: "#0F172A", css: "var(--genus-neutral-900)" },
  },
  semantic: {
    success: { hex: "#15803D", name: "Éxito", css: "var(--genus-success)" },
    successSoft: { hex: "#ECFDF3", css: "var(--genus-success-soft)" },
    warning: { hex: "#B45309", name: "Advertencia", css: "var(--genus-warning)" },
    warningSoft: { hex: "#FFFBEB", css: "var(--genus-warning-soft)" },
    error: { hex: "#B91C1C", name: "Error", css: "var(--genus-error)" },
    errorSoft: { hex: "#FEF2F2", css: "var(--genus-error-soft)" },
    info: { hex: "#0369A1", name: "Información", css: "var(--genus-info)" },
    infoSoft: { hex: "#F0F9FF", css: "var(--genus-info-soft)" },
  },
  surface: {
    bg: { hex: "#F4F7FA", css: "var(--genus-surface-bg)" },
    card: { hex: "#FFFFFF", css: "var(--genus-surface-card)" },
    muted: { hex: "#F8FAFC", css: "var(--genus-surface-muted)" },
    sidebar: { hex: "#0F172A", css: "var(--genus-surface-sidebar)" },
  },
  text: {
    primary: { css: "var(--genus-text-primary)" },
    secondary: { css: "var(--genus-text-secondary)" },
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
