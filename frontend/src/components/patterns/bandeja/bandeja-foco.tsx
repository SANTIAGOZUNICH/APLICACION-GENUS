import { Target } from "lucide-react";
import { BandejaTaskRenderer } from "@/components/patterns/bandeja/bandeja-task-renderer";
import type { BandejaTask } from "@/types/bandeja/bandeja-task";

export interface BandejaFocoProps {
  task: BandejaTask;
}

export function BandejaFoco({ task }: BandejaFocoProps) {
  return (
    <section aria-label="Tu foco — lo próximo">
      <div className="mb-3 flex items-center gap-2">
        <Target
          className="size-4 text-[var(--color-action)]"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-action)]">
          Tu foco
        </p>
      </div>
      <BandejaTaskRenderer payload={task.payload} variant="featured" />
    </section>
  );
}
