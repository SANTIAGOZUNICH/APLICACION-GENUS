import { AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface FormErrorMessageProps {
  /** What happened */
  message: string;
  /** How to resolve it */
  resolution?: string;
  id?: string;
  className?: string;
}

/**
 * Inline form error — qué pasó + cómo resolverlo.
 * /docs/07-design-system.md §3
 */
export function FormErrorMessage({
  message,
  resolution,
  id,
  className,
}: FormErrorMessageProps) {
  return (
    <div
      id={id}
      role="alert"
      className={cn(
        "flex gap-2 rounded-md border border-[var(--color-problem)]/20 bg-[var(--badge-problem-bg)] p-3 text-sm text-[var(--foreground)]",
        className
      )}
    >
      <AlertOctagon
        className="size-4 shrink-0 text-[var(--color-problem)]"
        aria-hidden="true"
      />
      <div>
        <p className="font-medium">{message}</p>
        {resolution && (
          <p className="mt-0.5 text-[var(--muted-foreground)]">{resolution}</p>
        )}
      </div>
    </div>
  );
}
