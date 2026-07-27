import { genusCardDefinitions } from "@/design-system/cards";
import { genusColors } from "@/design-system/colors";
import { genusCreamy } from "@/design-system/creamy";
import { genusFormTokens, genusButtonVariants } from "@/design-system/forms";
import { genusIconRules, genusIconSizes } from "@/design-system/icons";
import { genusLayout, genusBreakpoints, genusResponsiveRules } from "@/design-system/layout";
import { genusMotion, genusMotionPresets } from "@/design-system/motion";
import { genusPanelDefinitions } from "@/design-system/panels";
import { genusRadius, genusRadiusUsage } from "@/design-system/radius";
import { genusShadows, genusShadowUsage } from "@/design-system/shadows";
import { genusSpacing, genusLayoutSpacing } from "@/design-system/spacing";
import { genusStatusDefinitions } from "@/design-system/status";
import { genusTypography } from "@/design-system/typography";

/** Objeto unificado de tokens Genus OS — fuente de verdad F9.5. */
export const genusTokens = {
  colors: genusColors,
  spacing: genusSpacing,
  layoutSpacing: genusLayoutSpacing,
  typography: genusTypography,
  radius: genusRadius,
  radiusUsage: genusRadiusUsage,
  shadows: genusShadows,
  shadowUsage: genusShadowUsage,
  motion: genusMotion,
  motionPresets: genusMotionPresets,
  icons: { sizes: genusIconSizes, rules: genusIconRules },
  status: genusStatusDefinitions,
  cards: genusCardDefinitions,
  panels: genusPanelDefinitions,
  forms: genusFormTokens,
  buttons: genusButtonVariants,
  layout: genusLayout,
  breakpoints: genusBreakpoints,
  responsive: genusResponsiveRules,
  creamy: genusCreamy,
} as const;

export type GenusTokens = typeof genusTokens;

/** Reglas que nunca deben romperse — INDUSTRIAL GLASS */
export const genusDesignRules = [
  "Prioridad: entender qué tengo que hacer en 5 segundos",
  "Nunca más de un acento de color por bloque",
  "--genus-* es la fuente de verdad; --os-* solo vía bridge",
  "Glass solo en chrome/panels — nunca en contenido denso",
  "No tablas densas tipo ERP — preferir cards",
  "No KPIs en home operarios",
  "Espaciado solo de la escala oficial (4–64)",
  "Cards solo de tipos registrados en cards.ts",
  "Estados solo de status.ts — no inventar variantes",
  "Creamy: solo FAB + panel — sin tarjeta permanente en sidebar",
  "Desktop first — operarios en estaciones de trabajo",
  "Motion sutil — hover/panel; respetar prefers-reduced-motion",
  "Sombras glass/sm/md — sin glow teatral ni multi-layer",
] as const;
