import { ArrowRight } from "lucide-react";
import type { WorkspaceAction } from "../../types";

interface ActionCardProps {
  action: WorkspaceAction;
  displayLabel?: string;
  onSelect: (action: WorkspaceAction) => void;
}

export function ActionCard({ action, displayLabel, onSelect }: ActionCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(action)}
      className="group flex w-full items-start justify-between gap-4 rounded-[var(--os-radius-sm)] border border-[var(--os-border-subtle)] bg-[var(--os-surface)] px-5 py-4 text-left transition-all duration-200 ease-out hover:border-[var(--os-teal)]/25 hover:shadow-[var(--os-shadow-sm)] sm:px-6 sm:py-5"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--os-text)] sm:text-base">
          {displayLabel ?? action.label}
        </p>
        {action.description && (
          <p className="mt-1 text-sm leading-relaxed text-[var(--os-text-muted)]">
            {action.description}
          </p>
        )}
      </div>
      <ArrowRight
        className="mt-0.5 size-4 shrink-0 text-[var(--os-text-muted)] transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--os-teal)]"
        aria-hidden="true"
      />
    </button>
  );
}
