import { sortWorkspaceByUrgency } from "@/lib/workspace/get-foco-task";
import type { WorkspaceSectionConfig } from "@/types/workspace/workspace-section";
import type { WorkspaceTask } from "@/types/workspace/workspace-task";

export interface WorkspaceSectionGroup extends WorkspaceSectionConfig {
  tasks: WorkspaceTask[];
}

export function groupWorkspaceTasksBySection(
  tasks: WorkspaceTask[],
  sections: readonly WorkspaceSectionConfig[]
): WorkspaceSectionGroup[] {
  return sections.map((section) => ({
    ...section,
    tasks: sortWorkspaceByUrgency(
      tasks.filter((task) => task.sectionId === section.id)
    ),
  }));
}
