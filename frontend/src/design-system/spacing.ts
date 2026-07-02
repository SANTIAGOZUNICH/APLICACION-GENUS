/**
 * Genus OS — escala de espaciado única (px).
 * Nada arbitrario fuera de esta escala.
 */

export const genusSpacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
} as const;

export type GenusSpacingKey = keyof typeof genusSpacing;

export const genusSpacingCss = {
  0: "var(--genus-space-0)",
  1: "var(--genus-space-1)",
  2: "var(--genus-space-2)",
  3: "var(--genus-space-3)",
  4: "var(--genus-space-4)",
  6: "var(--genus-space-6)",
  8: "var(--genus-space-8)",
  12: "var(--genus-space-12)",
  16: "var(--genus-space-16)",
} as const;

/** Espaciado semántico — nombres de uso en layouts. */
export const genusLayoutSpacing = {
  pagePadding: genusSpacing[8],
  sectionGap: genusSpacing[12],
  blockGap: genusSpacing[6],
  inlineGap: genusSpacing[3],
  cardPadding: genusSpacing[6],
  cardPaddingLg: genusSpacing[8],
} as const;

export const genusSpacingScale = Object.entries(genusSpacing).map(([token, px]) => ({
  token,
  px,
  css: `--genus-space-${token}`,
}));
