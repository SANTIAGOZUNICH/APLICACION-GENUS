/**
 * Genus OS — tipografía oficial.
 * Jerarquía marcada, mucho aire, legibilidad operativa.
 */

export const genusTypography = {
  fontFamily: {
    sans: 'var(--genus-font-sans, "Inter", system-ui, -apple-system, sans-serif)',
    mono: 'var(--genus-font-mono, "JetBrains Mono", ui-monospace, monospace)',
  },
  heading: {
    xl: {
      size: "2.25rem",
      lineHeight: "2.75rem",
      weight: 600,
      letterSpacing: "-0.025em",
      css: "var(--genus-text-heading-xl)",
    },
    l: {
      size: "1.875rem",
      lineHeight: "2.25rem",
      weight: 600,
      letterSpacing: "-0.02em",
      css: "var(--genus-text-heading-l)",
    },
    m: {
      size: "1.25rem",
      lineHeight: "1.75rem",
      weight: 600,
      letterSpacing: "-0.015em",
      css: "var(--genus-text-heading-m)",
    },
  },
  body: {
    lg: { size: "1.125rem", lineHeight: "1.75rem", weight: 400, css: "var(--genus-text-body-lg)" },
    md: { size: "1rem", lineHeight: "1.625rem", weight: 400, css: "var(--genus-text-body)" },
    sm: { size: "0.875rem", lineHeight: "1.5rem", weight: 400, css: "var(--genus-text-body-sm)" },
  },
  caption: {
    size: "0.75rem",
    lineHeight: "1.125rem",
    weight: 400,
    css: "var(--genus-text-caption)",
  },
  label: {
    size: "0.6875rem",
    lineHeight: "1rem",
    weight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    css: "var(--genus-text-label)",
  },
} as const;

export const genusTypographySamples = [
  { role: "Heading XL", token: "heading.xl", sample: "Hola, Envasado Masivo" },
  { role: "Heading L", token: "heading.l", sample: "Trabajo del día" },
  { role: "Heading M", token: "heading.m", sample: "LÍNEA 1 · THELMA Y LOUISE" },
  { role: "Body", token: "body.md", sample: "Entender qué tengo que hacer — en 5 segundos." },
  { role: "Caption", token: "caption", sample: "Última sincronización · 08:37" },
  { role: "Label", token: "label", sample: "Para hacer" },
] as const;
