"use client";

import { BandejaFoco } from "@/components/patterns/bandeja/bandeja-foco";
import type { BandejaTask } from "@/types/bandeja/bandeja-task";
import { WorkspaceMissionHeader } from "@/components/patterns/workspace/workspace-mission-header";
import { WorkspaceProblemsBanner } from "@/components/patterns/workspace/workspace-problems-banner";
import { WorkspaceSectionList } from "@/components/patterns/workspace/workspace-section-list";
import type { WorkspaceDefinition } from "@/config/workspaces";
import { groupWorkspaceTasksBySection } from "@/lib/workspace/group-by-section";
import {
  getWorkspaceFocoTask,
  getWorkspaceProblemTasks,
} from "@/lib/workspace/get-foco-task";
import {
  getWorkspacePanorama,
  getWorkspaceTasks,
} from "@/mocks/workspace";
import type { WorkspaceTask } from "@/types/workspace/workspace-task";

export interface WorkspaceViewProps {
  config: WorkspaceDefinition;
  tasks?: WorkspaceTask[];
}

export function WorkspaceView({ config, tasks }: WorkspaceViewProps) {
  const workspaceTasks =
    tasks ??
    getWorkspaceTasks(
      config.id as Exclude<
        typeof config.id,
        "bandeja" | "consulta" | "design-system" | "mi-trabajo"
      >
    );

  const focoTask = getWorkspaceFocoTask(workspaceTasks, config.focoSectionId);
  const focoTaskId = focoTask?.id;
  const problemTasks = getWorkspaceProblemTasks(
    workspaceTasks,
    config.problemsSectionId
  );

  const sections = groupWorkspaceTasksBySection(
    workspaceTasks,
    config.sections
  ).map((section) => ({
    ...section,
    tasks: focoTaskId
      ? section.tasks.filter((task) => task.id !== focoTaskId)
      : section.tasks,
  }));

  const panoramaMetrics = getWorkspacePanorama(config.id);

  const focoAsBandejaTask = focoTask
    ? ({
        ...focoTask,
        sectionId: focoTask.sectionId,
      } as BandejaTask)
    : undefined;

  return (
    <>
      <WorkspaceMissionHeader title={config.title} mission={config.mission} />

      <div className="flex flex-col gap-6">
        {focoAsBandejaTask && <BandejaFoco task={focoAsBandejaTask} />}

        {config.problemsSectionId && (
          <WorkspaceProblemsBanner problems={problemTasks} />
        )}

        <WorkspaceSectionList
          sections={sections}
          panoramaMetrics={panoramaMetrics}
        />
      </div>
    </>
  );
}
