import type { WorkItemStatus } from "@/types/operational/work-item";

/** Display unificado para estados WorkItem — preview + futura app OS. */
export interface WorkItemStatusDisplay {
  label: string;
  /** Clase Tailwind para indicador puntual (dot) */
  dotClassName: string;
  colorVar: string;
  bgVar: string;
}

export const workItemStatusDisplay: Record<WorkItemStatus, WorkItemStatusDisplay> = {
  pendiente: {
    label: "Pendiente",
    dotClassName: "bg-[var(--genus-warning)]",
    colorVar: "var(--genus-warning)",
    bgVar: "var(--genus-warning-soft)",
  },
  en_curso: {
    label: "En proceso",
    dotClassName: "bg-[var(--genus-info)]",
    colorVar: "var(--genus-info)",
    bgVar: "var(--genus-info-soft)",
  },
  completo: {
    label: "Terminado",
    dotClassName: "bg-[var(--genus-success)]",
    colorVar: "var(--genus-success)",
    bgVar: "var(--genus-success-soft)",
  },
  bloqueado: {
    label: "Bloqueado",
    dotClassName: "bg-[var(--genus-error)]",
    colorVar: "var(--genus-error)",
    bgVar: "var(--genus-error-soft)",
  },
  revision: {
    label: "En revisión",
    dotClassName: "bg-[var(--genus-brand-secondary)]",
    colorVar: "var(--genus-brand-secondary)",
    bgVar: "var(--genus-brand-secondary-soft)",
  },
  entregado: {
    label: "Entregado",
    dotClassName: "bg-[var(--genus-success)]",
    colorVar: "var(--genus-success)",
    bgVar: "var(--genus-success-soft)",
  },
  cancelado: {
    label: "Cancelado",
    dotClassName: "bg-[var(--genus-neutral-400)]",
    colorVar: "var(--genus-neutral-500)",
    bgVar: "var(--genus-neutral-100)",
  },
};

export function resolveWorkItemStatusDisplay(status: WorkItemStatus): WorkItemStatusDisplay {
  return workItemStatusDisplay[status];
}
