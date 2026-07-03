/** Genus OS — radios oficiales. Suaves, premium, nunca cuadrados duros. */

export const genusRadius = {
  none: "0",
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.125rem",
  full: "9999px",
} as const;

export const genusRadiusCss = {
  sm: "var(--genus-radius-sm)",
  md: "var(--genus-radius-md)",
  lg: "var(--genus-radius-lg)",
  xl: "var(--genus-radius-xl)",
  full: "var(--genus-radius-full)",
} as const;

export const genusRadiusUsage = {
  button: genusRadius.md,
  card: genusRadius.xl,
  panel: genusRadius.lg,
  badge: genusRadius.full,
  input: genusRadius.md,
  modal: genusRadius.xl,
} as const;
