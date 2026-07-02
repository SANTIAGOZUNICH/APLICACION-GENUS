/** Genus OS — reglas de formularios. Inputs mínimos, claros, sin ruido. */

export const genusFormTokens = {
  input: {
    height: "2.75rem",
    paddingX: "var(--genus-space-4)",
    paddingY: "var(--genus-space-2)",
    radius: "var(--genus-radius-md)",
    border: "1px solid var(--genus-neutral-200)",
    background: "var(--genus-surface-card)",
    fontSize: "var(--genus-text-body-sm)",
    focusBorder: "var(--genus-brand-primary)",
    focusShadow: "var(--genus-shadow-focus)",
  },
  label: {
    fontSize: "var(--genus-text-label)",
    color: "var(--genus-text-secondary)",
    marginBottom: "var(--genus-space-2)",
  },
  helper: {
    fontSize: "var(--genus-text-caption)",
    color: "var(--genus-text-secondary)",
  },
  error: {
    color: "var(--genus-error)",
    border: "var(--genus-error)",
  },
  checkbox: {
    size: "1rem",
    accent: "var(--genus-brand-primary)",
  },
} as const;

export const genusFormRules = [
  "Un campo = una intención clara",
  "Labels siempre visibles — no placeholder-only",
  "Errores debajo del campo, color error oficial",
  "Acciones primarias a la derecha o al pie del bloque",
  "Sin formularios de 12 columnas tipo ERP",
] as const;

export const genusButtonVariants = {
  primary: {
    bg: "var(--genus-brand-primary)",
    color: "#FFFFFF",
    hover: "rgb(31 163 154 / 0.9)",
    border: "transparent",
  },
  secondary: {
    bg: "var(--genus-surface-card)",
    color: "var(--genus-text-primary)",
    hover: "var(--genus-neutral-50)",
    border: "var(--genus-neutral-200)",
  },
  ghost: {
    bg: "transparent",
    color: "var(--genus-text-secondary)",
    hover: "var(--genus-neutral-100)",
    border: "transparent",
  },
  danger: {
    bg: "var(--genus-error-soft)",
    color: "var(--genus-error)",
    hover: "rgb(254 242 242)",
    border: "rgb(185 28 28 / 0.2)",
  },
} as const;

export type GenusButtonVariant = keyof typeof genusButtonVariants;
