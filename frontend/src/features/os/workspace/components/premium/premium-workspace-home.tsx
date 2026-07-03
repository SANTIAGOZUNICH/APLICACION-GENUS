"use client";

import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace, useWorkspaceUserInitials } from "../../workspace-provider";
import { getWorkspaceExperience } from "../../experience/mock-workspace-experience";
import { useWorkspaceActions } from "../../hooks/use-workspace-actions";
import { getPremiumActionLabel } from "../../lib/workspace-action-handlers";
import {
  workspaceActionsGridClass,
  workspaceActivityClass,
  workspaceAttentionGridClass,
  workspaceContainerClass,
  workspaceNextStackClass,
  workspaceWorkGridClass,
} from "../../lib/workspace-layout";
import { WorkspaceHero } from "./workspace-hero";
import { SectionHeader } from "./section-header";
import { TaskStack } from "./task-stack";
import { AttentionCard } from "./attention-card";
import { ActionCard } from "./action-card";
import type { AttentionItemData } from "../../experience/types";
import type { WorkCardData } from "../../experience/types";

/** Premium Home — Trabajo → Estado → Acción → Datos. */
export function PremiumWorkspaceHome() {
  const workspace = useRequiredWorkspace();
  const userInitials = useWorkspaceUserInitials();
  const experience = getWorkspaceExperience(workspace.context.sectorId);
  const { handleAction, handleHeroCta, handleWorkSelect, handleAttentionSelect } =
    useWorkspaceActions(workspace);

  const roleLine = [workspace.context.jobTitle, workspace.context.sectorLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <TwinShell
      title="Mi trabajo"
      userInitials={userInitials}
      contentClassName="px-4 py-6 sm:px-8 sm:py-8 lg:px-10"
    >
      <div className={`${workspaceContainerClass} os-fade-in`}>
        <WorkspaceHero
          sectorLabel={workspace.sectorLabel}
          title={workspace.title}
          subtitle={workspace.subtitle}
          roleLine={roleLine}
          ctaLabel={experience.heroCtaLabel}
          onCta={handleHeroCta}
        />

        <section aria-labelledby="workspace-mi-trabajo">
          <SectionHeader
            title={experience.workSectionTitle}
            subtitle="Tarjetas operativas — qué hacer ahora"
          />
          <TaskStack
            className={workspaceWorkGridClass}
            items={experience.workItems}
            onSelectItem={(item: WorkCardData) =>
              handleWorkSelect(item.reference, item.product)
            }
          />
        </section>

        {experience.attentionItems.length > 0 && (
          <section aria-labelledby="workspace-atencion">
            <SectionHeader
              title="Necesita atención"
              subtitle="Bloqueos, faltantes y esperas"
            />
            <div className={workspaceAttentionGridClass}>
              {experience.attentionItems.map((item: AttentionItemData) => (
                <AttentionCard
                  key={item.id}
                  item={item}
                  onSelect={() => handleAttentionSelect(item.title, item.detail)}
                />
              ))}
            </div>
          </section>
        )}

        {experience.nextItems.length > 0 && (
          <section aria-labelledby="workspace-proximo">
            <SectionHeader title="Próximo" subtitle="Qué sigue — máximo 3" />
            <ul className={workspaceNextStackClass}>
              {experience.nextItems.slice(0, 3).map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-4 rounded-[var(--os-radius-sm)] border border-[var(--os-border-subtle)] bg-[var(--os-surface)] px-5 py-4 transition-colors duration-200 hover:border-[var(--os-border)]"
                >
                  <span className="text-sm font-medium text-[var(--os-text)]">
                    {item.label}
                  </span>
                  {item.hint && (
                    <span className="shrink-0 text-xs text-[var(--os-text-muted)]">
                      {item.hint}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="workspace-acciones">
          <SectionHeader title="Acciones principales" />
          <div className={workspaceActionsGridClass}>
            {workspace.definition.primaryActions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                displayLabel={getPremiumActionLabel(action)}
                onSelect={handleAction}
              />
            ))}
          </div>
        </section>

        {experience.recentActivity.length > 0 && (
          <section aria-labelledby="workspace-actividad">
            <SectionHeader title="Actividad reciente" subtitle="Qué terminó hoy" />
            <ul className={`${workspaceActivityClass} rounded-[var(--os-radius-sm)] border border-[var(--os-border-subtle)] bg-[var(--os-surface)]`}>
              {experience.recentActivity.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-4 px-5 py-3 text-sm"
                >
                  <span className="text-[var(--os-text)]">{item.text}</span>
                  <time className="shrink-0 tabular-nums text-xs text-[var(--os-text-muted)]">
                    {item.time}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </TwinShell>
  );
}
