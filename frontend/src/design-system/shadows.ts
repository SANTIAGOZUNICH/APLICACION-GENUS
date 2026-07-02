/** Genus OS — sombras mínimas. Calma visual, sin efecto ERP. */

export const genusShadows = {
  none: "none",
  xs: "0 1px 2px rgb(15 23 42 / 0.04)",
  sm: "0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06)",
  md: "0 1px 2px rgb(15 23 42 / 0.04), 0 4px 16px rgb(15 23 42 / 0.04)",
  lg: "0 2px 4px rgb(15 23 42 / 0.06), 0 8px 24px rgb(15 23 42 / 0.06)",
  focus: "0 0 0 3px rgb(31 163 154 / 0.25)",
} as const;

export const genusShadowCss = {
  xs: "var(--genus-shadow-xs)",
  sm: "var(--genus-shadow-sm)",
  md: "var(--genus-shadow-md)",
  lg: "var(--genus-shadow-lg)",
  focus: "var(--genus-shadow-focus)",
} as const;

export const genusShadowUsage = {
  card: "md",
  cardHover: "lg",
  panel: "sm",
  dropdown: "lg",
  sidebar: "none",
} as const;
