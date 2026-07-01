"use client";

import { BandejaDayPulse } from "@/components/patterns/bandeja/bandeja-day-pulse";
import { BandejaFoco } from "@/components/patterns/bandeja/bandeja-foco";
import { BandejaProblemsBanner } from "@/components/patterns/bandeja/bandeja-problems-banner";
import { BandejaSection } from "@/components/patterns/bandeja/bandeja-section";
import { groupTasksBySection } from "@/lib/bandeja/group-by-section";
import {
  getFocoTask,
  getProblemTasks,
} from "@/lib/bandeja/prioritize";
import {
  bandejaTasks,
  dayPulse,
} from "@/mocks/bandeja";
import type { BandejaDayPulse as BandejaDayPulseData } from "@/types/bandeja/bandeja-task";
import type { BandejaTask } from "@/types/bandeja/bandeja-task";

export interface BandejaViewProps {
  tasks?: BandejaTask[];
  pulse?: BandejaDayPulseData;
}

export function BandejaView({
  tasks = bandejaTasks,
  pulse = dayPulse,
}: BandejaViewProps) {
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
      <BandejaDayPulse pulse={pulse} />

      {focoTask && <BandejaFoco task={focoTask} />}

      <BandejaProblemsBanner problems={problemTasks} />

      <div className="flex flex-col gap-4">
        {sections.map((section) => (
          <BandejaSection key={section.id} section={section} />
        ))}
      </div>
    </div>
  );
}
