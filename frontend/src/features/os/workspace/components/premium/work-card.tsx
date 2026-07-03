import type { WorkCardData } from "../../experience/types";
import { PriorityBadge, WorkStatusBadge } from "./status-badge";

interface WorkCardProps {
  item: WorkCardData;
  onSelect?: (item: WorkCardData) => void;
}

export function WorkCard({ item, onSelect }: WorkCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      className="group os-fade-in flex w-full flex-col rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-5 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--os-teal)]/30 hover:shadow-[var(--os-shadow-card)] sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-medium text-[var(--os-teal)]">
          {item.reference}
        </span>
        {item.lot && (
          <span className="text-xs text-[var(--os-text-muted)]">· {item.lot}</span>
        )}
        <PriorityBadge priority={item.priority} />
      </div>

      <p className="mt-3 text-base font-semibold leading-snug text-[var(--os-text)] sm:text-lg">
        {item.product}
      </p>

      {item.client && (
        <p className="mt-1 text-sm text-[var(--os-text-muted)]">{item.client}</p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <WorkStatusBadge status={item.status} />
        {item.meta && (
          <span className="text-xs text-[var(--os-text-muted)]">{item.meta}</span>
        )}
      </div>
    </button>
  );
}
