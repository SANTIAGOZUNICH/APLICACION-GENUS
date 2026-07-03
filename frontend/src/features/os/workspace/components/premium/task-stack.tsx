import type { WorkCardData } from "../../experience/types";
import { WorkCard } from "./work-card";

interface TaskStackProps {
  items: WorkCardData[];
  onSelectItem?: (item: WorkCardData) => void;
  className?: string;
}

export function TaskStack({ items, onSelectItem, className = "" }: TaskStackProps) {
  if (items.length === 0) {
    return (
      <p className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-5 py-8 text-center text-sm text-[var(--os-text-muted)]">
        Sin tareas pendientes por ahora.
      </p>
    );
  }

  return (
    <div className={className}>
      {items.map((item) => (
        <WorkCard key={item.id} item={item} onSelect={onSelectItem} />
      ))}
    </div>
  );
}
