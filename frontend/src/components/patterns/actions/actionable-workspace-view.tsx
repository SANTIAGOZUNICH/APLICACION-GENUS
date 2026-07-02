"use client";

import { WorkspaceMissionHeader } from "@/components/patterns/workspace/workspace-mission-header";
import { ActionableTaskRenderer } from "@/components/patterns/actions/actionable-task-renderer";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import type { WorkspaceDefinition } from "@/config/workspaces";
import { produccionRealWorkspace } from "@/config/workspaces/produccion.config";
import { groupWorkspaceTasksBySection } from "@/lib/workspace/group-by-section";
import { useOperationsStore } from "@/lib/operations/operations-store";
import { RealDataSourceBanner } from "@/components/data/real-data-source-banner";
import { IntegrationPendingBanner } from "@/components/data/integration-pending-banner";
import type { WorkspaceId } from "@/types/actions";
import { getWorkspacePanorama } from "@/mocks/workspace";
import { cn } from "@/lib/utils/cn";
import { ChevronDown, FolderOpen } from "lucide-react";
import { useState } from "react";
import {
  WorkspaceProblemsBanner,
} from "@/components/patterns/workspace/workspace-problems-banner";
import { WorkspacePanoramaPanel } from "@/components/patterns/workspace/workspace-panorama-panel";
import {
  getWorkspaceFocoTask,
  getWorkspaceProblemTasks,
} from "@/lib/workspace/get-foco-task";
function ProduccionRealSection({
  section,
}: {
  section: ReturnType<typeof groupWorkspaceTasksBySection>[number];
}) {
  const [collapsed, setCollapsed] = useState(section.defaultCollapsed ?? false);
  const isOpen = !collapsed;

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
              icon={FolderOpen}
              title="Sin OEs en esta sección"
              description="No hay órdenes indexadas que correspondan a este grupo."
              tone="neutral"
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

/** E6 workspace shell — E7.2 real slice for produccion; honest pending for other areas. */
export function ActionableWorkspaceView({ config }: { config: WorkspaceDefinition }) {
  const { state, dataMode, dataSource, diagnostics, loading, hydrated } =
    useOperationsStore();
  const wsId = config.id as WorkspaceId;

  if (dataMode === "real" && wsId !== "produccion") {
    return (
      <div className="flex flex-col gap-6">
        <RealDataSourceBanner
          dataMode={dataMode}
          dataSource={dataSource}
          diagnostics={diagnostics}
          loading={loading && !hydrated}
        />
        <IntegrationPendingBanner workspaceId={wsId} dataMode={dataMode} />
        <WorkspaceMissionHeader title={config.title} mission={config.mission} />
        <EmptyState
          icon={FolderOpen}
          title="Pendiente de integración real"
          description="Esta área se conectará en E7.3+. Usá Consulta o Producción para trabajar con OEs de ELABORACION."
          tone="neutral"
        />
      </div>
    );
  }

  const effectiveConfig =
    dataMode === "real" && wsId === "produccion" ? produccionRealWorkspace : config;

  const workspaceTasks = state.workspaceTasks[wsId] ?? [];
  const sections = groupWorkspaceTasksBySection(
    workspaceTasks,
    effectiveConfig.sections
  );

  if (dataMode === "real" && wsId === "produccion") {
    const oeCount = diagnostics?.counts?.oe ?? workspaceTasks.length;

    return (
      <div className="flex flex-col gap-6">
        <RealDataSourceBanner
          dataMode={dataMode}
          dataSource={dataSource}
          diagnostics={diagnostics}
          loading={loading && !hydrated}
        />
        <WorkspaceMissionHeader
          title={effectiveConfig.title}
          mission={effectiveConfig.mission}
        />
        {oeCount === 0 && !loading && (
          <EmptyState
            icon={FolderOpen}
            title="Sin OEs indexadas"
            description="Ejecutá /api/v1/drive/refresh o verificá credenciales de Drive."
            tone="neutral"
          />
        )}
        <div className="flex flex-col gap-4">
          {sections.map((section) => (
            <ProduccionRealSection key={section.id} section={section} />
          ))}
        </div>
      </div>
    );
  }

  const focoTask = getWorkspaceFocoTask(
    workspaceTasks,
    effectiveConfig.focoSectionId
  );
  const focoTaskId = focoTask?.id;
  const problemTasks = getWorkspaceProblemTasks(
    workspaceTasks,
    effectiveConfig.problemsSectionId
  );
  const demoSections = sections.map((section) => ({
    ...section,
    tasks: focoTaskId
      ? section.tasks.filter((t) => t.id !== focoTaskId)
      : section.tasks,
  }));
  const panorama =
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
      <WorkspaceMissionHeader title={config.title} mission={config.mission} />
      {focoTask && (
        <section aria-label="Foco del workspace">
          <ActionableTaskRenderer payload={focoTask.payload} variant="featured" surface="workspace" />
        </section>
      )}
      <WorkspaceProblemsBanner problems={problemTasks} />
      {panorama && panorama.length > 0 && (
        <WorkspacePanoramaPanel metrics={panorama} />
      )}
      <div className="flex flex-col gap-4">
        {demoSections.map((section) => (
          <ProduccionRealSection key={section.id} section={section} />
        ))}
      </div>
    </div>
  );
}
