"use client";

import { WorkspaceMissionHeader } from "@/components/patterns/workspace/workspace-mission-header";
import { WorkspaceProblemsBanner } from "@/components/patterns/workspace/workspace-problems-banner";
import { WorkspacePanoramaPanel } from "@/components/patterns/workspace/workspace-panorama-panel";
import { ActionableTaskRenderer } from "@/components/patterns/actions/actionable-task-renderer";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import type { WorkspaceDefinition } from "@/config/workspaces";
import { groupWorkspaceTasksBySection } from "@/lib/workspace/group-by-section";
import {
  getWorkspaceFocoTask,
  getWorkspaceProblemTasks,
} from "@/lib/workspace/get-foco-task";
import { useOperationsStore } from "@/lib/operations/operations-store";
import { RealDataSourceBanner } from "@/components/data/real-data-source-banner";
import { MapperPendingBanner } from "@/components/data/mapper-pending-banner";
import { getSectionEmptyState } from "@/lib/mappers/real-data-empty-state";
import type { WorkspaceId } from "@/types/actions";
import { getWorkspacePanorama } from "@/mocks/workspace";
import { cn } from "@/lib/utils/cn";
import { CheckCircle2, ChevronDown, Target } from "lucide-react";
import { useState } from "react";
import type { OperationsDiagnostics } from "@/types/operations/operations-diagnostics";

interface ActionableWorkspaceViewProps {
  config: WorkspaceDefinition;
}

function ActionableWorkspaceSection({
  section,
  dataMode,
  diagnostics,
  workspaceId,
  totalTaskCount,
}: {
  section: ReturnType<typeof groupWorkspaceTasksBySection>[number];
  dataMode: "demo" | "real";
  diagnostics: OperationsDiagnostics | null;
  workspaceId: WorkspaceId;
  totalTaskCount: number;
}) {
  const [collapsed, setCollapsed] = useState(section.defaultCollapsed ?? false);
  const isOpen = !collapsed;
  const empty = getSectionEmptyState({
    dataMode,
    diagnostics,
    workspaceId,
    sectionId: section.id,
    sectionTaskCount: section.tasks.length,
    totalTaskCount,
  });

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setCollapsed((v) => !v)}
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-[var(--muted-foreground)] transition-transform",
              !isOpen && "-rotate-90"
            )}
          />
          <div>
            <h2 className="text-sm font-semibold">{section.label}</h2>
            {section.description && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {section.description}
              </p>
            )}
          </div>
        </button>
        <Chip variant="outline" size="sm">
          {section.tasks.length}
        </Chip>
      </header>
      {isOpen && (
        <div className="flex flex-col gap-3 p-4">
          {section.tasks.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={empty.title}
              description={empty.description}
              tone={empty.tone}
              className="py-6"
            />
          ) : (
            section.tasks.map((task) => (
              <ActionableTaskRenderer
                key={task.id}
                payload={task.payload}
                surface="workspace"
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

/** E6 workspace shell — live OperationsStore + actionable tasks. Does not modify E4. */
export function ActionableWorkspaceView({ config }: ActionableWorkspaceViewProps) {
  const { state, dataMode, dataSource, diagnostics, loading, hydrated } =
    useOperationsStore();
  const wsId = config.id as WorkspaceId;
  const workspaceTasks = state.workspaceTasks[wsId] ?? [];
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
      ? section.tasks.filter((t) => t.id !== focoTaskId)
      : section.tasks,
  }));

  const panoramaFromStore =
    dataMode === "real" ? state.workspacePanorama?.[wsId] : undefined;
  const panorama =
    panoramaFromStore ??
    getWorkspacePanorama(
      config.id as Exclude<
        typeof config.id,
        "bandeja" | "consulta" | "design-system"
      >
    );

  return (
    <div className="flex flex-col gap-6">
      <RealDataSourceBanner
        dataMode={dataMode}
        dataSource={dataSource}
        diagnostics={diagnostics}
        loading={loading && !hydrated}
      />
      <MapperPendingBanner
        workspaceId={wsId}
        diagnostics={diagnostics}
        dataMode={dataMode}
      />
      <WorkspaceMissionHeader title={config.title} mission={config.mission} />
      {focoTask && (
        <section aria-label="Foco del workspace">
          <div className="mb-3 flex items-center gap-2">
            <Target className="size-4 text-[var(--color-action)]" />
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-action)]">
              Foco
            </p>
          </div>
          <ActionableTaskRenderer
            payload={focoTask.payload}
            variant="featured"
            surface="workspace"
          />
        </section>
      )}
      <WorkspaceProblemsBanner problems={problemTasks} />
      {panorama && panorama.length > 0 && (
        <WorkspacePanoramaPanel metrics={panorama} />
      )}
      <div className="flex flex-col gap-4">
        {sections.map((section) => (
          <ActionableWorkspaceSection
            key={section.id}
            section={section}
            dataMode={dataMode}
            diagnostics={diagnostics}
            workspaceId={wsId}
            totalTaskCount={workspaceTasks.length}
          />
        ))}
      </div>
    </div>
  );
}
