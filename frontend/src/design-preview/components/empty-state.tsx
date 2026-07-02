import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

interface EmptyStateProps {
  title: string;
  message: string;
  action?: ReactNode;
}

/** Estado vacío oficial — nunca listas en blanco. */
export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--os-radius)] border border-dashed border-[var(--os-border)] bg-[var(--os-surface-muted)] px-8 py-16 text-center os-fade-in">
      <div className="flex size-16 items-center justify-center rounded-full bg-[var(--os-teal-soft)]">
        <Inbox className="size-7 text-[var(--os-teal)]" aria-hidden="true" />
      </div>
      <p className="mt-6 text-lg font-semibold text-[var(--os-text)]">{title}</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--os-text-muted)]">
        {message}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
