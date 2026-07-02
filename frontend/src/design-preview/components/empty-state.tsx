import type { ReactNode } from "react";
import { EmptyState as UiEmptyState } from "@/components/ui/empty-state";

interface PreviewEmptyStateProps {
  title: string;
  message: string;
  action?: ReactNode;
}

/** Empty state operacional del Digital Twin — delega al componente UI unificado. */
export function EmptyState({ title, message, action }: PreviewEmptyStateProps) {
  return (
    <UiEmptyState
      variant="operational"
      title={title}
      message={message}
      actionSlot={action}
    />
  );
}
