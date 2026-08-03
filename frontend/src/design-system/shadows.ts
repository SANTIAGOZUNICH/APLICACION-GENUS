/** Genus OS — INDUSTRIAL GLASS shadows (mirrors CSS). */

export const genusShadows = {
  none: "none",
  xs: "0 1px 2px rgb(7 25 37 / 0.04)",
  sm: "0 1px 2px rgb(7 25 37 / 0.04), 0 2px 8px rgb(7 25 37 / 0.04)",
  md: "0 1px 2px rgb(7 25 37 / 0.03), 0 8px 24px rgb(7 25 37 / 0.06)",
  lg: "0 2px 4px rgb(7 25 37 / 0.04), 0 16px 40px rgb(7 25 37 / 0.08)",
  glass: "0 1px 0 rgb(255 255 255 / 0.7) inset, 0 8px 28px rgb(7 25 37 / 0.06)",
  focus: "0 0 0 3px rgb(18 191 183 / 0.22)",
  focusAction: "0 0 0 3px rgb(23 105 224 / 0.22)",
} as const;

export const genusShadowCss = {
  xs: "var(--genus-shadow-xs)",
  sm: "var(--genus-shadow-sm)",
  md: "var(--genus-shadow-md)",
  lg: "var(--genus-shadow-lg)",
  glass: "var(--genus-shadow-glass)",
  focus: "var(--genus-shadow-focus)",
} as const;

export const genusShadowUsage = {
  card: "glass",
  cardHover: "md",
  panel: "sm",
  dropdown: "lg",
  sidebar: "none",
} as const;
