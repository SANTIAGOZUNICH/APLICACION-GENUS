import { Alert } from "@/components/ui/alert";
import type { WorkspaceTask } from "@/types/workspace/workspace-task";

export interface WorkspaceProblemsBannerProps {
  problems: WorkspaceTask[];
}

export function WorkspaceProblemsBanner({
  problems,
}: WorkspaceProblemsBannerProps) {
  if (problems.length === 0) return null;

  const count = problems.length;
  const label =
    count === 1
      ? "1 ítem requiere atención inmediata"
      : `${count} ítems requieren atención inmediata`;

  return (
    <Alert variant="problem" title={label}>
      Revisá la sección de problemas — lo bloqueante aparece primero.
    </Alert>
  );
}
