/**
 * Semantic color tokens — /docs/07-design-system.md §2.1
 */

export const semanticColors = {
  ok: { hex: "#1E8E5A", label: "OK / Aprobado" },
  attention: { hex: "#C8881A", label: "Atención / En proceso" },
  problem: { hex: "#C0392B", label: "Problema / Detenido" },
  action: { hex: "#2D6CDF", label: "Acción / Marca" },
  neutral: { hex: "#6B7280", label: "Información / Neutro" },
  accent: { hex: "#1FA39A", label: "Acento Genus" },
} as const;

export type SemanticToken = keyof typeof semanticColors;
