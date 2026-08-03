/**
 * Genus OS — Creamy (Industrial Glass).
 * FAB + panel únicamente — sin tarjeta permanente en sidebar.
 */

export const genusCreamy = {
  colors: {
    fabBg: "var(--genus-brand-primary)",
    fabFg: "var(--genus-brand-navy-dark)",
    panelHeader:
      "linear-gradient(135deg, var(--genus-brand-navy-dark) 0%, var(--genus-surface-sidebar-2) 55%, #0a3d45 100%)",
    bubbleUser: "var(--genus-neutral-100)",
    bubbleAssistant: "var(--genus-surface-card)",
    accent: "var(--genus-brand-primary)",
    headline: "var(--genus-brand-primary)",
    text: "var(--genus-text-secondary)",
  },
  typography: {
    role: "var(--genus-text-label)",
    headline: "var(--genus-text-body-sm)",
    body: "var(--genus-text-body-sm)",
    suggestion: "var(--genus-text-caption)",
  },
  components: {
    fab: {
      name: "Creamy FAB",
      description: "Único launcher permanente — esquina inferior derecha",
    },
    panel: {
      name: "Creamy Panel",
      description: "Drawer de conversación — glass chrome + header navy",
    },
    bubble: {
      name: "Creamy Bubble",
      padding: "var(--genus-space-3) var(--genus-space-4)",
      radius: "var(--genus-radius-lg)",
      description: "Mensaje conversacional — esquinas suaves, sin cola de chat clásico",
    },
    suggestions: {
      name: "Creamy Suggestions",
      style: "Pills/chips — border turquesa muted, hover primary",
      maxVisible: 5,
    },
    actions: {
      name: "Creamy Actions",
      style: "Botón primary compacto + chips secundarios",
      description: "Acciones sugeridas, nunca modal bloqueante",
    },
  },
  rules: [
    "Solo FAB + panel — sin tarjeta permanente en sidebar",
    "Contexto del sector + workflow — no respuestas genéricas",
    "Sin avatar obligatorio hasta fase de personaje",
    "Sparkles icon como marca temporal",
    "Tono: copiloto de planta, no asistente genérico",
  ],
} as const;

export type GenusCreamyComponent = keyof typeof genusCreamy.components;
