import type { GenusIconName } from "@/design-system/icons";

/** Genus OS — estados operativos oficiales. */

export type GenusOperationalStatus =
  | "pendiente"
  | "en_proceso"
  | "bloqueado"
  | "completado"
  | "urgente";

export interface GenusStatusDefinition {
  id: GenusOperationalStatus;
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: GenusIconName;
  badgeVariant: "soft" | "solid" | "outline";
  description: string;
}

export const genusStatusDefinitions: Record<GenusOperationalStatus, GenusStatusDefinition> = {
  pendiente: {
    id: "pendiente",
    label: "Pendiente",
    color: "var(--genus-warning)",
    bg: "var(--genus-warning-soft)",
    border: "rgb(180 83 9 / 0.2)",
    icon: "pending",
    badgeVariant: "soft",
    description: "Trabajo asignado, aún no iniciado.",
  },
  en_proceso: {
    id: "en_proceso",
    label: "En proceso",
    color: "var(--genus-info)",
    bg: "var(--genus-info-soft)",
    border: "rgb(3 105 161 / 0.2)",
    icon: "inProgress",
    badgeVariant: "soft",
    description: "Operación en curso.",
  },
  bloqueado: {
    id: "bloqueado",
    label: "Bloqueado",
    color: "var(--genus-error)",
    bg: "var(--genus-error-soft)",
    border: "rgb(185 28 28 / 0.2)",
    icon: "blocked",
    badgeVariant: "soft",
    description: "Detenido por dependencia o faltante.",
  },
  completado: {
    id: "completado",
    label: "Completado",
    color: "var(--genus-success)",
    bg: "var(--genus-success-soft)",
    border: "rgb(21 128 61 / 0.2)",
    icon: "success",
    badgeVariant: "soft",
    description: "Trabajo cerrado correctamente.",
  },
  urgente: {
    id: "urgente",
    label: "Urgente",
    color: "var(--genus-error)",
    bg: "var(--genus-error-soft)",
    border: "rgb(185 28 28 / 0.35)",
    icon: "urgent",
    badgeVariant: "solid",
    description: "Prioridad máxima — requiere acción inmediata.",
  },
};

export const genusStatusList = Object.values(genusStatusDefinitions);
