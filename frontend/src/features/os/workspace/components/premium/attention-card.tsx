import type { AttentionItemData } from "../../experience/types";
import { AttentionKindBadge } from "./status-badge";

interface AttentionCardProps {
  item: AttentionItemData;
  onSelect?: (item: AttentionItemData) => void;
}

export function AttentionCard({ item, onSelect }: AttentionCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      className="group os-fade-in flex w-full flex-col rounded-[var(--os-radius-sm)] border border-[var(--os-border-subtle)] bg-[var(--os-surface-muted)]/30 px-5 py-4 text-left transition-all duration-200 ease-out hover:border-[var(--os-border)] hover:bg-[var(--os-surface)] hover:shadow-[var(--os-shadow-sm)]"
    >
      <AttentionKindBadge kind={item.kind} />
      <p className="mt-3 text-sm font-semibold text-[var(--os-text)]">{item.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-[var(--os-text-muted)]">{item.detail}</p>
    </button>
  );
}
