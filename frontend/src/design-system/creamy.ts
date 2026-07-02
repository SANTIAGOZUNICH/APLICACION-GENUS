/**
 * Genus OS — Creamy visual identity (sin personaje aún).
 * Copiloto integrado, no chatbot externo.
 */

export const genusCreamy = {
  colors: {
    cardBg: "linear-gradient(135deg, var(--genus-brand-primary-soft), var(--genus-surface-card))",
    cardBorder: "var(--genus-brand-primary-muted)",
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
    card: {
      name: "Creamy Card",
      padding: "var(--genus-space-4)",
      radius: "var(--genus-radius-lg)",
      description: "Bloque en sidebar o context panel — rol + hint + sugerencias",
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
    "Integrada al OS Shell — nunca flotante sobre toda la app",
    "Contexto del sector + workflow — no respuestas genéricas",
    "Sin avatar obligatorio hasta fase de personaje",
    "Sparkles icon como marca temporal",
    "Tono: copiloto de planta, no asistente genérico",
  ],
} as const;

export type GenusCreamyComponent = keyof typeof genusCreamy.components;
