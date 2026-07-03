"use client";

import { useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace, useWorkspaceUserInitials } from "../../workspace-provider";
import { getWorkspaceExperienceV2 } from "../../experience/mock-workspace-v2";
import { isQualityDecisionFocus } from "../../experience/v2-types";
import { useWorkspaceActions } from "../../hooks/use-workspace-actions";
import { workspaceContainerClass } from "../../lib/workspace-layout";
import { FocusBlock } from "../instrument/focus-block";
import { QualityDecisionFocusBlock } from "../instrument/quality-decision-focus";
import { DirectionPanoramaBlock } from "../instrument/direction-panorama";
import { StatusCountStrip } from "../instrument/status-indicator";
import {
  ActivityRow,
  CompletedTodayCollapsible,
  QueueSectionBlock,
} from "../instrument/instrument-work-card";
import type { QueueCardData } from "../../experience/v2-types";

/** Home v2 — instrumento de precisión + sistema vivo (Product Design spec). */
export function PremiumWorkspaceHome() {
  const workspace = useRequiredWorkspace();
  const userInitials = useWorkspaceUserInitials();
  const experience = getWorkspaceExperienceV2(
    workspace.context.sectorId,
    workspace.context.firstName
  );
  const { handleHeroCta, handleWorkSelect, handleAction } = useWorkspaceActions(workspace);
  const [activityOpen, setActivityOpen] = useState(false);

  const handleQueueAction = (item: QueueCardData) => {
    handleWorkSelect(item.reference, item.product);
  };

  const handleQualityDecision = (id: "reject" | "release", label: string) => {
    if (id === "release") {
      handleHeroCta();
      return;
    }
    handleWorkSelect(experience.focus.reference, label);
  };

  return (
    <TwinShell
      title="Mi trabajo"
      userInitials={userInitials}
      contentClassName="px-4 py-6 sm:px-6 sm:py-8 lg:px-10"
    >
      <div className={`${workspaceContainerClass} os-fade-in max-w-4xl`}>
        {experience.mode === "direction_panorama" && experience.panorama ? (
          <DirectionPanoramaBlock
            greetingContext={experience.focus.greetingContext}
            panorama={experience.panorama}
          />
        ) : experience.mode === "quality_decision" &&
          isQualityDecisionFocus(experience.focus) ? (
          <QualityDecisionFocusBlock
            focus={experience.focus}
            onContextLink={(_, label) => handleWorkSelect(experience.focus.reference, label)}
            onDecision={handleQualityDecision}
          />
        ) : (
          <FocusBlock focus={experience.focus} onCta={handleHeroCta} />
        )}

        {experience.statusCounts && (
          <div className="border-t border-[var(--os-border-subtle)] pt-8">
            <StatusCountStrip {...experience.statusCounts} />
          </div>
        )}

        {experience.queues.length > 0 && (
          <div className="space-y-8 border-t border-[var(--os-border-subtle)] pt-8">
            {experience.mode === "quality_decision" &&
              isQualityDecisionFocus(experience.focus) && (
                <p className="text-sm text-[var(--os-text-muted)]">
                  {experience.focus.queueSectionLabel}
                </p>
              )}
            {experience.queues.map((section) => (
              <QueueSectionBlock
                key={section.id}
                section={section}
                onCardAction={handleQueueAction}
              />
            ))}
          </div>
        )}

        {experience.completedTodayCount != null && experience.completedTodayLabel && (
          <CompletedTodayCollapsible
            count={experience.completedTodayCount}
            label={experience.completedTodayLabel}
          />
        )}

        {experience.recentActivity && experience.recentActivity.length > 0 && (
          <section className="border-t border-[var(--os-border-subtle)] pt-6">
            <button
              type="button"
              onClick={() => setActivityOpen((value) => !value)}
              className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--os-text-muted)] hover:text-[var(--os-text)]"
            >
              Actividad reciente
            </button>
            {activityOpen && (
              <div className="mt-3 divide-y divide-[var(--os-border-subtle)]">
                {experience.recentActivity.map((row) => (
                  <ActivityRow key={row.id} text={row.text} time={row.time} />
                ))}
              </div>
            )}
          </section>
        )}

        {experience.mode === "direction_panorama" && (
          <div className="flex justify-end pt-4">
            <button
              type="button"
              onClick={() => handleAction({ id: "operations", label: "Centro de Operaciones" })}
              className="text-sm font-medium text-[var(--os-teal)] hover:underline"
            >
              Centro de Operaciones →
            </button>
          </div>
        )}
      </div>
    </TwinShell>
  );
}
