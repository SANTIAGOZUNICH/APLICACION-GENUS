import type { WorkspaceTask } from "@/types/workspace/workspace-task";

export function sortWorkspaceByUrgency(
  tasks: WorkspaceTask[]
): WorkspaceTask[] {
  return [...tasks].sort((a, b) => b.urgencyScore - a.urgencyScore);
}

export function getWorkspaceFocoTask(
  tasks: WorkspaceTask[],
  focoSectionId: string
): WorkspaceTask | undefined {
  const focoCandidates = sortWorkspaceByUrgency(
    tasks.filter((task) => task.sectionId === focoSectionId)
  );
  return focoCandidates[0];
}

export function getWorkspaceProblemTasks(
  tasks: WorkspaceTask[],
  problemsSectionId = "problemas"
): WorkspaceTask[] {
  return sortWorkspaceByUrgency(
    tasks.filter((task) => task.sectionId === problemsSectionId)
  );
}
