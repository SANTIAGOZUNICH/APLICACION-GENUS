"use client";

import { BandejaDayPulse } from "@/components/patterns/bandeja/bandeja-day-pulse";
import { BandejaProblemsBanner } from "@/components/patterns/bandeja/bandeja-problems-banner";
import { ActionableTaskRenderer } from "@/components/patterns/actions/actionable-task-renderer";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { groupTasksBySection } from "@/lib/bandeja/group-by-section";
import {
  getFocoTask,
  getProblemTasks,
} from "@/lib/bandeja/prioritize";
import { useOperationsStore } from "@/lib/operations/operations-store";
import { RealDataSourceBanner } from "@/components/data/real-data-source-banner";
import { cn } from "@/lib/utils/cn";
import type { BandejaSectionGroup } from "@/lib/bandeja/group-by-section";
import type { BandejaTask } from "@/types/bandeja/bandeja-task";
import type { OperationsDiagnostics } from "@/types/operations/operations-diagnostics";
import { Target, CheckCircle2, ChevronDown } from "lucide-react";
import { useState } from "react";

function ActionableBandejaFoco({ task }: { task: BandejaTask }) {
  return (
    <section aria-label="Tu foco — lo próximo">
      <div className="mb-3 flex items-center gap-2">
        <Target
          className="size-4 text-[var(--color-action)]"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-action)]">
          Tu foco
        </p>
      </div>
      <ActionableTaskRenderer
        payload={task.payload}
        variant="featured"
        surface="bandeja"
      />
    </section>
  );
}

function getEmptyState(
  section: BandejaSectionGroup,
  dataMode: "demo" | "real",
  diagnostics: OperationsDiagnostics | null,
  totalTaskCount: number
) {
  if (
    dataMode === "real" &&
    totalTaskCount === 0 &&
    (diagnostics?.counts?.oe ?? 0) > 0 &&
    section.tasks.length === 0
  ) {
    return {
      icon: CheckCircle2,
      title: "Datos reales pendientes de mapeo",
      description:
        "Hay OEs indexadas en ELABORACION. La bandeja se construirá con esos datos al hidratar.",
      tone: "neutral" as const,
    };
  }

  if (section.id === "finalizados") {
    return {
      icon: CheckCircle2,
      title: "Nada finalizado todavía hoy",
      description: "Cuando completes tareas, aparecerán acá.",
      tone: "neutral" as const,
    };
  }
  if (section.id === "problemas") {
    return {
      icon: CheckCircle2,
      title: "Sin problemas pendientes",
      description: "Todo en orden. Seguí con tu trabajo.",
      tone: "positive" as const,
    };
  }
  return {
    icon: CheckCircle2,
    title: "Sección al día",
    description: "No hay ítems en esta sección por ahora.",
    tone: "positive" as const,
  };
}

function ActionableBandejaSection({
  section,
  dataMode,
  diagnostics,
  totalTaskCount,
}: {
  section: BandejaSectionGroup;
  dataMode: "demo" | "real";
  diagnostics: OperationsDiagnostics | null;
  totalTaskCount: number;
}) {
  const [collapsed, setCollapsed] = useState(section.defaultCollapsed);
  const isCollapsible = !section.alwaysExpanded;
  const isOpen = section.alwaysExpanded || !collapsed;
  const empty = getEmptyState(section, dataMode, diagnostics, totalTaskCount);

  return (
    <section
      className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)]"
      aria-labelledby={`bandeja-heading-${section.id}`}
    >
      <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        {isCollapsible ? (
          <button
            type="button"
            id={`bandeja-heading-${section.id}`}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded={isOpen}
            onClick={() => setCollapsed((v) => !v)}
          >
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-[var(--muted-foreground)] transition-transform",
                !isOpen && "-rotate-90"
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">
                {section.label}
              </h2>
              <p className="truncate text-xs text-[var(--muted-foreground)]">
                {section.description}
              </p>
            </div>
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              {section.label}
            </h2>
          </div>
        )}
        <Chip variant="outline" size="sm">
          {section.tasks.length}
        </Chip>
      </header>
      {isOpen && (
        <div className="p-4">
          {section.tasks.length === 0 ? (
            <EmptyState
              icon={empty.icon}
              title={empty.title}
              description={empty.description}
              tone={empty.tone}
              className="py-8"
            />
          ) : (
            <div className="flex flex-col gap-3">
              {section.tasks.map((task) => (
                <ActionableTaskRenderer
                  key={task.id}
                  payload={task.payload}
                  surface="bandeja"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** E6 bandeja shell — live OperationsStore + actionable tasks. Does not modify E3. */
export function ActionableBandejaView() {
  const { state, dataMode, dataSource, diagnostics, loading, hydrated } =
    useOperationsStore();
  const tasks = state.bandejaTasks;
  const focoTask = getFocoTask(tasks);
  const problemTasks = getProblemTasks(tasks);
  const focoTaskId = focoTask?.id;
  const sections = groupTasksBySection(tasks).map((section) => ({
    ...section,
    tasks: focoTaskId
      ? section.tasks.filter((task) => task.id !== focoTaskId)
      : section.tasks,
  }));

  return (
    <div className="flex flex-col gap-6">
      <RealDataSourceBanner
        dataMode={dataMode}
        dataSource={dataSource}
        diagnostics={diagnostics}
        loading={loading && !hydrated}
      />
      <BandejaDayPulse pulse={state.dayPulse} />
      {focoTask && <ActionableBandejaFoco task={focoTask} />}
      <BandejaProblemsBanner problems={problemTasks} />
      <div className="flex flex-col gap-4">
        {sections.map((section) => (
          <ActionableBandejaSection
            key={section.id}
            section={section}
            dataMode={dataMode}
            diagnostics={diagnostics}
            totalTaskCount={tasks.length}
          />
        ))}
      </div>
    </div>
  );
}
