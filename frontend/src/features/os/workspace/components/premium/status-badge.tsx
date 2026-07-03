import type { WorkCardStatus } from "../../experience/types";
import type { AttentionKind } from "../../experience/types";

type BadgeTone = "neutral" | "active" | "urgent" | "blocked" | "waiting";

const WORK_STATUS: Record<
  WorkCardStatus,
  { label: string; tone: BadgeTone }
> = {
  ready: { label: "Lista", tone: "neutral" },
  active: { label: "En curso", tone: "active" },
  blocked: { label: "Bloqueada", tone: "blocked" },
  waiting_quality: { label: "Esperando calidad", tone: "waiting" },
  waiting_approval: { label: "Esperando aprobación", tone: "waiting" },
};

const ATTENTION_KIND: Record<AttentionKind, BadgeTone> = {
  blocked: "blocked",
  missing_materials: "urgent",
  waiting_quality: "waiting",
  waiting_approval: "waiting",
};

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "border-[var(--os-border)] bg-[var(--os-surface-muted)]/60 text-[var(--os-text-muted)]",
  active: "border-[var(--os-teal)]/20 bg-[var(--os-teal-soft)] text-[var(--os-teal)]",
  urgent: "border-amber-200 bg-amber-50 text-amber-800",
  blocked: "border-rose-200 bg-rose-50 text-rose-700",
  waiting: "border-[var(--os-border)] bg-[var(--os-surface)] text-[var(--os-text-muted)]",
};

interface StatusBadgeProps {
  label: string;
  tone?: BadgeTone;
}

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-medium uppercase tracking-wide ${TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}

export function WorkStatusBadge({ status }: { status: WorkCardStatus }) {
  const config = WORK_STATUS[status];
  return <StatusBadge label={config.label} tone={config.tone} />;
}

export function PriorityBadge({ priority }: { priority?: "urgent" | "today" | "normal" }) {
  if (!priority || priority === "normal") return null;
  return (
    <StatusBadge
      label={priority === "urgent" ? "Urgente" : "Hoy"}
      tone={priority === "urgent" ? "urgent" : "active"}
    />
  );
}

export function AttentionKindBadge({ kind }: { kind: AttentionKind }) {
  const labels: Record<AttentionKind, string> = {
    blocked: "Bloqueo",
    missing_materials: "Faltante",
    waiting_quality: "Calidad",
    waiting_approval: "Aprobación",
  };
  return <StatusBadge label={labels[kind]} tone={ATTENTION_KIND[kind]} />;
}

export { WORK_STATUS, ATTENTION_KIND, TONE_CLASS };
