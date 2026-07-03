import type { WorkCardStatus } from "../../experience/types";
import { WorkStatusBadge } from "../premium/status-badge";

interface InstrumentStatusProps {
  status: WorkCardStatus;
}

/** Badge con texto — nunca solo color (spec v2 §3.2). */
export function InstrumentStatusBadge({ status }: InstrumentStatusProps) {
  return <WorkStatusBadge status={status} />;
}

export function StatusCountStrip({
  blocked,
  urgent,
  inProgress,
  pending,
}: {
  blocked: number;
  urgent: number;
  inProgress: number;
  pending: number;
}) {
  const items = [
    { count: blocked, label: "bloqueado", tone: "text-rose-700" },
    { count: urgent, label: "urgente", tone: "text-amber-800" },
    { count: inProgress, label: "en curso", tone: "text-[var(--os-teal)]" },
    { count: pending, label: "pendiente", tone: "text-[var(--os-text-muted)]" },
  ];

  return (
    <div
      className="flex flex-wrap gap-x-6 gap-y-2 text-sm tabular-nums"
      aria-label="Resumen de estados"
    >
      {items.map(({ count, label, tone }) => (
        <span key={label} className={tone}>
          <span className="font-semibold">{count}</span>{" "}
          <span className="text-[var(--os-text-muted)]">{label}</span>
        </span>
      ))}
    </div>
  );
}
