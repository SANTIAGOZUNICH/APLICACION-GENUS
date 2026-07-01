/**
 * Status authority — Estado → Label → Color → Ícono → Tokens
 * /docs/07-design-system.md §2.1, §7
 */

import {
  AlertOctagon,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  FileEdit,
  Info,
  Play,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Status, type StatusDefinition, type StatusToken } from "@/types/ui/status";

export const STATUS_DEFINITIONS: Record<Status, StatusDefinition> = {
  [Status.LIBERADO]: { label: "Liberado", token: "ok", badgeToken: "ok" },
  [Status.COMPLETO]: { label: "Completo", token: "ok", badgeToken: "ok" },
  [Status.EN_TOLERANCIA]: { label: "En tolerancia", token: "ok", badgeToken: "ok" },
  [Status.RESUELTO]: { label: "Resuelto", token: "ok", badgeToken: "ok" },
  [Status.CUARENTENA]: { label: "Cuarentena", token: "attention", badgeToken: "attention" },
  [Status.EN_CURSO]: { label: "En curso", token: "attention", badgeToken: "attention" },
  [Status.PARCIAL]: { label: "Parcial", token: "attention", badgeToken: "attention" },
  [Status.POR_VENCER]: { label: "Por vencer", token: "attention", badgeToken: "attention" },
  [Status.DESVIO_LEVE]: { label: "Desvío leve", token: "attention", badgeToken: "attention" },
  [Status.BORRADOR_EN_REVISION]: {
    label: "Borrador en revisión",
    token: "attention",
    badgeToken: "attention",
  },
  [Status.RECHAZADO]: { label: "Rechazado", token: "problem", badgeToken: "problem" },
  [Status.BLOQUEADO]: { label: "Bloqueado", token: "problem", badgeToken: "problem" },
  [Status.VENCIDO]: { label: "Vencido", token: "problem", badgeToken: "problem" },
  [Status.CRITICO]: { label: "Crítico", token: "problem", badgeToken: "problem" },
  [Status.SIN_LOTE]: { label: "Sin lote", token: "problem", badgeToken: "problem" },
  [Status.FUERA_DE_TOLERANCIA]: {
    label: "Fuera de tolerancia",
    token: "problem",
    badgeToken: "problem",
  },
  [Status.PENDIENTE]: { label: "Pendiente", token: "neutral", badgeToken: "neutral" },
  [Status.PLANIFICADA]: { label: "Planificada", token: "neutral", badgeToken: "neutral" },
  [Status.CERRADA]: { label: "Cerrada", token: "neutral", badgeToken: "neutral" },
};

const STATUS_ICONS: Record<Status, LucideIcon> = {
  [Status.LIBERADO]: CheckCircle2,
  [Status.COMPLETO]: CheckCircle2,
  [Status.EN_TOLERANCIA]: CheckCircle2,
  [Status.RESUELTO]: CheckCircle2,
  [Status.CUARENTENA]: Clock,
  [Status.EN_CURSO]: Play,
  [Status.PARCIAL]: AlertTriangle,
  [Status.POR_VENCER]: AlertTriangle,
  [Status.DESVIO_LEVE]: AlertTriangle,
  [Status.BORRADOR_EN_REVISION]: FileEdit,
  [Status.RECHAZADO]: XCircle,
  [Status.BLOQUEADO]: Ban,
  [Status.VENCIDO]: AlertOctagon,
  [Status.CRITICO]: AlertOctagon,
  [Status.SIN_LOTE]: AlertOctagon,
  [Status.FUERA_DE_TOLERANCIA]: AlertOctagon,
  [Status.PENDIENTE]: Info,
  [Status.PLANIFICADA]: Info,
  [Status.CERRADA]: Info,
};

export function getStatusDefinition(status: Status): StatusDefinition {
  return STATUS_DEFINITIONS[status];
}

export function getStatusLabel(status: Status): string {
  return STATUS_DEFINITIONS[status].label;
}

export function getStatusToken(status: Status): StatusToken {
  return STATUS_DEFINITIONS[status].token;
}

export function getStatusIcon(status: Status): LucideIcon {
  return STATUS_ICONS[status];
}

export function getStatusBadgeClasses(status: Status): {
  bg: string;
  text: string;
  color: string;
} {
  const { badgeToken } = STATUS_DEFINITIONS[status];
  return {
    bg: `var(--badge-${badgeToken}-bg)`,
    text: `var(--badge-${badgeToken}-text)`,
    color: `var(--color-${badgeToken})`,
  };
}

export const ALL_STATUSES = Object.values(Status);
