"use client";

import { CheckCircle2, ChevronDown, Inbox } from "lucide-react";
import { useState } from "react";
import { BandejaTaskRenderer } from "@/components/patterns/bandeja/bandeja-task-renderer";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";
import type { BandejaSectionGroup } from "@/lib/bandeja/group-by-section";

export interface BandejaSectionProps {
  section: BandejaSectionGroup;
}

function getEmptyState(section: BandejaSectionGroup) {
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

  if (section.id === "esperando-otros") {
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

export function BandejaSection({ section }: BandejaSectionProps) {
  const [collapsed, setCollapsed] = useState(section.defaultCollapsed);
  const isCollapsible = !section.alwaysExpanded;
  const isOpen = section.alwaysExpanded || !collapsed;
  const empty = getEmptyState(section);

  return (
    <section
      id={`bandeja-${section.id}`}
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
            aria-controls={`bandeja-panel-${section.id}`}
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
          <div className="min-w-0 flex-1" id={`bandeja-heading-${section.id}`}>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              {section.label}
            </h2>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              {section.description}
            </p>
          </div>
        )}
        <Chip variant="outline" size="sm">
          {section.tasks.length}
        </Chip>
      </header>

      {isOpen && (
        <div
          id={`bandeja-panel-${section.id}`}
          className="p-4"
          role="region"
          aria-label={section.label}
        >
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
                <BandejaTaskRenderer key={task.id} payload={task.payload} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
