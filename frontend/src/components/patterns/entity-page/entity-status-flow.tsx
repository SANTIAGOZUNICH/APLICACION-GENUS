import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { EntityStatusFlowStep } from "@/types/entity-page";

interface EntityStatusFlowProps {
  /** Ordered lifecycle steps for this entity type. */
  flujo: readonly EntityStatusFlowStep[];
  /** Id of the current stage within `flujo`. */
  etapaActual: string;
  className?: string;
}

/**
 * EntityStatusFlow — generic status bar for any entity lifecycle.
 * Receives flow + current stage; no entity-specific logic.
 */
export function EntityStatusFlow({
  flujo,
  etapaActual,
  className,
}: EntityStatusFlowProps) {
  const currentIndex = flujo.findIndex((step) => step.id === etapaActual);

  return (
    <nav
      aria-label="Flujo de estado"
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3",
        className
      )}
    >
      <ol className="flex flex-wrap items-center gap-1">
        {flujo.map((step, index) => {
          const isPast = currentIndex > index;
          const isCurrent = step.id === etapaActual;
          const isFuture = currentIndex >= 0 && index > currentIndex;

          return (
            <li key={step.id} className="flex items-center gap-1">
              {index > 0 && (
                <span
                  className={cn(
                    "mx-1 hidden h-px w-4 sm:block",
                    isPast || isCurrent
                      ? "bg-[var(--color-action)]/40"
                      : "bg-[var(--border)]"
                  )}
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors",
                  isCurrent &&
                    "bg-[var(--color-action)]/10 text-[var(--color-action)] ring-1 ring-[var(--color-action)]/30",
                  isPast && "text-[var(--foreground)]",
                  isFuture && "text-[var(--muted-foreground)]"
                )}
                style={{ fontSize: "var(--text-caption)" }}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isPast && (
                  <Check
                    className="size-3 text-[var(--color-ok)]"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                )}
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
