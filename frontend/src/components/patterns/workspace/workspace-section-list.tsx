"use client";

import { CheckCircle2, ChevronDown, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { BandejaSection } from "@/components/patterns/bandeja/bandeja-section";
import { WorkspacePanoramaPanel } from "@/components/patterns/workspace/workspace-panorama-panel";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import type { BandejaSectionGroup } from "@/lib/bandeja/group-by-section";
import type { WorkspaceSectionGroup } from "@/lib/workspace/group-by-section";
import type { WorkspacePanoramaMetric } from "@/types/workspace/workspace-task";
import { cn } from "@/lib/utils/cn";

function getEmptyState(sectionId: string) {
  if (sectionId === "finalizados" || sectionId === "cerrados") {
    return {
      icon: CheckCircle2,
      title: "Nada cerrado todavía hoy",
      description: "Cuando se complete trabajo, aparecerá acá.",
      tone: "neutral" as const,
    };
  }
  if (sectionId === "problemas" || sectionId === "excepciones") {
    return {
      icon: CheckCircle2,
      title: "Sin problemas pendientes",
      description: "Todo en orden en este contexto.",
      tone: "positive" as const,
    };
  }
  if (sectionId === "esperando-otros") {
    return {
      icon: Inbox,
      title: "Nada esperando a otros",
      description: "No hay postas pendientes de otro rol.",
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

function toBandejaSectionGroup(
  section: WorkspaceSectionGroup
): BandejaSectionGroup {
  return section as unknown as BandejaSectionGroup;
}

interface WorkspaceSectionShellProps {
  section: WorkspaceSectionGroup;
  badgeCount?: number;
  children: ReactNode;
}

function WorkspaceSectionShell({
  section,
  badgeCount,
  children,
}: WorkspaceSectionShellProps) {
  const [collapsed, setCollapsed] = useState(section.defaultCollapsed);
  const isCollapsible = !section.alwaysExpanded;
  const isOpen = section.alwaysExpanded || !collapsed;

  return (
    <section
      id={`workspace-${section.id}`}
      className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)]"
    >
      <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        {isCollapsible ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded={isOpen}
            onClick={() => setCollapsed((value) => !value)}
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
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              {section.description}
            </p>
          </div>
        )}
        <Chip variant="outline" size="sm">
          {badgeCount ?? section.tasks.length}
        </Chip>
      </header>
      {isOpen && <div className="p-4">{children}</div>}
    </section>
  );
}

interface WorkspaceDeckSectionProps {
  section: WorkspaceSectionGroup;
}

function WorkspaceDeckSection({ section }: WorkspaceDeckSectionProps) {
  if (section.variant === "panorama") return null;

  if (section.tasks.length === 0) {
    const empty = getEmptyState(section.id);
    return (
      <WorkspaceSectionShell section={section}>
        <EmptyState
          icon={empty.icon}
          title={empty.title}
          description={empty.description}
          tone={empty.tone}
          className="py-8"
        />
      </WorkspaceSectionShell>
    );
  }

  return <BandejaSection section={toBandejaSectionGroup(section)} />;
}

interface WorkspacePanoramaSectionProps {
  section: WorkspaceSectionGroup;
  metrics?: WorkspacePanoramaMetric[];
}

function WorkspacePanoramaSection({
  section,
  metrics = [],
}: WorkspacePanoramaSectionProps) {
  return (
    <WorkspaceSectionShell section={section} badgeCount={metrics.length}>
      {metrics.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Panorama al día"
          description="No hay indicadores fuera de rango."
          tone="positive"
          className="py-8"
        />
      ) : (
        <WorkspacePanoramaPanel metrics={metrics} />
      )}
    </WorkspaceSectionShell>
  );
}

export interface WorkspaceSectionListProps {
  sections: WorkspaceSectionGroup[];
  panoramaMetrics?: WorkspacePanoramaMetric[];
}

export function WorkspaceSectionList({
  sections,
  panoramaMetrics,
}: WorkspaceSectionListProps) {
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) =>
        section.variant === "panorama" ? (
          <WorkspacePanoramaSection
            key={section.id}
            section={section}
            metrics={panoramaMetrics}
          />
        ) : (
          <WorkspaceDeckSection key={section.id} section={section} />
        )
      )}
    </div>
  );
}
